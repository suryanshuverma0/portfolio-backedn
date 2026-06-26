import { z } from "zod";

export const createSkillSchema = z.object({
  name: z.string().min(1).max(100),

  category: z.enum([
    "Programming Languages",

    "Frontend Development",
    "Frontend Frameworks",
    "UI Libraries",
    "CSS Frameworks",

    "Backend Development",
    "Backend Frameworks",
    "API Development",

    "Mobile Development",

    "Databases",
    "Database Design",
    "ORMs",

    "Blockchain Development",
    "Web3",
    "Smart Contracts",

    "Cloud Computing",
    "DevOps",
    "Containerization",
    "CI/CD",

    "Operating Systems",
    "Networking",
    "Linux",
    "System Administration",

    "Data Structures & Algorithms",
    "Computer Science Fundamentals",
    "Object-Oriented Programming",
    "Design Patterns",
    "System Design",

    "Cybersecurity",
    "Authentication & Authorization",

    "Artificial Intelligence",
    "Machine Learning",
    "Deep Learning",
    "Data Science",
    "Data Analytics",
    "Big Data",

    "Testing",
    "Automation Testing",

    "Software Architecture",
    "Microservices",

    "Game Development",

    "Embedded Systems",
    "IoT",

    "Tools & Platforms",
    "Version Control",
    "Build Tools",

    "Project Management",
    "Documentation",

    "UI/UX Design",

    "Soft Skills",

    "Currently Exploring",

    "Other",
  ]),

  featured: z.boolean().optional(),

  order: z.number().optional(),

  isVisible: z.boolean().optional(),
});

export const updateSkillSchema = createSkillSchema.partial();
