import Passkey from "../passkey/passkey.model.js";
import AuditLog from "../audit/audit.model.js";
import AuthSession from "../auth/session.model.js";
import BlockedIp from "../blocklist/blocklist.model.js";
import { BackupConfig } from "../backups/backups.model.js";
import { getAlertSettings } from "../alerts/alerts.service.js";
import { isPublicAccessEnabled } from "../../utils/publicAccess.js";
import { getSecuritySettings, getDailyStats } from "./security.service.js";

// ---------------------------------------------------------------------------
// Security score: a weighted checklist of the admin's setup. pass = full
// weight, warn = half, fail = none. Each item says how to fix it — either a
// page to open (`path`) or a one-click `action` the Security page performs.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const grade = (score) => (score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F");

export const getSecurityScore = async (user, currentSessionId) => {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const monthAgo = new Date(Date.now() - 30 * DAY_MS);

  const [
    passkeys,
    alertSettings,
    securitySettings,
    failedLogins,
    activeSessions,
    tokenReuse,
    publicAccess,
    backup,
    activeBans,
    spamBlocked,
    autoBans,
    rateLimited,
  ] = await Promise.all([
    Passkey.countDocuments({ user: user._id }),
    getAlertSettings({ fresh: true }),
    getSecuritySettings({ fresh: true }),
    AuditLog.countDocuments({ kind: "login", success: false, createdAt: { $gte: weekAgo } }),
    AuthSession.find({ userId: user._id, revokedAt: null, expiresAt: { $gt: new Date() } }).select("lastUsedAt").lean(),
    AuthSession.countDocuments({ userId: user._id, revokedReason: "token_reuse", revokedAt: { $gte: monthAgo } }),
    isPublicAccessEnabled(),
    BackupConfig.findOne({}).select("schedule lastRun").lean(),
    BlockedIp.countDocuments({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }),
    getDailyStats("spam"),
    getDailyStats("auto_ban"),
    getDailyStats("rate_limited"),
  ]);

  const staleSessions = activeSessions.filter((s) => Date.now() - new Date(s.lastUsedAt) > 14 * DAY_MS).length;
  const otherSessions = activeSessions.length - (currentSessionId ? 1 : 0);
  const emailReady = Boolean(process.env.RESEND_API_KEY);
  const secretsStrong =
    (process.env.ACCESS_TOKEN_SECRET || "").length >= 32 &&
    (process.env.REFRESH_TOKEN_SECRET || "").length >= 32 &&
    process.env.ACCESS_TOKEN_SECRET !== process.env.REFRESH_TOKEN_SECRET;

  const checks = [
    {
      id: "passkey",
      title: "Passkey sign-in",
      weight: 20,
      status: passkeys > 0 ? "pass" : "fail",
      detail: passkeys > 0
        ? `${passkeys} passkey${passkeys === 1 ? "" : "s"} registered — phishing-resistant sign-in.`
        : "No passkey yet. Passkeys can't be phished or guessed like a password.",
      fix: passkeys > 0 ? null : { label: "Add a passkey", action: "add_passkey" },
    },
    {
      id: "token_reuse",
      title: "No stolen sign-in tokens",
      weight: 15,
      status: tokenReuse ? "fail" : "pass",
      detail: tokenReuse
        ? `${tokenReuse} session${tokenReuse === 1 ? " was" : "s were"} ended in the last 30 days because a copied token was replayed. Consider signing out everywhere and changing your password.`
        : "No copied refresh tokens detected in the last 30 days.",
      fix: tokenReuse ? { label: "Sign out other devices", action: "revoke_others" } : null,
    },
    {
      id: "failed_logins",
      title: "Failed sign-in attempts",
      weight: 10,
      status: failedLogins === 0 ? "pass" : failedLogins < 10 ? "warn" : "fail",
      detail: failedLogins === 0
        ? "No failed sign-ins in the last 7 days."
        : `${failedLogins} failed sign-in${failedLogins === 1 ? "" : "s"} in the last 7 days.`,
      fix: failedLogins ? { label: "Review sign-ins", path: "/dashboard/audit" } : null,
    },
    {
      id: "sessions",
      title: "Signed-in devices",
      weight: 10,
      status: staleSessions > 0 || activeSessions.length > 5 ? "warn" : "pass",
      detail: staleSessions
        ? `${staleSessions} device${staleSessions === 1 ? " hasn't" : "s haven't"} been used in 2+ weeks but ${staleSessions === 1 ? "is" : "are"} still signed in.`
        : `${activeSessions.length} active session${activeSessions.length === 1 ? "" : "s"}.`,
      fix: otherSessions > 0 && (staleSessions || activeSessions.length > 5) ? { label: "Sign out other devices", action: "revoke_others" } : null,
    },
    {
      id: "auto_ban",
      title: "Auto-ban attackers",
      weight: 10,
      status: securitySettings.autoBan.enabled ? "pass" : "fail",
      detail: securitySettings.autoBan.enabled
        ? `On — ${autoBans} IP${autoBans === 1 ? "" : "s"} auto-banned in the last 30 days.`
        : "Off — repeated failed sign-ins and spam aren't blocked automatically.",
      fix: securitySettings.autoBan.enabled ? null : { label: "Turn on", action: "enable_auto_ban" },
    },
    {
      id: "spam_trap",
      title: "Spam bot trap",
      weight: 8,
      status: securitySettings.spamTrap.enabled ? "pass" : "fail",
      detail: securitySettings.spamTrap.enabled
        ? `On — ${spamBlocked} bot submission${spamBlocked === 1 ? "" : "s"} silently dropped in the last 30 days.`
        : "Off — the contact form and comments accept bot submissions.",
      fix: securitySettings.spamTrap.enabled ? null : { label: "Turn on", action: "enable_spam_trap" },
    },
    {
      id: "alerts",
      title: "Security emails",
      weight: 8,
      status: emailReady && alertSettings.email.enabled ? "pass" : "warn",
      detail: !emailReady
        ? "Email isn't configured on the server (RESEND_API_KEY) — alerts only show in the bell."
        : alertSettings.email.enabled
          ? "Auto-bans and stolen-token alerts are emailed to you."
          : "Alert emails are turned off.",
      fix: emailReady && !alertSettings.email.enabled ? { label: "Open alert settings", path: "/dashboard/automations" } : null,
    },
    {
      id: "public_access",
      title: "Sign-up restricted",
      weight: 7,
      status: publicAccess ? "warn" : "pass",
      detail: publicAccess
        ? "Anyone can create an account and sign in (non-admin). Turn off public access if you don't need it."
        : "Only your admin email(s) can sign in.",
      fix: publicAccess ? { label: "Open settings", path: "/dashboard/settings" } : null,
    },
    {
      id: "backups",
      title: "Backups",
      weight: 6,
      status: !backup || backup.schedule === "off" ? "warn" : backup.lastRun?.status === "failed" ? "fail" : "pass",
      detail: !backup || backup.schedule === "off"
        ? "Scheduled notes backups are off."
        : backup.lastRun?.status === "failed"
          ? "The last scheduled backup failed."
          : `Scheduled ${backup.schedule}${backup.lastRun?.at ? ` · last run ${new Date(backup.lastRun.at).toDateString()}` : ""}.`,
      fix: !backup || backup.schedule === "off" || backup.lastRun?.status === "failed" ? { label: "Open backups", path: "/dashboard/automations" } : null,
    },
    {
      id: "secrets",
      title: "Strong token secrets",
      weight: 4,
      status: secretsStrong ? "pass" : "fail",
      detail: secretsStrong
        ? "Signing secrets are long and distinct."
        : "ACCESS_TOKEN_SECRET / REFRESH_TOKEN_SECRET should each be 32+ random characters and different. Update them on Render (everyone will be signed out).",
      fix: null,
    },
    {
      id: "production",
      title: "Production mode",
      weight: 2,
      status: process.env.NODE_ENV === "production" ? "pass" : "warn",
      detail: process.env.NODE_ENV === "production" ? "Secure cookies and production settings are on." : `NODE_ENV is "${process.env.NODE_ENV || "unset"}".`,
      fix: null,
    },
  ];

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + c.weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0), 0);
  const score = Math.round((earned / total) * 100);

  return {
    score,
    grade: grade(score),
    checks,
    stats: {
      failedLogins7d: failedLogins,
      spamBlocked30d: spamBlocked,
      autoBans30d: autoBans,
      rateLimited30d: rateLimited,
      activeBans,
      activeSessions: activeSessions.length,
    },
  };
};
