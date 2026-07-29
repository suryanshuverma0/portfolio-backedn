import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
// import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import pinoHttp from "pino-http";
import logger from "./utils/logger.js";

import { notFound, errorHandler } from "./middleware/error.middleware.js";

import authRoutes from "./modules/auth/auth.routes.js";
import profileRoutes from "./modules/profile/profile.routes.js";
import imageRoutes from "./modules/upload/upload.routes.js";
import educationRoutes from "./modules/education/education.routes.js";
import statsRoutes from "./modules/stats/stat.routes.js";
import experienceRoutes from "./modules/experience/experience.routes.js";
import serviceRoutes from "./modules/services/service.routes.js";
import skillsRoutes from "./modules/skills/skills.routes.js";
import certificateRoutes from "./modules/certificates/certificate.routes.js"
import projectRoutes from "./modules/projects/project.routes.js";
import analyticsRoutes from "./modules/analytics/analytics.routes.js";
import settingsRoutes from "./modules/settings/settings.routes.js";
import googleAuthRoutes from "./modules/google-auth/googleAuth.routes.js";
import blogRoutes from "./modules/blog/blog.routes.js";
import contactRoutes from "./modules/contact/contact.routes.js";

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://suryanshuverma.com.np",
      "https://www.suryanshuverma.com.np",
    ],
    credentials: true,
  }),
);
app.use(compression());
// Blog posts are markdown with no length cap, easily past the 10kb default
// below — scoped larger limit for just this path, applied before the
// global parser so it wins for blog requests (body-parser skips re-parsing
// an already-consumed request).
app.use("/api/v1/blog", express.json({ limit: "2mb" }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());
// app.use(mongoSanitize());
app.use(hpp());
app.use(pinoHttp({ logger }));

app.get("/", (req, res) => {
  res.status(200).json({ success: true, message: "Portfolio API running" });
});
app.get("/api/v1/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API healthy",
    uptime: process.uptime(),
    timestamp: new Date(),
  });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/profile", profileRoutes);
app.use("/api/v1/upload", imageRoutes);
app.use("/api/v1/education", educationRoutes);
app.use("/api/v1/stats", statsRoutes);
app.use("/api/v1/experience", experienceRoutes);
app.use("/api/v1/services", serviceRoutes);
app.use("/api/v1/skill", skillsRoutes);
app.use("/api/v1/certificates", certificateRoutes);
app.use("/api/v1/projects", projectRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/google-auth", googleAuthRoutes);
app.use("/api/v1/blog", blogRoutes);
app.use("/api/v1/contact", contactRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
