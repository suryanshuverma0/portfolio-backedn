import { Resend } from "resend";
import logger from "./logger.js";

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
