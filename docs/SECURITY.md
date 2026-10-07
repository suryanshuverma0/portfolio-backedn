# Security

This document describes the threats the API is designed against and the specific controls in place. If you discover a vulnerability, please **do not open a public issue** — email the maintainer via the contact details at [suryanshuverma.com.np](https://suryanshuverma.com.np).

---

## Threat model → controls

| Threat | Control | Where |
| --- | --- | --- |
| **Token theft via XSS** | Tokens live only in `httpOnly` cookies; never returned to JavaScript storage. | `auth.controller.js` |
| **Session replay after logout** | Refresh token is stored on the user and must match on refresh; logout clears it. | `auth.service.js` |
| **Long-lived session compromise** | Access token expires in 15 min; refresh token in 7 days. | cookie `maxAge`, JWT expiry |
| **Privilege escalation** | Role is derived server-side from `ADMIN_EMAILS` on every login — clients can't set it. Admin routes require `protect` **and** `requireAdmin`. | `adminEmails.js`, `protectAdmin.middleware.js` |
| **Credential stuffing / brute force** | Login limited per IP *and* per email (5 / 15 min), so rotating IPs doesn't help against one account. | `limiters.js` |
| **Email bombing** | Forgot-password and passkey-link requests limited per email (3 / h). | `limiters.js`, `passkey.routes.js` |
| **IP spoofing to dodge limits** | Limiter keys on Cloudflare's `CF-Connecting-IP`, which Cloudflare overwrites on every request. | `rateLimiter.middleware.js` |
| **Rate-limit race conditions** | Sliding window implemented as a single atomic Redis Lua script. | `lua/slidingWindow.lua.js` |
| **Password database leak** | Passwords hashed with bcrypt. | `auth.service.js` |
| **Reset-token database leak** | Reset tokens stored as SHA-256 hashes, single use, 10-minute expiry. | `auth.service.js` |
| **WebAuthn replay / phishing** | Challenges are single-use, stored in Redis with a 5-min TTL; `expectedOrigin` and RP ID are strictly checked. | `passkey.service.js` |
| **Unwanted sign-ups** | `publicAccessEnabled` setting closes password, Google and passkey sign-up/login to non-admins. | `publicAccess.js` |
| **Injection / malformed input** | Zod schemas validate every write route; unknown shapes are rejected. | `*.validation.js`, `validate.middleware.js` |
| **HTTP parameter pollution** | `hpp` middleware. | `app.js` |
| **Large-payload DoS** | 10 KB JSON limit globally, 2 MB only for blog posts; 5 MB per image upload, images only. | `app.js`, `upload.middleware.js` |
| **HTML injection in emails** | All visitor-supplied strings are HTML-escaped before being placed in email templates. | `utils/email.js` |
| **Clickjacking, MIME sniffing, etc.** | Helmet's default headers and strict CSP (relaxed only for `/api-docs`). | `app.js` |
| **Cross-origin abuse** | CORS restricted to the production domains and `localhost:5173`, with credentials. | `app.js` |
| **Information leakage** | Stack traces omitted from error responses in production. | `error.middleware.js` |
| **Misconfiguration** | Server refuses to start with missing required secrets. | `config/env.js` |

---

## Operational checklist

Before deploying to production:

- [ ] `NODE_ENV=production` (enables `Secure` cookies and hides stack traces).
- [ ] `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` are long, random and **different**.
- [ ] `ADMIN_EMAILS` contains only addresses you control.
- [ ] `WEBAUTHN_RP_ID` matches the production domain.
- [ ] The frontend domain is listed in the CORS origins in `src/app.js` and `ALLOWED_ORIGINS` in `src/modules/passkey/passkey.service.js`.
- [ ] The API is reached through Cloudflare, so `CF-Connecting-IP` is trustworthy.
- [ ] MongoDB Atlas network access is restricted and the database user has least privilege.
- [ ] Redis requires authentication / TLS (`rediss://`).
- [ ] `.env` is never committed (it is in `.gitignore`).
