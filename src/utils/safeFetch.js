import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

/* ---------------------------------------------------------------------------
   SAFE FETCH — GET a public web page for link previews without opening an
   SSRF hole:
   - http(s) only, default ports only;
   - the IP is checked when the socket connects (custom lookup), so DNS
     rebinding can't swap in an internal address after validation;
   - private, loopback, link-local, CGNAT, multicast and cloud-metadata
     ranges are refused (IPv4, IPv6 and IPv4-mapped IPv6);
   - redirects are followed manually (max 4), each hop re-checked;
   - response capped (1.5 MB) and timed out (7 s).
--------------------------------------------------------------------------- */

const MAX_BYTES = 1.5 * 1024 * 1024;
const TIMEOUT_MS = 7000;
const MAX_REDIRECTS = 4;

const blocked = new net.BlockList();
[
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].forEach(([addr, prefix]) => blocked.addSubnet(addr, prefix, "ipv4"));
[
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96],
].forEach(([addr, prefix]) => blocked.addSubnet(addr, prefix, "ipv6"));

export const isPublicAddress = (ip) => {
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return !blocked.check(mapped[1], "ipv4");
    return !blocked.check(ip, "ipv6");
  }
  return !blocked.check(ip, "ipv4");
};

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

// Socket-level lookup: refuses to connect to non-public addresses.
const safeLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options?.family || 4 }];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || !list.length) return callback(httpError("That address isn't a public website", 400));
    if (options?.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

export const validatePublicUrl = (raw) => {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw httpError("Enter a full link starting with https://");
  }
  if (!/^https?:$/.test(url.protocol)) throw httpError("Only http and https links are allowed");
  if (url.username || url.password) throw httpError("Links with credentials aren't allowed");
  if (url.port && !["80", "443"].includes(url.port)) throw httpError("Only standard web ports are allowed");
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw httpError("That address isn't a public website");
  }
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(url.hostname)) throw httpError("That address isn't a public website");
  return url;
};

const getOnce = (url) =>
  new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; PortfolioLinkPreview/1.0; +https://www.suryanshuverma.com.np)",
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
          "accept-language": "en",
        },
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url) });
        }
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated: true, url });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), url }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(httpError("The site took too long to answer", 504)));
    req.on("error", reject);
    req.end();
  });

export const safeGet = async (raw) => {
  let url = validatePublicUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await getOnce(url);
    if (!result.redirect) return result;
    url = validatePublicUrl(result.redirect.toString());
  }
  throw httpError("Too many redirects");
};
