import express from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as service from "./backups.service.js";
import { BackupConfig } from "./backups.model.js";
import { DRIVE_SCOPES, oauthClient, encrypt, decrypt, revokeDrive, isDriveConfigured } from "./backups.drive.js";
import logger from "../../utils/logger.js";
import { frontendUrl } from "../../utils/frontendUrl.js";

const router = express.Router();

const handle = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: (await fn(req)) ?? null });
  } catch (error) {
    next(error);
  }
};

// Must match the redirect URI registered in Google Cloud exactly.
const redirectUriFor = (req) =>
  process.env.GOOGLE_DRIVE_REDIRECT_URI || `${req.protocol}://${req.get("host")}/api/v1/backups/google/callback`;


/* ---------- Google OAuth callback (public: Google redirects here) ---------- */

router.get("/google/callback", async (req, res) => {
  const back = (status) => res.redirect(`${frontendUrl()}/dashboard/automations?drive=${status}`);
  try {
    const { code, state, error } = req.query;
    if (error) return back("denied");
    const payload = jwt.verify(String(state || ""), process.env.ACCESS_TOKEN_SECRET);
    if (payload.purpose !== "gdrive-connect") return back("error");

    const client = oauthClient(redirectUriFor(req));
    const { tokens } = await client.getToken(String(code));
    if (!tokens.refresh_token) return back("no-refresh-token");

    let email = null;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
      email = ticket.getPayload()?.email || null;
    }

    await BackupConfig.findOneAndUpdate(
      {},
      {
        $set: {
          "google.refreshTokenEnc": encrypt(tokens.refresh_token),
          "google.email": email,
          "google.connectedAt": new Date(),
          "destinations.drive": true,
        },
      },
      { upsert: true },
    );
    return back("connected");
  } catch (err) {
    logger.error({ action: "GDRIVE_CALLBACK_FAILED", error: err.message });
    return back("error");
  }
});

/* ---------- admin ---------- */

router.use(protectAdmin);

const settingsSchema = z.object({
  schedule: z.enum(["off", "daily", "weekly"]).optional(),
  keep: z.number().int().min(1).max(100).optional(),
  destinations: z
    .object({ email: z.boolean().optional(), drive: z.boolean().optional(), driveDoc: z.boolean().optional() })
    .optional(),
});

router.get(
  "/",
  handle(async (req) => ({
    config: service.publicConfig(await service.getConfig()),
    runs: await service.listRuns(),
    redirectUri: redirectUriFor(req),
  })),
);

router.put("/settings", validate(settingsSchema), handle((req) => service.updateConfig(req.validatedData)));
router.post("/run", handle(() => service.runBackup("manual")));

router.get("/download", async (req, res, next) => {
  try {
    const backup = await service.buildBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="notes-backup-${stamp}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(JSON.stringify(backup));
  } catch (error) {
    next(error);
  }
});

router.post("/restore", handle((req) => service.restoreBackup(req.body)));

router.get(
  "/google/connect",
  handle((req) => {
    if (!isDriveConfigured()) {
      const error = new Error("Google Drive isn't set up yet — add GOOGLE_CLIENT_SECRET on the server first");
      error.statusCode = 400;
      throw error;
    }
    const state = jwt.sign({ purpose: "gdrive-connect", uid: String(req.user._id) }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "10m" });
    const url = oauthClient(redirectUriFor(req)).generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // always return a refresh token
      scope: DRIVE_SCOPES,
      state,
      include_granted_scopes: true,
    });
    return { url };
  }),
);

router.post(
  "/google/disconnect",
  handle(async () => {
    const config = await service.getConfig();
    if (config.google?.refreshTokenEnc) {
      try {
        await revokeDrive(decrypt(config.google.refreshTokenEnc));
      } catch {
        /* ignore */
      }
    }
    await BackupConfig.updateOne({}, { $set: { "google.refreshTokenEnc": null, "google.email": null, "google.connectedAt": null } });
    return service.publicConfig(await service.getConfig());
  }),
);

export default router;
