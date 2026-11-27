import { readFileSync } from 'node:fs';
import { RateLimiterRedis } from 'rate-limiter-flexible';

const script = readFileSync(new URL('./token-bucket.lua', import.meta.url), 'utf8');

export function makeLimiter(redis, mode, group, capacity, seconds) {
  const keyPrefix = 'shortlink:' + mode + ':' + group;
  if (mode !== 'bucket' && mode !== 'library') {
    throw new Error('LIMITER_MODE must be bucket or library.');
  }
  const library = mode === 'library'
    ? new RateLimiterRedis({ storeClient: redis, keyPrefix, points: capacity, duration: seconds })
    : null;

  return async function limitByIp(req, res, next) {
    let waitMs;
    try {
      if (library) {
        await library.consume(req.ip);
        return next();
      }

      const key = keyPrefix + ':' + req.ip;
      const [allowed, retryIn] = await redis.eval(script, 1, key, capacity, seconds * 1000);
      if (allowed) return next();
      waitMs = retryIn;
    } catch (error) {
      // The library rejects with a result when a client exhausts its points.
      if (Number.isFinite(error?.msBeforeNext)) waitMs = error.msBeforeNext;
      else return next(error);
    }

    res.set('Retry-After', String(Math.max(1, Math.ceil(waitMs / 1000))));
    return res.status(429).json({ error: 'Too many requests. Try again after the indicated delay.' });
  };
}
