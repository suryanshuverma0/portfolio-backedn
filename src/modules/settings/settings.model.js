import mongoose from "mongoose";

const socialsSchema = new mongoose.Schema(
  {
    github: { type: String, trim: true, default: "" },
    linkedin: { type: String, trim: true, default: "" },
    twitter: { type: String, trim: true, default: "" },
    instagram: { type: String, trim: true, default: "" },
    facebook: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const settingsSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    siteTitle: { type: String, trim: true, maxlength: 200, default: "" },
    siteDescription: { type: String, trim: true, maxlength: 500, default: "" },
    siteKeywords: [{ type: String, trim: true }],
    ogImage: { type: String, trim: true, default: "" },

    contactEmail: { type: String, trim: true, default: "" },
    contactPhone: { type: String, trim: true, default: "" },

    socials: { type: socialsSchema, default: () => ({}) },

    footerName: { type: String, trim: true, maxlength: 100, default: "" },
    footerRole: { type: String, trim: true, maxlength: 100, default: "" },
    resumeUrl: { type: String, trim: true, default: "" },

    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const Settings = mongoose.model("Settings", settingsSchema);
export default Settings;
