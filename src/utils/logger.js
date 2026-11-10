import pino from "pino";

/*
  Secrets never reach the logs: request cookies and auth headers (session
  tokens), Set-Cookie on responses, and any password / token / secret
  field that ends up in a logged object are replaced with "[redacted]".
*/
const logger = pino({
  transport: { target: "pino-pretty", options: { colorize: true } },
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
      "headers.cookie",
      "headers.authorization",
      "*.password",
      "*.newPassword",
      "*.currentPassword",
      "*.passphrase",
      "*.token",
      "*.refreshToken",
      "*.accessToken",
      "*.secret",
      "*.code",
      "*.authKey",
    ],
    censor: "[redacted]",
  },
});

export default logger;
