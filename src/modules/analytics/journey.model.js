import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Visitor journey tracking — one VisitorSession per browsing session (30 min
// inactivity window, decided client-side) and one VisitorEvent per thing the
// visitor did in it. Network/device/location fields are all derived
// server-side from the request; only the "context" block (screen, language,
// UTM, …) comes from the client and is treated as informational only.
//
// No TTL index on purpose — journey data is kept indefinitely.
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  "page_view",
  "page_leave",
  "section_view",
  "scroll_depth",
  "click",
  "outbound_click",
  "download",
  "contact_link",
  "form_submit",
  // Heartbeats only refresh the session's lastSeenAt / activeTimeMs and are
  // never persisted as VisitorEvent documents.
  "heartbeat",
];

const visitorSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, trim: true, maxlength: 100 },
    visitorId: { type: String, required: true, trim: true, maxlength: 100, index: true },

    // --- network / location (server-derived) ---
    ip: { type: String, trim: true, maxlength: 64 },
    location: {
      country: { type: String, maxlength: 2 },
      region: { type: String, maxlength: 10 },
      city: { type: String, maxlength: 100 },
      timezone: { type: String, maxlength: 60 },
      ll: { type: [Number], default: undefined },
    },

    // --- device (server-derived from User-Agent) ---
    userAgent: { type: String, maxlength: 500 },
    device: { type: String, enum: ["desktop", "mobile", "tablet"], default: "desktop" },
    deviceVendor: { type: String, maxlength: 50 },
    deviceModel: { type: String, maxlength: 50 },
    browser: { type: String, maxlength: 50 },
    browserVersion: { type: String, maxlength: 30 },
    os: { type: String, maxlength: 50 },
    osVersion: { type: String, maxlength: 30 },
    isBot: { type: Boolean, default: false },

    // --- client context (self-reported, informational) ---
    screen: { type: String, maxlength: 20 },
    viewport: { type: String, maxlength: 20 },
    pixelRatio: { type: Number },
    language: { type: String, maxlength: 20 },
    timezone: { type: String, maxlength: 60 },
    connection: { type: String, maxlength: 20 },
    touch: { type: Boolean },
    colorScheme: { type: String, maxlength: 10 },
    referrer: { type: String, maxlength: 500 },
    landingUrl: { type: String, maxlength: 500 },
    utm: {
      source: { type: String, maxlength: 100 },
      medium: { type: String, maxlength: 100 },
      campaign: { type: String, maxlength: 100 },
      term: { type: String, maxlength: 100 },
      content: { type: String, maxlength: 100 },
    },

    // --- journey summary (maintained incrementally on every batch) ---
    startedAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    entryPage: { type: String, maxlength: 300 },
    entryAt: { type: Date },
    exitPage: { type: String, maxlength: 300 },
    exitAt: { type: Date },
    pageViews: { type: Number, default: 0 },
    // Split of pageViews: /card (NFC business card) vs the rest of the site.
    portfolioPageViews: { type: Number },
    cardViews: { type: Number, default: 0 },
    eventCount: { type: Number, default: 0 },
    activeTimeMs: { type: Number, default: 0 },
    maxScrollDepth: { type: Number, default: 0 },
  },
  { timestamps: true },
);

visitorSessionSchema.index({ startedAt: -1 });
visitorSessionSchema.index({ lastSeenAt: -1 });

const visitorEventSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, maxlength: 100 },
    visitorId: { type: String, required: true, maxlength: 100 },
    type: { type: String, enum: EVENT_TYPES, required: true },
    path: { type: String, maxlength: 300 },
    title: { type: String, maxlength: 200 },
    label: { type: String, maxlength: 200 },
    section: { type: String, maxlength: 60 },
    target: { type: String, maxlength: 500 },
    // Meaning depends on type: dwell ms for section_view / page_leave,
    // percent for scroll_depth.
    value: { type: Number },
    meta: { type: mongoose.Schema.Types.Mixed },
    // When it happened, corrected for client clock skew.
    at: { type: Date, required: true },
  },
  { versionKey: false },
);

visitorEventSchema.index({ sessionId: 1, at: 1 });
visitorEventSchema.index({ type: 1, at: -1 });
visitorEventSchema.index({ at: -1 });

export const VisitorSession = mongoose.model("VisitorSession", visitorSessionSchema);
export const VisitorEvent = mongoose.model("VisitorEvent", visitorEventSchema);
