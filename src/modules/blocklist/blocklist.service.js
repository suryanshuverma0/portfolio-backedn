import net from "net";

import BlockedIp from "./blocklist.model.js";
import logger from "../../utils/logger.js";
import { getClientIp } from "../analytics/analytics.utils.js";

// ---------------------------------------------------------------------------
// IP blocklist for the public write endpoints (contact form, comments,
// tracker). Matching runs against an in-memory net.BlockList rebuilt on
// every change and refreshed every minute, so the check costs nothing.
// ---------------------------------------------------------------------------

const REFRESH_MS = 60 * 1000;

let blockList = new net.BlockList();
let entries = [];
let loadedAt = 0;
// Earliest expiry among loaded entries — forces a rebuild once it passes.
let nextExpiry = Infinity;

const activeFilter = () => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });

// "1.2.3.4" | "1.2.3.0/24" | "2001:db8::/32" → { address, prefix, family } or null
export const parseBlockValue = (raw) => {
  const value = String(raw || "").trim();
  const [address, prefixText] = value.split("/");
  const version = net.isIP(address);

  if (!version) return null;

  const family = version === 6 ? "ipv6" : "ipv4";
  const max = version === 6 ? 128 : 32;

  if (prefixText === undefined) return { value: address, address, family };

  const prefix = Number(prefixText);
  if (!/^\d+$/.test(prefixText) || prefix < 1 || prefix > max) return null;

  return { value: `${address}/${prefix}`, address, prefix, family };
};

const rebuild = (docs) => {
  const next = new net.BlockList();

  docs.forEach((doc) => {
    const parsed = parseBlockValue(doc.value);
    if (!parsed) return;

    try {
      if (parsed.prefix) next.addSubnet(parsed.address, parsed.prefix, parsed.family);
      else next.addAddress(parsed.address, parsed.family);
    } catch {
      /* invalid entry — skipped */
    }
  });

  blockList = next;
  entries = docs.map((doc) => ({ id: String(doc._id), value: doc.value }));
  loadedAt = Date.now();
  nextExpiry = Math.min(Infinity, ...docs.filter((doc) => doc.expiresAt).map((doc) => new Date(doc.expiresAt).getTime()));
};

const refresh = async ({ force = false } = {}) => {
  if (!force && Date.now() - loadedAt < REFRESH_MS && Date.now() < nextExpiry) return;

  try {
    rebuild(await BlockedIp.find(activeFilter()).select("value expiresAt").lean());
  } catch (error) {
    logger.warn({ action: "BLOCKLIST_REFRESH_FAILED", error: error.message });
  }
};

const familyOf = (ip) => (net.isIP(ip) === 6 ? "ipv6" : "ipv4");

export const isBlocked = (ip) => Boolean(ip && net.isIP(ip) && entries.length && blockList.check(ip, familyOf(ip)));

const recordHit = (ip) => {
  const match = entries.find((entry) => {
    const parsed = parseBlockValue(entry.value);
    if (!parsed) return false;
    const single = new net.BlockList();
    if (parsed.prefix) single.addSubnet(parsed.address, parsed.prefix, parsed.family);
    else single.addAddress(parsed.address, parsed.family);
    return single.check(ip, familyOf(ip));
  });

  if (match) {
    BlockedIp.updateOne({ _id: match.id }, { $inc: { hits: 1 }, $set: { lastHitAt: new Date() } }).catch(() => {});
  }
};

// silent: answer as if it worked (tracker) instead of revealing the block.
export const blockGuard =
  ({ silent = false } = {}) =>
  async (req, res, next) => {
    await refresh();

    const ip = getClientIp(req);

    if (!isBlocked(ip)) return next();

    recordHit(ip);

    if (silent) return res.status(204).end();

    return res.status(403).json({ success: false, message: "Requests from your network are blocked." });
  };

/* ---------- admin ---------- */

export const listBlocked = () => BlockedIp.find(activeFilter()).sort({ createdAt: -1 }).lean();

// Temporary ban from the auto-ban system. Extends an existing temporary
// ban; never shortens or replaces a permanent manual entry.
export const banIp = async ({ value, reason, hours }) => {
  const parsed = parseBlockValue(value);
  if (!parsed) return null;

  const existing = await BlockedIp.findOne({ value: parsed.value }).lean();
  if (existing && !existing.expiresAt) return null;

  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const doc = await BlockedIp.findOneAndUpdate(
    { value: parsed.value },
    { $set: { reason, expiresAt, auto: true }, $setOnInsert: { value: parsed.value } },
    { upsert: true, returnDocument: "after" },
  ).lean();

  await refresh({ force: true });

  return doc;
};

export const addBlocked = async ({ value, reason }, requesterIp) => {
  const parsed = parseBlockValue(value);

  if (!parsed) {
    const error = new Error("Enter a valid IP address or CIDR range (e.g. 1.2.3.4 or 1.2.3.0/24)");
    error.statusCode = 400;
    throw error;
  }

  // Never let the admin lock out the network they're on right now.
  const probe = new net.BlockList();
  if (parsed.prefix) probe.addSubnet(parsed.address, parsed.prefix, parsed.family);
  else probe.addAddress(parsed.address, parsed.family);

  if (requesterIp && net.isIP(requesterIp) && probe.check(requesterIp, familyOf(requesterIp))) {
    const error = new Error("That would block the network you're using right now");
    error.statusCode = 400;
    throw error;
  }

  // A manual block is permanent — it also turns an auto-ban into one.
  const doc = await BlockedIp.findOneAndUpdate(
    { value: parsed.value },
    { $set: { reason: reason || "", expiresAt: null, auto: false }, $setOnInsert: { value: parsed.value } },
    { upsert: true, returnDocument: "after" },
  ).lean();

  await refresh({ force: true });

  return doc;
};

export const removeBlocked = async (id) => {
  const doc = await BlockedIp.findByIdAndDelete(id).lean();

  await refresh({ force: true });

  return doc;
};
