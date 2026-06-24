
import http from "http";
import mongoose from "mongoose";

import app from "./src/app.js";
import connectDB from "./src/config/db.js";
import {
  connectRedis,
  disconnectRedis,
} from "./src/config/redis.js";
import logger from "./src/utils/logger.js";
import validateEnv from "./src/config/env.js";


validateEnv();

const PORT = process.env.PORT || 3000;

let server;

const bootstrap = async () => {
  try {
    await connectDB();
    await connectRedis();

    server = http.createServer(app);

    server.listen(PORT, "0.0.0.0", () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
};

bootstrap();

const shutdown = async (signal, exitCode = 0) => {
  try {
    logger.info(`${signal} received. Shutting down gracefully...`);

    if (server) {
      server.close(async () => {
        await mongoose.connection.close();
        await disconnectRedis();

        logger.info("All connections closed");
        process.exit(exitCode);
      });
    } else {
      await mongoose.connection.close();
      await disconnectRedis();

      process.exit(exitCode);
    }
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  shutdown("uncaughtException", 1);
});