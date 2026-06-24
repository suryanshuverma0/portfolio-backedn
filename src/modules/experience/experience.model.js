import mongoose from "mongoose";

const experienceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    role: {
      type: String,
      required: [true, "Role is required"],
      trim: true,
      maxlength: 200,
    },

    company: {
      type: String,
      required: [true, "Company name is required"],
      trim: true,
      maxlength: 200,
    },

    location: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    employmentType: {
      type: String,
      enum: [
        "Full-time",
        "Part-time",
        "Internship",
        "Contract",
        "Freelance",
        "Remote",
        "Others"
      ],
      default: "Internship",
    },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      default: null,
    },

    isCurrent: {
      type: Boolean,
      default: false,
    },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    technologies: [
      {
        type: String,
        trim: true,
      },
    ],

    companyUrl: {
      type: String,
      trim: true,
    },

    featured: {
      type: Boolean,
      default: false,
    },

    order: {
      type: Number,
      default: 0,
    },

    isVisible: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

const Experience = mongoose.model(
  "Experience",
  experienceSchema,
);

export default Experience;