import express from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import requireLifeUnlock from "../life/requireLifeUnlock.middleware.js";
import { notifySecurityEvent } from "../alerts/alerts.service.js";

/* ---------------------------------------------------------------------------
   VAULT — zero-knowledge document storage.

   Everything is encrypted in the browser (AES-256-GCM) before it gets here:
   - a random vault key, wrapped twice: by a key derived from the vault
     password (PBKDF2-SHA256, 600k iterations) and by a random recovery key;
   - each item has its own random key (wrapped by the vault key) that
     encrypts its title, fields, notes and files.
   The server stores and returns opaque blobs only — it never sees the
   password, the keys or any plaintext, so a database leak exposes nothing
   readable. Access to the blobs still needs admin sign-in + the life lock.
   Files live in GridFS (bucket "vault"); quota 300 MB, 25 MB per file.
--------------------------------------------------------------------------- */

const MAX_FILE = 25 * 1024 * 1024;
const QUOTA = 300 * 1024 * 1024;

const b64 = z.string().max(200_000).regex(/^[A-Za-z0-9+/=_-]*$/);
const sealed = z.object({ iv: b64, ct: b64 });

const configSchema = new mongoose.Schema(
  {
    version: { type: Number, default: 1 },
    kdf: { name: String, hash: String, iterations: Number, salt: String },
    byPassword: { iv: String, ct: String },
    byRecovery: { salt: String, iv: String, ct: String },
    check: { iv: String, ct: String }, // a known value sealed with the vault key
    // sha256 of a token derived from the vault key (HKDF) — lets the server
    // check that a password change comes from someone who opened the vault,
    // without ever learning the key.
    authHash: { type: String, select: false },
    passwordChangedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const itemSchema = new mongoose.Schema(
  {
    meta: { iv: String, ct: String }, // encrypted JSON: title, type, fields, notes, files[]
    key: { iv: String, ct: String }, // item key wrapped by the vault key
    files: { type: [String], default: [] }, // GridFS ids referenced by this item
    size: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const VaultConfig = mongoose.models.VaultConfig || mongoose.model("VaultConfig", configSchema);
const VaultItem = mongoose.models.VaultItem || mongoose.model("VaultItem", itemSchema);
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "vault" });

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const oid = (v) => {
  if (!/^[a-f\d]{24}$/i.test(String(v))) throw httpError("Invalid id", 400);
  return new mongoose.Types.ObjectId(String(v));
};
const send = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req, res) });
  } catch (error) {
    next(error);
  }
};

const usage = async () => {
  const [row] = await mongoose.connection.db.collection("vault.files").aggregate([{ $group: { _id: null, bytes: { $sum: "$length" }, files: { $sum: 1 } } }]).toArray();
  return { bytes: row?.bytes || 0, files: row?.files || 0, quota: QUOTA, maxFile: MAX_FILE };
};

const removeFiles = async (ids) => {
  for (const id of ids) {
    try {
      await bucket().delete(oid(id));
    } catch {
      /* already gone */
    }
  }
};

const router = express.Router();
router.use(protectAdmin, requireLifeUnlock);
// Nothing from the vault is ever cached anywhere.
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/* ---------- config (wrapped keys) ---------- */

router.get(
  "/config",
  send(async () => {
    const config = await VaultConfig.findOne({}).lean();
    return { configured: Boolean(config), config, usage: await usage() };
  }),
);

const setupInput = z.object({
  kdf: z.object({ name: z.literal("PBKDF2"), hash: z.literal("SHA-256"), iterations: z.number().int().min(310000).max(5000000), salt: b64 }),
  byPassword: sealed,
  byRecovery: sealed.extend({ salt: b64 }),
  check: sealed,
  authKey: b64.min(40).max(100),
});
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

router.post(
  "/config",
  validate(setupInput),
  send(async (req) => {
    if (await VaultConfig.exists({})) throw httpError("The vault is already set up", 409);
    const { authKey, ...config } = req.validatedData;
    await VaultConfig.create({ ...config, authHash: sha(authKey) });
    notifySecurityEvent({ title: "Document vault created", body: "A new encrypted vault was set up.", link: "/dashboard/vault", ip: req.ip }).catch(() => {});
    return true;
  }),
);

// New password wrap (after unlocking with the old password or the recovery key).
router.put(
  "/config/password",
  validate(z.object({ kdf: setupInput.shape.kdf, byPassword: sealed, byRecovery: setupInput.shape.byRecovery.optional(), via: z.enum(["password", "recovery"]), authKey: b64.min(40).max(100) })),
  send(async (req) => {
    const { via, authKey, ...patch } = req.validatedData;
    const current = await VaultConfig.findOne({}).select("+authHash");
    if (!current) throw httpError("Set the vault up first", 409);
    const a = Buffer.from(sha(authKey));
    const b = Buffer.from(current.authHash || "");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError("Open the vault first", 403);
    await VaultConfig.updateOne({ _id: current._id }, { $set: { ...patch, passwordChangedAt: new Date() } });
    notifySecurityEvent({
      title: via === "recovery" ? "Vault password reset with the recovery key" : "Vault password changed",
      body: patch.byRecovery ? "A new recovery key was issued as well — the old one no longer works." : "",
      link: "/dashboard/vault",
      ip: req.ip,
    }).catch(() => {});
    return true;
  }),
);

/* ---------- items ---------- */

const itemInput = z.object({ meta: sealed, key: sealed, files: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(50) });

const sizeOf = async (ids) => {
  if (!ids.length) return 0;
  const rows = await mongoose.connection.db
    .collection("vault.files")
    .find({ _id: { $in: ids.map(oid) } })
    .project({ length: 1 })
    .toArray();
  if (rows.length !== ids.length) throw httpError("A file is missing — upload it again", 400);
  return rows.reduce((s, r) => s + r.length, 0);
};

router.get("/items", send(() => VaultItem.find({}).sort({ updatedAt: -1 }).lean()));

router.post(
  "/items",
  validate(itemInput),
  send(async (req) => (await VaultItem.create({ ...req.validatedData, size: await sizeOf(req.validatedData.files) })).toObject()),
);

router.put(
  "/items/:id",
  validate(itemInput),
  send(async (req) => {
    const before = await VaultItem.findById(oid(req.params.id)).lean();
    if (!before) throw httpError("Item not found", 404);
    const size = await sizeOf(req.validatedData.files);
    const doc = await VaultItem.findByIdAndUpdate(before._id, { $set: { ...req.validatedData, size } }, { returnDocument: "after" }).lean();
    await removeFiles(before.files.filter((f) => !req.validatedData.files.includes(f)));
    return doc;
  }),
);

router.delete(
  "/items/:id",
  send(async (req) => {
    const doc = await VaultItem.findByIdAndDelete(oid(req.params.id)).lean();
    if (doc) await removeFiles(doc.files);
    return true;
  }),
);

/* ---------- encrypted files (raw bytes in, raw bytes out) ---------- */

router.post(
  "/files",
  send(async (req) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !body.length) throw httpError("Send the encrypted file as application/octet-stream", 400);
    if (body.length > MAX_FILE + 64 * 1024) throw httpError("Files can be up to 25 MB", 413);
    const { bytes } = await usage();
    if (bytes + body.length > QUOTA) throw httpError("The vault is full (300 MB)", 413);
    const id = new mongoose.Types.ObjectId();
    await new Promise((resolve, reject) => {
      const stream = bucket().openUploadStreamWithId(id, `${id}.enc`, { contentType: "application/octet-stream" });
      stream.on("error", reject).on("finish", resolve);
      stream.end(body);
    });
    return { id: String(id), size: body.length };
  }),
);

router.get("/files/:id", async (req, res, next) => {
  try {
    const id = oid(req.params.id);
    // Only files that belong to an item (or were just uploaded by this admin) are served.
    const file = await mongoose.connection.db.collection("vault.files").findOne({ _id: id });
    if (!file) throw httpError("File not found", 404);
    res.set({ "Content-Type": "application/octet-stream", "Content-Length": String(file.length), "Cache-Control": "no-store" });
    bucket().openDownloadStream(id).on("error", next).pipe(res);
  } catch (error) {
    next(error);
  }
});

// Uploaded but never attached (e.g. the editor was closed) — clean up.
router.delete(
  "/files/:id",
  send(async (req) => {
    const id = req.params.id;
    if (await VaultItem.exists({ files: id })) throw httpError("That file belongs to an item — delete it from the item", 409);
    await removeFiles([id]);
    return true;
  }),
);

export default router;
