# Deployment

Production topology:

| Component | Provider |
| --- | --- |
| API | [Render](https://render.com) Web Service |
| Edge / DNS / TLS | [Cloudflare](https://cloudflare.com) |
| Database | [MongoDB Atlas](https://www.mongodb.com/atlas) |
| Redis | Any hosted Redis (e.g. [Upstash](https://upstash.com), Redis Cloud, Render Key Value) |
| Images | [Cloudinary](https://cloudinary.com) |
| Email | [Resend](https://resend.com) |
| Frontend | [Vercel](https://vercel.com) — see the frontend repo |

---

## 1. Provision the data stores

**MongoDB Atlas**

1. Create a free M0 cluster.
2. *Database Access* → add a user with read/write on the app database.
3. *Network Access* → allow Render's outbound IPs (or `0.0.0.0/0` if you accept the trade-off).
4. Copy the `mongodb+srv://…` connection string → `MONGO_URI`.

**Redis**

Create an instance and copy its URL → `REDIS_URL`. Prefer a TLS URL (`rediss://`).

---

## 2. Configure third-party services

| Service | Steps | Variables |
| --- | --- | --- |
| **Cloudinary** | Dashboard → API keys. | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |
| **Google** | Google Cloud Console → *APIs & Services → Credentials* → OAuth client ID (Web). Add your frontend origins under *Authorized JavaScript origins*. | `GOOGLE_CLIENT_ID` |
| **Resend** | Verify your sending domain, create an API key. | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |

---

## 3. Deploy to Render

1. *New → Web Service* → connect this repository.
2. Settings:

   | Field | Value |
   | --- | --- |
   | Runtime | Node |
   | Build command | `npm install` |
   | Start command | `npm start` |
   | Health check path | `/api/v1/health` |

3. Add every variable from [`.env.example`](../.env.example) under *Environment*, with:
   - `NODE_ENV=production`
   - `FRONTEND_URL=https://your-domain`
   - `WEBAUTHN_RP_ID=your-domain` (bare apex domain — covers `www` too)
4. Deploy. Render sends `SIGTERM` on redeploys; the server shuts down gracefully.

---

## 4. Put Cloudflare in front

1. Add a DNS record (e.g. `api.your-domain`) pointing to the Render service, **proxied** (orange cloud).
2. SSL/TLS mode: **Full (strict)**.

Cloudflare is not just a CDN here: the rate limiter trusts the `CF-Connecting-IP` header for client identity. If you deploy without Cloudflare, requests fall back to `req.ip`, which still works but is only as trustworthy as your proxy chain.

---

## 5. Allow your frontend origin

Origins are defined in code, not env vars. If you use a different domain, update both:

- `src/app.js` → `cors({ origin: [...] })`
- `src/modules/passkey/passkey.service.js` → `ALLOWED_ORIGINS`

---

## 6. Keep the instance warm (free tier)

Render's free tier sleeps after ~15 minutes of inactivity. [`.github/workflows/keep-alive.yml`](../.github/workflows/keep-alive.yml) pings `/api/v1/health` every 10 minutes. Update the URL in that file if your service URL differs. On a paid plan you can delete the workflow.

---

## 7. Verify

```bash
curl https://<your-api>/api/v1/health
open https://<your-api>/api-docs
```

Then sign in on the frontend with an email listed in `ADMIN_EMAILS` and confirm the dashboard loads.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Server exits with `Missing required environment variable: X` | Add `X` to the Render environment. |
| Login succeeds but subsequent requests return `401` | Cookies blocked: ensure `NODE_ENV=production` (cookies need `Secure` with `SameSite=None`) and the frontend sends credentials. |
| CORS error in the browser | Frontend origin missing from the CORS list in `src/app.js`. |
| Passkey prompt fails / "origin mismatch" | `WEBAUTHN_RP_ID` doesn't match the browser's domain, or the origin isn't in `ALLOWED_ORIGINS`. |
| Password-reset emails never arrive | `RESEND_API_KEY` unset (link is logged instead) or sending domain not verified. |
| `MongoDB Connection Failed` | Atlas IP allowlist or wrong credentials in `MONGO_URI`. |
| First request after idle is slow | Render free-tier cold start; check the keep-alive workflow is enabled. |
