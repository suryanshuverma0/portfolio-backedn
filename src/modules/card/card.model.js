import mongoose from "mongoose";
import imageSchema from "../../shared/schemas/image.schema.js";

// ---------------------------------------------------------------------------
// The NFC / digital business card served at /card. A single shared document
// (same convention as Profile and Settings). Every field is optional — the
// service falls back to Profile/Settings data for anything left empty, so
// the card works before it has ever been saved.
// ---------------------------------------------------------------------------

export const CARD_FINISHES = ["midnight", "black", "accent"];

export const SECTION_KEYS = [
  "photo",
  "availability",
  "title",
  "company",
  "location",
  "tagline",
  "saveContact",
  "call",
  "whatsapp",
  "email",
  "stats",
  "skills",
  "projects",
  "links",
  "portfolioButton",
  "share",
  "qr",
];

export const LINK_KINDS = [
  "linkedin",
  "github",
  "leetcode",
  "twitter",
  "instagram",
  "facebook",
  "website",
  "resume",
  "calendar",
  "custom",
];

const linkSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: LINK_KINDS, default: "custom" },
    label: { type: String, trim: true, maxlength: 60 },
    url: { type: String, trim: true, maxlength: 500, required: true },
    isVisible: { type: Boolean, default: true },
  },
  { _id: false },
);

const statSchema = new mongoose.Schema(
  {
    value: { type: String, trim: true, maxlength: 20, required: true },
    label: { type: String, trim: true, maxlength: 40, required: true },
  },
  { _id: false },
);

const cardSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    isEnabled: { type: Boolean, default: true },

    // --- identity ---
    displayName: { type: String, trim: true, maxlength: 100 },
    title: { type: String, trim: true, maxlength: 100 },
    company: { type: String, trim: true, maxlength: 100 },
    tagline: { type: String, trim: true, maxlength: 300 },
    location: { type: String, trim: true, maxlength: 100 },
    availability: { type: String, trim: true, maxlength: 80 },
    photo: { type: imageSchema, default: null },

    // --- contact ---
    email: { type: String, trim: true, maxlength: 150 },
    phone: { type: String, trim: true, maxlength: 30 },
    whatsapp: { type: String, trim: true, maxlength: 30 },
    website: { type: String, trim: true, maxlength: 300 },

    // --- content ---
    links: { type: [linkSchema], default: undefined },
    stats: { type: [statSchema], default: undefined },
    skills: { type: [{ type: String, trim: true, maxlength: 40 }], default: undefined },
    featuredProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: "Project" }],

    // --- appearance ---
    accentColor: { type: String, trim: true, maxlength: 9, default: "#2a78d6" },
    // Card surface: midnight (dark navy + accent glow), black (metal), accent.
    finish: { type: String, enum: CARD_FINISHES, default: "midnight" },

    // --- what to show (hidden parts are stripped server-side, so hidden
    // contact details never reach the page or the vCard) ---
    sections: {
      photo: { type: Boolean, default: true },
      availability: { type: Boolean, default: true },
      title: { type: Boolean, default: true },
      company: { type: Boolean, default: true },
      location: { type: Boolean, default: true },
      tagline: { type: Boolean, default: true },
      saveContact: { type: Boolean, default: true },
      call: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      stats: { type: Boolean, default: true },
      skills: { type: Boolean, default: true },
      projects: { type: Boolean, default: true },
      links: { type: Boolean, default: true },
      portfolioButton: { type: Boolean, default: true },
      share: { type: Boolean, default: true },
      qr: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);

const Card = mongoose.model("Card", cardSchema);
export default Card;
