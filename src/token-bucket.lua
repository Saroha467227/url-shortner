-- Redis runs this script in one step, even when two requests arrive together.
-- One hash per IP and route group holds the remaining tokens and last update.
local capacity = tonumber(ARGV[1])
local period_ms = tonumber(ARGV[2])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local previous = tonumber(state[1]) or capacity
local updated = tonumber(state[2]) or now
local elapsed = math.max(0, now - updated)
local tokens = math.min(capacity, previous + elapsed * capacity / period_ms)
local allowed = 0
local wait_ms = 0

if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  wait_ms = math.ceil((1 - tokens) * period_ms / capacity)
end

redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'updated', now)
-- An idle bucket would be full after this period, so Redis can discard it.
redis.call('PEXPIRE', KEYS[1], period_ms)
return {allowed, wait_ms}
