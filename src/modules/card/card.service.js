import Card, { SECTION_KEYS } from "./card.model.js";
import Profile from "../profile/profile.model.js";
import Settings from "../settings/settings.model.js";
import Project from "../projects/project.model.js";
import Certificate from "../certificates/certificate.model.js";
import { getOrSetCache } from "../../utils/cache.js";
import redis from "../../config/redis.js";
import logger from "../../utils/logger.js";

const PUBLIC_CACHE_KEY = "card:public:v1";
const VCARD_CACHE_KEY = "card:vcard:v1";

const DEFAULT_WEBSITE = "https://suryanshuverma.com.np";

const SOCIAL_LABELS = {
  linkedin: "LinkedIn",
  github: "GitHub",
  leetcode: "LeetCode",
  twitter: "X (Twitter)",
  instagram: "Instagram",
  facebook: "Facebook",
  website: "Portfolio",
  resume: "Resume",
  calendar: "Book a call",
  custom: "Link",
};

const ALL_SECTIONS_ON = Object.fromEntries(SECTION_KEYS.map((key) => [key, true]));

const clearCardCache = async () => {
  try {
    await redis.del([PUBLIC_CACHE_KEY, VCARD_CACHE_KEY]);
  } catch (error) {
    logger.warn({ action: "CARD_CACHE_CLEAR_FAILED", error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Resolution: saved card fields win; anything empty falls back to the
// existing Profile / Settings / Projects data.
// ---------------------------------------------------------------------------

const buildDefaults = async () => {
  const [profile, settings, projectCount, certificateCount, featured] = await Promise.all([
    Profile.findOne({}).lean(),
    Settings.findOne({}).lean(),
    Project.countDocuments({ isVisible: { $ne: false } }),
    Certificate.countDocuments({}),
    Project.find({ isVisible: { $ne: false }, featured: true })
      .sort({ order: 1, createdAt: -1 })
      .limit(3)
      .select("_id")
      .lean(),
  ]);

  const socials = settings?.socials || {};
  const website = process.env.FRONTEND_URL || DEFAULT_WEBSITE;

  const links = [
    ...["linkedin", "github", "leetcode", "twitter", "instagram", "facebook"]
      .filter((kind) => socials[kind])
      .map((kind) => ({
        kind,
        label: SOCIAL_LABELS[kind],
        url: socials[kind],
        // Keep the professional ones on by default.
        isVisible: ["linkedin", "github"].includes(kind),
      })),
    ...(settings?.resumeUrl
      ? [{ kind: "resume", label: "Resume", url: settings.resumeUrl, isVisible: false }]
      : []),
  ];

  const stats = [
    projectCount > 0 && { value: `${projectCount}+`, label: "Projects" },
    certificateCount > 0 && { value: `${certificateCount}`, label: "Certifications" },
  ].filter(Boolean);

  return {
    isEnabled: true,
    displayName: profile?.name || settings?.footerName || "",
    title: profile?.roles?.[0] || settings?.footerRole || "",
    company: "",
    tagline: profile?.headline || "",
    location: "",
    availability: profile?.availability || "",
    photo: profile?.image || null,
    email: settings?.contactEmail || "",
    phone: settings?.contactPhone || "",
    whatsapp: settings?.contactPhone || "",
    website,
    links,
    stats,
    skills: [],
    featuredProjects: featured.map((p) => String(p._id)),
    accentColor: "#2a78d6",
    sections: ALL_SECTIONS_ON,
  };
};

const resolveCard = async () => {
  const [saved, defaults] = await Promise.all([Card.findOne({}).lean(), buildDefaults()]);

  if (!saved) return { ...defaults, isSaved: false };

  const pick = (key) => {
    const value = saved[key];
    if (value === undefined || value === null || value === "") return defaults[key];
    return value;
  };

  return {
    isSaved: true,
    isEnabled: saved.isEnabled !== false,
    displayName: pick("displayName"),
    title: pick("title"),
    company: saved.company || "",
    tagline: pick("tagline"),
    location: saved.location || "",
    availability: pick("availability"),
    photo: saved.photo || defaults.photo,
    email: pick("email"),
    phone: pick("phone"),
    whatsapp: saved.whatsapp ?? defaults.whatsapp,
    website: pick("website"),
    // Arrays: an explicitly saved (even empty) list is respected.
    links: saved.links ?? defaults.links,
    stats: saved.stats ?? defaults.stats,
    skills: saved.skills ?? defaults.skills,
    featuredProjects: (saved.featuredProjects?.length ? saved.featuredProjects : defaults.featuredProjects).map(String),
    accentColor: saved.accentColor || defaults.accentColor,
    sections: { ...ALL_SECTIONS_ON, ...(saved.sections || {}) },
  };
};

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const getCardForAdmin = async () => resolveCard();

export const updateCard = async (userId, data) => {
  // Merge visibility toggles key by key so a partial update never resets
  // the other switches back to their defaults.
  const { sections, ...rest } = data;
  const update = { ...rest };
  Object.entries(sections || {}).forEach(([key, value]) => {
    update[`sections.${key}`] = value;
  });

  await Card.findOneAndUpdate(
    {},
    { $set: update, $setOnInsert: { user: userId } },
    { upsert: true, runValidators: true },
  );

  await clearCardCache();

  return resolveCard();
};

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export const getPublicCard = async () =>
  getOrSetCache(PUBLIC_CACHE_KEY, 300, async () => {
    const card = await resolveCard();

    if (!card.isEnabled) return null;

    // Hidden parts are dropped here, so they never reach the browser or the
    // vCard (e.g. a hidden phone number isn't downloadable either).
    const show = card.sections;

    const projects = show.projects && card.featuredProjects.length
      ? await Project.find({ _id: { $in: card.featuredProjects }, isVisible: { $ne: false } })
          .select("title slug description thumbnail technologies category")
          .lean()
      : [];
    const projectMap = new Map(projects.map((p) => [String(p._id), p]));

    return {
      displayName: card.displayName,
      title: show.title ? card.title : "",
      company: show.company ? card.company : "",
      tagline: show.tagline ? card.tagline : "",
      location: show.location ? card.location : "",
      availability: show.availability ? card.availability : "",
      photoUrl: show.photo ? card.photo?.url || null : null,
      email: show.email ? card.email : "",
      phone: show.call ? card.phone : "",
      whatsapp: show.whatsapp ? card.whatsapp : "",
      website: card.website,
      links: (show.links ? card.links : [])
        .filter((link) => link.isVisible !== false)
        .map((link) => ({
          kind: link.kind,
          label: link.label || SOCIAL_LABELS[link.kind] || "Link",
          url: link.url,
        })),
      stats: show.stats ? card.stats : [],
      skills: show.skills ? card.skills : [],
      featuredProjects: card.featuredProjects
        .map((id) => projectMap.get(id))
        .filter(Boolean)
        .map((p) => ({
          title: p.title,
          slug: p.slug,
          category: p.category,
          summary: (p.description || "").replace(/\s+/g, " ").slice(0, 140),
          thumbnailUrl: p.thumbnail?.url || null,
          technologies: (p.technologies || []).slice(0, 4),
        })),
      accentColor: card.accentColor,
      sections: {
        saveContact: show.saveContact,
        portfolioButton: show.portfolioButton,
        share: show.share,
        qr: show.qr,
      },
    };
  });

// ---------------------------------------------------------------------------
// vCard (Save contact)
// ---------------------------------------------------------------------------

const escapeVCard = (value = "") =>
  String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

// RFC 6350 §3.2: fold lines longer than 75 octets with CRLF + space.
const foldLine = (line) => {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);

  return parts.join("\r\n ");
};

// Small square JPEG via Cloudinary transformation, base64 for PHOTO.
const fetchPhotoBase64 = async (url) => {
  if (!url) return null;

  const sized = url.includes("/upload/")
    ? url.replace("/upload/", "/upload/c_fill,g_face,w_320,h_320,q_80,f_jpg/")
    : url;

  try {
    const response = await fetch(sized, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    // Stay well under what phones accept for contact photos.
    if (buffer.length > 200 * 1024) return null;

    return buffer.toString("base64");
  } catch (error) {
    logger.warn({ action: "CARD_PHOTO_FETCH_FAILED", error: error.message });
    return null;
  }
};

export const buildVCard = async () =>
  getOrSetCache(VCARD_CACHE_KEY, 3600, async () => {
    const card = await getPublicCard();
    if (!card || !card.sections.saveContact) return null;

    const nameParts = (card.displayName || "").trim().split(/\s+/);
    const lastName = nameParts.length > 1 ? nameParts.pop() : "";
    const firstName = nameParts.join(" ");

    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
      `FN:${escapeVCard(card.displayName)}`,
    ];

    if (card.company) lines.push(`ORG:${escapeVCard(card.company)}`);
    if (card.title) lines.push(`TITLE:${escapeVCard(card.title)}`);
    const phone = card.phone || card.whatsapp;
    if (phone) lines.push(`TEL;TYPE=CELL,VOICE:${phone.replace(/[^\d+]/g, "")}`);
    if (card.email) lines.push(`EMAIL;TYPE=INTERNET,PREF:${card.email}`);
    if (card.website) lines.push(`URL:${card.website}`);
    if (card.location) lines.push(`ADR;TYPE=WORK:;;;${escapeVCard(card.location)};;;`);

    // Labelled extra URLs (shown with their names on iOS / macOS).
    card.links.forEach((link, index) => {
      if (!/^https?:/i.test(link.url)) return;
      lines.push(`item${index + 1}.URL:${link.url}`);
      lines.push(`item${index + 1}.X-ABLabel:${escapeVCard(link.label)}`);
    });

    const note = [card.tagline, card.skills?.length ? `Stack: ${card.skills.join(", ")}` : ""]
      .filter(Boolean)
      .join("\n");
    if (note) lines.push(`NOTE:${escapeVCard(note)}`);

    const photo = await fetchPhotoBase64(card.photoUrl);
    if (photo) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${photo}`);

    lines.push(`REV:${new Date().toISOString()}`);
    lines.push("END:VCARD");

    return {
      filename: `${(card.displayName || "contact").replace(/[^\w-]+/g, "-")}.vcf`,
      content: lines.map(foldLine).join("\r\n") + "\r\n",
    };
  });
