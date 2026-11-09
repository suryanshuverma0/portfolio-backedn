import crypto from "crypto";

/* ---------------------------------------------------------------------------
   SECRET BOX — AES-256-GCM encryption for small secrets stored in the
   database (e.g. the MFA seed), so a database leak alone doesn't reveal
   them. Key: SECRET_BOX_KEY (64 hex chars) if set, otherwise derived from
   ACCESS_TOKEN_SECRET with HKDF. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
--------------------------------------------------------------------------- */

let cachedKey = null;

const key = () => {
  if (cachedKey) return cachedKey;
  const explicit = process.env.SECRET_BOX_KEY;
  if (explicit && /^[0-9a-f]{64}$/i.test(explicit)) {
    cachedKey = Buffer.from(explicit, "hex");
  } else {
    const base = process.env.ACCESS_TOKEN_SECRET;
    if (!base) throw new Error("No key material for secret box");
    cachedKey = Buffer.from(crypto.hkdfSync("sha256", base, "portfolio-secret-box", "v1", 32));
  }
  return cachedKey;
};

export const seal = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
};

export const open = (sealed) => {
  const [version, iv, tag, data] = String(sealed || "").split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Malformed secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
};
