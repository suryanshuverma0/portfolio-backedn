const parseAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export const isAdminEmail = (email) =>
  parseAdminEmails().includes(String(email).toLowerCase());
