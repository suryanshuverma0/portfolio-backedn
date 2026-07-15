import redis from "../config/redis.js";

export const getOrSetCache = async (key, ttlSeconds, computeFn) => {
  const cached = await redis.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  const fresh = await computeFn();

  await redis.setEx(key, ttlSeconds, JSON.stringify(fresh));

  return fresh;
};
