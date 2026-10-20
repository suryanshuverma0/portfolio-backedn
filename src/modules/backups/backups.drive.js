import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";

// ---------------------------------------------------------------------------
// Minimal Google Drive client (REST) using the `drive.file` scope — the app
// can only see files it created itself, never the rest of your Drive.
// ---------------------------------------------------------------------------

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
const FOLDER_NAME = "Portfolio Notes Backups";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export const isDriveConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const oauthClient = (redirectUri) =>
  new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);

/* ---------- refresh token encryption (AES-256-GCM) ---------- */

const key = () =>
  crypto
    .createHash("sha256")
    .update(process.env.BACKUP_ENCRYPTION_KEY || process.env.REFRESH_TOKEN_SECRET || "portfolio-backups")
    .digest();

export const encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
};

export const decrypt = (payload) => {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
};

/* ---------- REST helpers ---------- */

const accessTokenFor = async (refreshToken) => {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Google didn't return an access token — reconnect Google Drive");
  return token;
};

const driveFetch = async (token, url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Drive ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.status === 204 ? null : response.json();
};

const ensureFolder = async (token, folderId) => {
  if (folderId) {
    try {
      const folder = await driveFetch(token, `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,trashed`);
      if (!folder.trashed) return folderId;
    } catch {
      /* gone — create a new one */
    }
  }
  const created = await driveFetch(token, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { portfolioBackup: "folder" } }),
  });
  return created.id;
};

const multipartUpload = async (token, metadata, body, contentType) => {
  const boundary = `----portfolio${crypto.randomBytes(8).toString("hex")}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.isBuffer(body) ? body : Buffer.from(body),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return driveFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: payload,
  });
};

const pruneOld = async (token, folderId, kind, keep) => {
  const q = encodeURIComponent(
    `'${folderId}' in parents and trashed = false and appProperties has { key='portfolioBackup' and value='${kind}' }`,
  );
  const list = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id)&pageSize=200`);
  const stale = (list.files || []).slice(keep);
  for (const file of stale) {
    // eslint-disable-next-line no-await-in-loop
    await driveFetch(token, `https://www.googleapis.com/drive/v3/files/${file.id}`, { method: "DELETE" });
  }
  return stale.length;
};

// Uploads the JSON backup (+ optional readable Google Doc). Returns the
// folder id (it may have been re-created) and uploaded file links.
export const uploadToDrive = async ({ refreshToken, folderId, keep, stamp, json, html, withDoc }) => {
  const token = await accessTokenFor(refreshToken);
  const folder = await ensureFolder(token, folderId);

  const file = await multipartUpload(
    token,
    { name: `notes-backup-${stamp}.json`, parents: [folder], appProperties: { portfolioBackup: "json" } },
    json,
    "application/json",
  );

  let doc = null;
  if (withDoc && html) {
    // Drive converts the HTML into an editable Google Doc.
    doc = await multipartUpload(
      token,
      {
        name: `Notes — ${stamp}`,
        parents: [folder],
        mimeType: "application/vnd.google-apps.document",
        appProperties: { portfolioBackup: "doc" },
      },
      html,
      "text/html",
    );
  }

  await pruneOld(token, folder, "json", keep);
  if (withDoc) await pruneOld(token, folder, "doc", keep);

  return { folderId: folder, file, doc };
};

export const revokeDrive = async (refreshToken) => {
  try {
    await oauthClient().revokeToken(refreshToken);
  } catch {
    /* already revoked */
  }
};
