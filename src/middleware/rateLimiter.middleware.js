
import crypto from "crypto";

import redis from "../config/redis.js";
import { slidingWindowLua } from "./lua/slidingWindow.lua.js";

// Cloudflare sits in front of this app and overwrites this header with the
// real visitor IP on every request, unlike a bare X-Forwarded-For entry
// (which a client can set to anything before it ever reaches Cloudflare).
// Falls back to req.ip for local dev / anywhere not behind Cloudflare.
const defaultKeyBy = (req) => req.headers["cf-connecting-ip"] || req.ip;

export const slidingWindowLimiter = ({
  prefix,
  limit,
  windowInSeconds,
  keyBy = defaultKeyBy,
}) => {
  return async (req, res, next) => {
    try {
      const identifier = keyBy(req);

      if (!identifier) {
        // Nothing usable to key on (e.g. an email-keyed limiter but no
        // email in this particular request) — let validation downstream
        // reject it instead of rate-limiting on nothing.
        return next();
      }

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