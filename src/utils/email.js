import { Resend } from "resend";
import logger from "./logger.js";

// User-supplied strings (names, message bodies) get interpolated into
// these HTML emails — escape before embedding, same as rendering to a
// browser, rather than trusting visitor input isn't going to be "<b>" etc.
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

let resendClient = null;

// Lazy singleton: don't throw at import/boot time if RESEND_API_KEY isn't
// set yet — only when something actually tries to send an email.
const getResendClient = () => {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }

  return resendClient;
};

export const sendPasswordResetEmail = async (toEmail, resetUrl) => {
  if (!process.env.RESEND_API_KEY) {
    // No email provider configured yet (e.g. local dev before RESEND_API_KEY
    // is set) — log the link instead of hard-failing the request, so the
    // reset flow is still testable without a real inbox.
    logger.warn(
      `RESEND_API_KEY not set — password reset link for ${toEmail}: ${resetUrl}`,
    );
    return;
  }

  const client = getResendClient();

  const fromAddress =
    process.env.RESEND_FROM_EMAIL || "Portfolio <onboarding@resend.dev>";

  await client.emails.send({
    from: fromAddress,
    to: toEmail,
    subject: "Reset your password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="margin-bottom: 8px;">Reset your password</h2>
        <p style="color: #444; line-height: 1.5;">
          We received a request to reset the password for this account.
          This link expires in 10 minutes.
        </p>
        <p style="margin: 24px 0;">
          <a
            href="${resetUrl}"
            style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;"
          >
            Reset password
          </a>
        </p>
        <p style="color: #888; font-size: 13px; line-height: 1.5;">
          If you didn't request this, you can safely ignore this email —
          your password won't be changed.
        </p>
      </div>
    `,
  });
};

export const sendPasskeyLinkEmail = async (toEmail, linkUrl) => {
  if (!process.env.RESEND_API_KEY) {
    logger.warn(
      `RESEND_API_KEY not set — passkey link for ${toEmail}: ${linkUrl}`,
    );
    return;
  }

  const client = getResendClient();

  const fromAddress =
    process.env.RESEND_FROM_EMAIL || "Portfolio <onboarding@resend.dev>";

  await client.emails.send({
    from: fromAddress,
    to: toEmail,
    subject: "Add this device as a passkey",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="margin-bottom: 8px;">Add this device as a passkey</h2>
        <p style="color: #444; line-height: 1.5;">
          Open this link on the device you want to sign in with next time —
          it'll let you register it as a passkey for this account. This
          link expires in 10 minutes and can only be used once.
        </p>
        <p style="margin: 24px 0;">
          <a
            href="${linkUrl}"
            style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;"
          >
            Add this device
          </a>
        </p>
        <p style="color: #888; font-size: 13px; line-height: 1.5;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
};

export const sendContactAcknowledgmentEmail = async (toEmail, name) => {
  if (!process.env.RESEND_API_KEY) {
    logger.warn(
      `RESEND_API_KEY not set — skipping contact acknowledgment email for ${toEmail}`,
    );
    return;
  }

  const client = getResendClient();

  const fromAddress =
    process.env.RESEND_FROM_EMAIL || "Portfolio <onboarding@resend.dev>";

  await client.emails.send({
    from: fromAddress,
    to: toEmail,
    subject: "Thanks for reaching out",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="margin-bottom: 8px;">Thanks for reaching out${name ? `, ${escapeHtml(name)}` : ""}</h2>
        <p style="color: #444; line-height: 1.5;">
          I've received your message and will get back to you as soon as
          I can.
        </p>
        <p style="color: #444; line-height: 1.5;">
          — Suryanshu
        </p>
      </div>
    `,
  });
};

/*
  Unlike the two functions above (best-effort background emails, safe to
  silently skip if Resend isn't configured yet), a reply is a deliberate
  admin action expecting a real result — so this one throws instead of
  quietly no-opping, letting the admin panel show a real error rather
  than a false "sent" confirmation.
*/
export const sendContactReplyEmail = async ({
  toEmail,
  toName,
  subject,
  replyMessage,
  originalMessage,
  replyToEmail,
}) => {
  if (!process.env.RESEND_API_KEY) {
    throw new Error(
      "Email sending isn't configured yet (RESEND_API_KEY is not set)",
    );
  }

  const client = getResendClient();

  const fromAddress =
    process.env.RESEND_FROM_EMAIL || "Portfolio <onboarding@resend.dev>";

  await client.emails.send({
    from: fromAddress,
    to: toEmail,
    ...(replyToEmail ? { replyTo: replyToEmail } : {}),
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <p style="color: #444; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(
          replyMessage,
        )}</p>
        <p style="color: #444; line-height: 1.5; margin-top: 24px;">
          — Suryanshu
        </p>
        ${
          originalMessage
            ? `
              <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5;">
                <p style="color: #999; font-size: 12px; margin-bottom: 6px;">
                  ${toName ? `${escapeHtml(toName)} ` : ""}wrote:
                </p>
                <p style="color: #999; font-size: 13px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(
                  originalMessage,
                )}</p>
              </div>
            `
            : ""
        }
      </div>
    `,
  });
};
