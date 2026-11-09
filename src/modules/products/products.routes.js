import express from "express";
import mongoose from "mongoose";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";
import { safeGet } from "../../utils/safeFetch.js";

/* ---------------------------------------------------------------------------
   PRODUCTS — things you ship (websites, SaaS, mobile apps), separate from
   portfolio projects. Paste a link and the preview endpoint reads the
   page's title, description, icon, social image and theme colour (and the
   App Store's public lookup API for iOS apps); the homepage screenshot is
   rendered on the fly by the frontend, so nothing has to be uploaded.
--------------------------------------------------------------------------- */

const productSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, enum: ["web", "mobile", "desktop", "extension", "api"], default: "web" },
    url: { type: String, default: "" },
    tagline: { type: String, maxlength: 160, default: "" },
    description: { type: String, maxlength: 2000, default: "" },
    status: { type: String, maxlength: 40, default: "Live" },
    category: { type: String, maxlength: 60, default: "" },
    icon: { type: String, default: "" },
    image: { type: String, default: "" },
    screenshots: { type: [String], default: [] },
    accent: { type: String, default: "" },
    links: {
      website: { type: String, default: "" },
      playStore: { type: String, default: "" },
      appStore: { type: String, default: "" },
      github: { type: String, default: "" },
    },
    stats: { type: [new mongoose.Schema({ label: String, value: String }, { _id: false })], default: [] },
    technologies: { type: [String], default: [] },
    rating: { type: Number, default: null },
    launchedAt: { type: String, default: "" },
    useScreenshot: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const Product = mongoose.models.Product || mongoose.model("Product", productSchema);

/* ---------- validation ---------- */

const str = (max) => z.string().trim().max(max);
const httpUrl = z.union([z.literal(""), z.string().trim().max(1000).url().refine((u) => /^https?:\/\//i.test(u), "Links must start with http(s)://")]);

const productInput = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/),
  name: str(120).min(1, "Add a name"),
  kind: z.enum(["web", "mobile", "desktop", "extension", "api"]).optional(),
  url: httpUrl.optional(),
  tagline: str(160).optional(),
  description: str(2000).optional(),
  status: str(40).optional(),
  category: str(60).optional(),
  icon: httpUrl.optional(),
  image: httpUrl.optional(),
  screenshots: z.array(httpUrl).max(10).optional(),
  accent: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).optional(),
  links: z.object({ website: httpUrl.optional(), playStore: httpUrl.optional(), appStore: httpUrl.optional(), github: httpUrl.optional() }).optional(),
  stats: z.array(z.object({ label: str(60), value: str(40) })).max(6).optional(),
  technologies: z.array(str(50)).max(30).optional(),
  rating: z.union([z.null(), z.number().min(0).max(5)]).optional(),
  launchedAt: str(40).optional(),
  useScreenshot: z.boolean().optional(),
  featured: z.boolean().optional(),
  order: z.number().int().min(0).max(10000).optional(),
  isVisible: z.boolean().optional(),
});

/* ---------- link preview ---------- */

const decode = (s = "") =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();

const metaContent = (html, names) => {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decode(content);
  }
  return "";
};

const absolute = (href, base) => {
  try {
    const u = new URL(decode(href), base);
    return /^https?:$/.test(u.protocol) ? u.toString() : "";
  } catch {
    return "";
  }
};

const findIcon = (html, base) => {
  const links = [...html.matchAll(/<link[^>]+>/gi)].map((m) => m[0]);
  const score = (tag) => (/apple-touch-icon/i.test(tag) ? 3 : /rel=["'][^"']*icon[^"']*["']/i.test(tag) ? (/(192|180|512)/.test(tag) ? 2 : 1) : 0);
  const best = links.filter(score).sort((a, b) => score(b) - score(a))[0];
  const href = best?.match(/href=["']([^"']+)["']/i)?.[1];
  return href ? absolute(href, base) : absolute("/favicon.ico", base);
};

const appStoreId = (url) => url.match(/apps\.apple\.com\/.*\/id(\d+)/i)?.[1] || null;
const isPlayStore = (url) => /play\.google\.com\/store\/apps\/details/i.test(url);

const previewFor = async (rawUrl) => {
  // iOS: Apple's public lookup API gives clean structured data.
  const iosId = appStoreId(rawUrl);
  if (iosId) {
    const res = await safeGet(`https://itunes.apple.com/lookup?id=${iosId}`);
    const app = JSON.parse(res.body)?.results?.[0];
    if (!app) throw Object.assign(new Error("App not found on the App Store"), { statusCode: 404 });
    return {
      kind: "mobile",
      name: app.trackName,
      tagline: (app.description || "").split(/\n|\.\s/)[0].slice(0, 150),
      description: (app.description || "").slice(0, 1500),
      icon: app.artworkUrl512 || app.artworkUrl100 || "",
      image: "",
      screenshots: (app.screenshotUrls || []).slice(0, 6),
      rating: app.averageUserRating ? Math.round(app.averageUserRating * 10) / 10 : null,
      category: app.primaryGenreName || "",
      links: { appStore: app.trackViewUrl },
      useScreenshot: false,
    };
  }

  const res = await safeGet(rawUrl);
  if (res.status >= 400) throw Object.assign(new Error(`The site answered ${res.status}`), { statusCode: 422 });
  const html = res.body;
  const base = res.url.toString();

  const title = metaContent(html, ["og:title", "twitter:title"]) || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "");
  const description = metaContent(html, ["og:description", "description", "twitter:description"]);
  const image = absolute(metaContent(html, ["og:image", "og:image:url", "twitter:image"]), base);
  const siteName = metaContent(html, ["og:site_name", "application-name", "apple-mobile-web-app-title"]);
  const theme = metaContent(html, ["theme-color"]);

  if (isPlayStore(rawUrl)) {
    return {
      kind: "mobile",
      name: title.replace(/\s*-\s*Apps on Google Play$/i, ""),
      tagline: description.slice(0, 150),
      description,
      icon: image,
      image: "",
      screenshots: [],
      links: { playStore: rawUrl },
      useScreenshot: false,
    };
  }

  const name = siteName || title.split(/\s[|–—-]\s/)[0] || new URL(base).hostname.replace(/^www\./, "");
  return {
    kind: "web",
    name: name.slice(0, 120),
    tagline: (title !== name ? title : description).slice(0, 150),
    description: description.slice(0, 1500),
    icon: findIcon(html, base),
    image,
    accent: /^#[0-9a-f]{6}$/i.test(theme) ? theme.toLowerCase() : "",
    links: { website: base },
    url: base,
    useScreenshot: true,
  };
};

/* ---------- routes ---------- */

const router = express.Router();
const previewLimiter = slidingWindowLimiter({ prefix: "products-preview", limit: 30, windowInSeconds: 10 * 60, countsAsOffense: false });

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const handle = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req, res) });
  } catch (error) {
    if (error?.code === 11000) return next(httpError("Another product already uses that link name (slug)", 409));
    next(error);
  }
};
const checkId = (id) => {
  if (!/^[a-f\d]{24}$/i.test(id)) throw httpError("Invalid id", 400);
  return id;
};

router.get(
  "/public",
  handle(async (req, res) => {
    res.set("Cache-Control", "public, max-age=60");
    return Product.find({ isVisible: true }).sort({ order: 1, createdAt: -1 }).lean();
  }),
);

router.use(protectAdmin);

router.post(
  "/preview",
  previewLimiter,
  validate(z.object({ url: z.string().trim().min(4).max(1000) })),
  handle(async (req) => {
    try {
      return await previewFor(req.validatedData.url);
    } catch (error) {
      if (error.statusCode) throw error;
      throw httpError(`Couldn't read that page (${error.code || error.message}). You can still fill the details in by hand.`, 422);
    }
  }),
);

router.get("/", handle(() => Product.find({}).sort({ order: 1, createdAt: -1 }).lean()));

router.post(
  "/",
  validate(productInput),
  handle(async (req) => (await Product.create({ order: await Product.countDocuments({}), ...req.validatedData })).toObject()),
);

router.put(
  "/reorder",
  validate(z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(200) })),
  handle(async (req) => {
    await Promise.all(req.validatedData.ids.map((id, order) => Product.updateOne({ _id: id }, { $set: { order } })));
    return true;
  }),
);

router.put(
  "/:id",
  validate(productInput.partial()),
  handle(async (req) => {
    const doc = await Product.findByIdAndUpdate(checkId(req.params.id), { $set: req.validatedData }, { returnDocument: "after", runValidators: true }).lean();
    if (!doc) throw httpError("Product not found", 404);
    return doc;
  }),
);

router.delete(
  "/:id",
  handle(async (req) => {
    const doc = await Product.findByIdAndDelete(checkId(req.params.id)).lean();
    if (!doc) throw httpError("Product not found", 404);
    return true;
  }),
);

export { previewFor };
export default router;
