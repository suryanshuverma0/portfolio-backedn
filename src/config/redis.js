import { createClient } from "redis";
import logger from "../utils/logger.js";

const redis = createClient({
  url: process.env.REDIS_URL,
});

redis.on("error", (err) => {
  logger.error(`Redis Error: ${err.message}`);
});

export const connectRedis = async () => {
  if (!redis.isOpen) {
    await redis.connect();
    logger.info("Redis Connected");
  }
};

export const disconnectRedis = async () => {
  if (redis.isOpen) {
    await redis.quit();
    logger.info("Redis Disconnected");
  }
};

export default redis;