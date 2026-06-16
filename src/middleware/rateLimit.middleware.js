// middleware/rateLimiter.js

import redis from "../config/redis.js";

export const slidingWindowLimiter = ({ limit, windowInSeconds, prefix }) => {
  return async (req, res, next) => {
    try {
      //ip
      const ip = req.ip;
      const key = `${prefix}:${ip}`;

      //current timestamp
      const now = Date.now();

      //cuttoff time
      const cutoff = now - windowInSeconds * 1000;

      //remove request older than cuttoff
      await redis.zRemRangeByScore(key, 0, cutoff);

      //count request
      const requestCount = await redis.zCard(key);

      //block is req exceed
      if (requestCount >= limit) {
        return res.status(429).json({
          success: false,
          message: "Too many requests",
        });
      }

      //current request
      await redis.zAdd(key, {
        score: now,
        value: `${now}-${Math.random()}`,
      });

      //auto remove inactive user
      await redis.expire(key, windowInSeconds);
      next();
    } catch (err) {
      next(err);
    }
  };
};
