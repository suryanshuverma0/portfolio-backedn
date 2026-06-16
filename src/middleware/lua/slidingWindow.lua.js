
export const slidingWindowLua = `
local key = KEYS[1]

local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

local cutoff = now - (window * 1000)

redis.call(
  'ZREMRANGEBYSCORE',
  key,
  0,
  cutoff
)

local count =
redis.call(
  'ZCARD',
  key
)

if count >= limit then

  local oldest =
  redis.call(
    'ZRANGE',
    key,
    0,
    0,
    'WITHSCORES'
  )

  local oldestTime =
  tonumber(oldest[2])

  local retryAfter =
  math.ceil(
    (
      (oldestTime + (window * 1000))
      - now
    ) / 1000
  )

  return {
    0,
    retryAfter,
    0
  }
end

redis.call(
  'ZADD',
  key,
  now,
  member
)

redis.call(
  'EXPIRE',
  key,
  window
)

local remaining =
limit - (count + 1)

return {
  1,
  0,
  remaining
}
`;