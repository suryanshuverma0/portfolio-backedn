# API Reference

> The **interactive, always-current** reference is Swagger UI at [`/api-docs`](https://portfolio-backend-uy0a.onrender.com/api-docs), with the raw spec at [`/api-docs.json`](https://portfolio-backend-uy0a.onrender.com/api-docs.json). This page is a quick-scan index of every endpoint, its access level and its rate limit.

- [Conventions](#conventions)
- [Access levels](#access-levels)
- [System](#system)
- [Auth](#auth)
- [Google Auth](#google-auth)
- [Passkeys](#passkeys)
- [Content modules](#content-modules)
- [Profile](#profile)
- [Projects](#projects)
- [Blog](#blog)
- [Contact](#contact)
- [Analytics](#analytics)
- [Settings](#settings)
- [Integrations](#integrations)
- [Uploads](#uploads)
- [Rate limits](#rate-limits)
- [Status codes](#status-codes)

---

## Conventions

| | |
| --- | --- |
| **Base URL** | `https://portfolio-backend-uy0a.onrender.com/api/v1` (production) · `http://localhost:3000/api/v1` (local) |
| **Format** | JSON request and response bodies (`Content-Type: application/json`), except uploads (`multipart/form-data`). |
| **Auth** | `httpOnly` cookies `accessToken` and `refreshToken`. Send requests with credentials (`axios` → `withCredentials: true`, `fetch` → `credentials: "include"`). |
| **IDs** | MongoDB ObjectIds. |

**Response envelope**

```jsonc
{ "success": true,  "message": "…", "data": { } }   // success
{ "success": false, "message": "…" }                // error
```

---

## Access levels

| Badge | Meaning |
| --- | --- |
| 🌐 Public | No authentication. |
| 👤 User | Any signed-in user (`protect`). |
| 🛡️ Admin | Signed-in user with role `admin` (`protectAdmin`). Returns `401` without a session, `403` for non-admins. |

---

## System

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/` *(no prefix)* | 🌐 | API banner. |
| `GET` | `/api/v1/health` | 🌐 | Health check with process uptime. Used by uptime monitors. |
| `GET` | `/api-docs` *(no prefix)* | 🌐 | Swagger UI. |
| `GET` | `/api-docs.json` *(no prefix)* | 🌐 | OpenAPI 3.0 spec. |

---

## Auth

Prefix: `/auth`

| Method | Path | Access | Rate limit | Description |
| --- | --- | --- | --- | --- |
| `POST` | `/register` | 🌐 | 10 / h / IP | Create an account. Sets auth cookies. |
| `POST` | `/login` | 🌐 | 5 / 15 min / IP **and** / email | Email + password login. Sets auth cookies. |
| `POST` | `/forgot-password` | 🌐 | 3 / h / IP **and** / email | Emails a reset link (10-minute expiry). |
| `POST` | `/reset-password/:token` | 🌐 | 3 / h / IP | Set a new password with the emailed token. |
| `POST` | `/refresh-token` | 🌐 *(cookie)* | 30 / min / IP | Issue a new access token from the refresh cookie. |
| `POST` | `/logout` | 👤 | — | Clear cookies and invalidate the stored refresh token. |
| `GET` | `/me` | 👤 | — | Current user. |
| `GET` | `/users` | 🛡️ | — | List all users. |
| `DELETE` | `/users/:id` | 🛡️ | — | Delete a user. |

**Example — login**

```bash
curl -i -c cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'

# Reuse the session
curl -b cookies.txt http://localhost:3000/api/v1/auth/me
```

---

## Google Auth

Prefix: `/google-auth`

| Method | Path | Access | Rate limit | Description |
| --- | --- | --- | --- | --- |
| `POST` | `/login` | 🌐 | 10 / 15 min / IP | Body `{ credential }` — a Google ID token. Finds or creates the user, sets auth cookies. |

---

## Passkeys

Prefix: `/passkey` — WebAuthn via `@simplewebauthn/server`. Each flow is an `options` call (returns a challenge) followed by a `verify` call (returns the browser's signed response).

| Method | Path | Access | Rate limit | Description |
| --- | --- | --- | --- | --- |
| `POST` | `/signup/options` | 🌐 | 10 / h / IP · 5 / h / email | Start passkey-only sign-up. |
| `POST` | `/signup/verify` | 🌐 | same | Finish sign-up; sets auth cookies. |
| `POST` | `/authentication/options` | 🌐 | 20 / 15 min / IP | Start passkey login. |
| `POST` | `/authentication/verify` | 🌐 | same | Finish login; sets auth cookies. |
| `POST` | `/registration/options` | 👤 | — | Start adding a passkey to the current account. |
| `POST` | `/registration/verify` | 👤 | — | Finish adding a passkey. |
| `POST` | `/link/request` | 🌐 | 3 / h / email | Email a one-time link to add a passkey from another device. |
| `POST` | `/link/options` | 🌐 *(token)* | 20 / 15 min / IP | Start registration using the emailed token. |
| `POST` | `/link/verify` | 🌐 *(token)* | same | Finish registration; consumes the token. |
| `GET` | `/` | 👤 | — | List own passkeys. |
| `PATCH` | `/:id` | 👤 | — | Rename a passkey. |
| `DELETE` | `/:id` | 👤 | — | Revoke a passkey. |

---

## Content modules

These six modules share an identical shape:

| Module | Prefix |
| --- | --- |
| Education | `/education` |
| Experience | `/experience` |
| Services | `/services` |
| Skills | `/skill` |
| Certificates | `/certificates` |
| Stats | `/stats` |

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/public` | 🌐 | Visible items, ordered for display. |
| `GET` | `/` | 🛡️ | All items, including hidden. |
| `POST` | `/` | 🛡️ | Create. |
| `PUT` | `/:id` | 🛡️ | Update. |
| `DELETE` | `/:id` | 🛡️ | Delete. |

---

## Profile

Prefix: `/profile` — singleton.

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/public` | 🌐 | Public profile (name, headline, bio, roles, image, availability). |
| `GET` | `/` | 🛡️ | Admin view. |
| `POST` | `/` | 🛡️ | Create the profile. |
| `PUT` | `/` | 🛡️ | Update the profile. |

---

## Projects

Prefix: `/projects`

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/public` | 🌐 | Visible projects. |
| `GET` | `/public/:slug` | 🌐 | One project by slug (case-study page). |
| `GET` | `/` | 🛡️ | All projects. |
| `POST` | `/` | 🛡️ | Create. |
| `PUT` | `/:id` | 🛡️ | Update. |
| `DELETE` | `/:id` | 🛡️ | Delete. |

---

## Blog

Prefix: `/blog` — request bodies up to **2 MB** for Markdown content.

| Method | Path | Access | Rate limit | Description |
| --- | --- | --- | --- | --- |
| `GET` | `/public` | 🌐 | — | Published posts. |
| `GET` | `/public/tags` | 🌐 | — | All tags in use. |
| `GET` | `/public/:slug` | 🌐 | — | One published post. |
| `GET` | `/public/:slug/comments` | 🌐 | — | Approved comments on a post. |
| `POST` | `/public/:slug/comments` | 🌐 | 5 / 10 min / IP | Submit a comment (held for moderation). |
| `GET` | `/comments` | 🛡️ | — | All comments, for moderation. |
| `PUT` | `/comments/:id/approve` | 🛡️ | — | Approve a comment. |
| `DELETE` | `/comments/:id` | 🛡️ | — | Delete a comment. |
| `GET` | `/` | 🛡️ | — | All posts, including drafts. |
| `GET` | `/:id` | 🛡️ | — | One post by ID (for editing). |
| `POST` | `/` | 🛡️ | — | Create a post. Reading time is computed server-side. |
| `PUT` | `/:id` | 🛡️ | — | Update a post. |
| `DELETE` | `/:id` | 🛡️ | — | Delete a post. |

---

## Contact

Prefix: `/contact`

| Method | Path | Access | Rate limit | Description |
| --- | --- | --- | --- | --- |
| `POST` | `/` | 🌐 | 5 / 10 min / IP | Submit a message `{ name, email, subject, message }`. Sends an auto-acknowledgement email. |
| `GET` | `/` | 🛡️ | — | Inbox. |
| `PUT` | `/:id/read` | 🛡️ | — | Mark as read. |
| `POST` | `/:id/reply` | 🛡️ | — | Reply by email via Resend; stores the reply. |
| `DELETE` | `/:id` | 🛡️ | — | Delete. |

---

## Analytics

Prefix: `/analytics`

| Method | Path | Access | Rate limit | Description |
| --- | --- | --- | --- | --- |
| `POST` | `/track` | 🌐 | 60 / min / IP | Record a page view `{ path, referrer?, visitorId }`. Device, browser, OS and country are derived server-side. |
| `GET` | `/overview` | 🛡️ | — | Totals, trends, top pages, referrers, devices, browsers, countries. Cached 5 min. |
| `GET` | `/dashboard` | 🛡️ | — | Dashboard KPIs plus live counts (active now, unread messages, pending comments). |
| `GET` | `/recent-activity` | 🛡️ | — | Recent activity feed. Cached 2 min. |

---

## Settings

Prefix: `/settings` — singleton.

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/public` | 🌐 | SEO metadata, socials, contact info, footer, resume URL, `maintenanceMode`. |
| `GET` | `/` | 🛡️ | Full settings, including `publicAccessEnabled`. |
| `POST` | `/` | 🛡️ | Create settings. |
| `PUT` | `/` | 🛡️ | Update settings. |

---

## Integrations

Prefix: `/integrations` — usernames come from `Settings.socials.github` / `socials.leetcode`.

| Method | Path | Access | Rate limit | Description |
| --- | --- | --- | --- | --- |
| `GET` | `/github` | 🌐 | 60 / 10 min / IP | Profile, totals and top 6 non-fork repos by stars. Cached 1 h. |
| `GET` | `/leetcode` | 🌐 | same | Solved counts by difficulty, ranking. Cached 1 h. |
| `GET` | `/status` | 🌐 | same | Both at once; one failing doesn't fail the other. |

---

## Uploads

Prefix: `/upload` — `multipart/form-data`, images only, **5 MB** per file.

| Method | Path | Access | Field | Description |
| --- | --- | --- | --- | --- |
| `POST` | `/image` | 🛡️ | `image` | Upload one image. Returns `{ publicId, url }`. |
| `POST` | `/images` | 🛡️ | `images` (≤ 10) | Upload a gallery. |

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/v1/upload/image \
  -F "image=@./avatar.png"
```

---

## Rate limits

All limits use a Redis sliding window keyed on the client IP (`CF-Connecting-IP`) unless noted.

| Limiter | Limit | Window | Key |
| --- | --- | --- | --- |
| Register | 10 | 1 h | IP |
| Login | 5 | 15 min | IP |
| Login | 5 | 15 min | Email |
| Forgot / reset password | 3 | 1 h | IP |
| Forgot password | 3 | 1 h | Email |
| Refresh token | 30 | 1 min | IP |
| Google login | 10 | 15 min | IP |
| Passkey login | 20 | 15 min | IP |
| Passkey sign-up | 10 | 1 h | IP |
| Passkey sign-up | 5 | 1 h | Email |
| Passkey link request | 3 | 1 h | Email |
| Passkey link options/verify | 20 | 15 min | IP |
| Blog comment | 5 | 10 min | IP |
| Contact message | 5 | 10 min | IP |
| Analytics track | 60 | 1 min | IP |
| Integrations | 60 | 10 min | IP |

Headers on every limited route: `X-RateLimit-Limit`, `X-RateLimit-Remaining`. When blocked: HTTP `429`, `Retry-After` header, body `{ success: false, message: "Too many requests", retryAfter }`.

---

## Status codes

| Code | When |
| --- | --- |
| `200` / `201` | Success / created |
| `400` | Validation failed, invalid ObjectId, duplicate value |
| `401` | Missing, invalid or expired token |
| `403` | Authenticated but not an admin, or public access disabled |
| `404` | Resource or route not found |
| `429` | Rate limit exceeded |
| `500` | Unexpected server error |
