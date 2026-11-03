import Project from "../projects/project.model.js";
import Post from "../blog/blog.model.js";
import Certificate from "../certificates/certificate.model.js";
import Experience from "../experience/experience.model.js";
import Message from "../contact/contact.model.js";
import { Note } from "../notes/notes.model.js";
import { VisitorSession } from "../analytics/journey.model.js";

// ---------------------------------------------------------------------------
// Admin-wide search for the command palette: a few best matches from each
// content type, each with the dashboard path that opens it.
// ---------------------------------------------------------------------------

const PER_TYPE = 5;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SOURCES = [
  {
    type: "project",
    find: (re) => Project.find({ $or: [{ title: re }, { slug: re }, { category: re }] }).select("title category slug").limit(PER_TYPE).lean(),
    map: (doc) => ({ title: doc.title, subtitle: doc.category, path: "/dashboard/projects" }),
  },
  {
    type: "post",
    find: (re) => Post.find({ $or: [{ title: re }, { slug: re }, { tags: re }] }).select("title isVisible scheduledAt").limit(PER_TYPE).lean(),
    map: (doc) => ({
      title: doc.title,
      subtitle: doc.isVisible ? "Published post" : doc.scheduledAt ? "Scheduled post" : "Draft",
      path: `/dashboard/blog/${doc._id}/edit`,
    }),
  },
  {
    type: "note",
    find: (re) =>
      Note.find({ deletedAt: null, $or: [{ title: re }, { tags: re }, { text: re }] }).select("title tags").limit(PER_TYPE).lean(),
    map: (doc) => ({ title: doc.title || "Untitled", subtitle: doc.tags?.length ? `#${doc.tags.join(" #")}` : "Note", path: `/dashboard/notes?note=${doc._id}` }),
  },
  {
    type: "message",
    find: (re) =>
      Message.find({ $or: [{ name: re }, { email: re }, { subject: re }, { message: re }] })
        .sort({ createdAt: -1 })
        .select("name email subject")
        .limit(PER_TYPE)
        .lean(),
    map: (doc) => ({ title: doc.subject || `Message from ${doc.name}`, subtitle: `${doc.name} · ${doc.email}`, path: `/dashboard/messages?q=${encodeURIComponent(doc.email)}` }),
  },
  {
    type: "certificate",
    find: (re) => Certificate.find({ $or: [{ title: re }, { issuer: re }] }).select("title issuer").limit(PER_TYPE).lean(),
    map: (doc) => ({ title: doc.title, subtitle: doc.issuer, path: "/dashboard/certificates" }),
  },
  {
    type: "experience",
    find: (re) => Experience.find({ $or: [{ role: re }, { company: re }] }).select("role company").limit(PER_TYPE).lean(),
    map: (doc) => ({ title: doc.role, subtitle: doc.company, path: "/dashboard/experience" }),
  },
  {
    type: "visitor",
    find: (re) =>
      VisitorSession.find({ $or: [{ ip: re }, { "network.org": re }, { "location.city": re }, { visitorId: re }] })
        .sort({ lastSeenAt: -1 })
        .select("sessionId ip location network lastSeenAt")
        .limit(PER_TYPE)
        .lean(),
    map: (doc) => ({
      title: [doc.location?.city, doc.location?.country].filter(Boolean).join(", ") || doc.ip || "Visitor",
      subtitle: [doc.network?.org, doc.ip].filter(Boolean).join(" · "),
      path: `/dashboard/visitors/${doc.sessionId}`,
    }),
  },
];

export const searchAdmin = async (query) => {
  const text = String(query || "").trim().slice(0, 80);

  if (text.length < 2) return { query: text, results: [] };

  const re = new RegExp(escapeRegex(text), "i");

  const groups = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        const docs = await source.find(re);
        return docs.map((doc) => ({ type: source.type, id: String(doc._id), ...source.map(doc) }));
      } catch {
        return [];
      }
    }),
  );

  return { query: text, results: groups.flat() };
};
