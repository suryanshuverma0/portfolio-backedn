import dns from "node:dns";
import mongoose from "mongoose";

import logger from "../utils/logger.js";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      process.env.MONGO_URI,
    );

    logger.info(
      `MongoDB Connected: ${conn.connection.host}`,
    );

    mongoose.connection.on("connected", () => {
      logger.info("MongoDB connection established");
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected");
    });

    mongoose.connection.on("error", (err) => {
      logger.error(`MongoDB Error: ${err.message}`);
    });
  } catch (error) {
    logger.error(`MongoDB Connection Failed`);

    throw error;
  }
};

export default connectDB;