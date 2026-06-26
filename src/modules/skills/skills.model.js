import mongoose from "mongoose";

const skillSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    name: {
      type: String,
      required: [true, "Skill name is required"],
      trim: true,
      maxlength: 100,
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

    category: {
      type: String,
      required: [true, "Category is required"],
      enum: [
        // Languages
        "Programming Languages",

        // Frontend
        "Frontend Development",
        "Frontend Frameworks",
        "UI Libraries",
        "CSS Frameworks",

        // Backend
        "Backend Development",
        "Backend Frameworks",
        "API Development",

        // Mobile
        "Mobile Development",

        // Database
        "Databases",
        "Database Design",
        "ORMs",

        // Blockchain
        "Blockchain Development",
        "Web3",
        "Smart Contracts",

        // Cloud & DevOps
        "Cloud Computing",
        "DevOps",
        "Containerization",
        "CI/CD",

        // Infrastructure
        "Operating Systems",
        "Networking",
        "Linux",
        "System Administration",

        // CS Fundamentals
        "Data Structures & Algorithms",
        "Computer Science Fundamentals",
        "Object-Oriented Programming",
        "Design Patterns",
        "System Design",

        // Security
        "Cybersecurity",
        "Authentication & Authorization",

        // AI & Data
        "Artificial Intelligence",
        "Machine Learning",
        "Deep Learning",
        "Data Science",
        "Data Analytics",
        "Big Data",

        // Testing
        "Testing",
        "Automation Testing",

        // Architecture
        "Software Architecture",
        "Microservices",

        // Game
        "Game Development",

        // Embedded
        "Embedded Systems",
        "IoT",

        // Tools
        "Tools & Platforms",
        "Version Control",
        "Build Tools",

        // Productivity
        "Project Management",
        "Documentation",

        // Design
        "UI/UX Design",

        // Soft Skills
        "Soft Skills",

        // Learning
        "Currently Exploring",

        // Fallback
        "Other",
      ],
    },
  },
  {
    timestamps: true,
  },
);

const Skill = mongoose.model("Skill", skillSchema);

export default Skill;
