// Public site URL without a trailing slash, for links in emails/redirects.
export const frontendUrl = () =>
  (process.env.FRONTEND_URL || "https://suryanshuverma.com.np").replace(/\/+$/, "");
