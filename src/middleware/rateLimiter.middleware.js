
import crypto from "crypto";

import redis from "../config/redis.js";
import { slidingWindowLua } from "./lua/slidingWindow.lua.js";

export const slidingWindowLimiter = ({
  prefix,
  limit,
  windowInSeconds,
}) => {
  return async (req, res, next) => {
    try {
      const identifier = req.ip;

      const key = `${prefix}:${identifier}`;

      const now = Date.now();

      const member =
        `${now}:${crypto.randomUUID()}`;

      const result = await redis.eval(
        slidingWindowLua,
        {
          keys: [key],
          arguments: [
            now.toString(),
            windowInSeconds.toString(),
            limit.toString(),
            member,
          ],
        }
      );

      const [
        allowed,
        retryAfter,
        remaining,
      ] = result;

      res.setHeader(
        "X-RateLimit-Limit",
        limit
      );

      res.setHeader(
        "X-RateLimit-Remaining",
        remaining
      );

      if (!allowed) {
        res.setHeader(
          "Retry-After",
          retryAfter
        );

        return res.status(429).json({
          success: false,
          message:
            "Too many requests",
          retryAfter,
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};