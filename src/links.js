import { customAlphabet } from 'nanoid';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const nextCode = customAlphabet(alphabet, 7);
const cacheLifetimeMs = 5 * 60 * 1000;

export function parseLink(input) {
  if (typeof input?.url !== 'string' || input.url.length > 4096) {
    throw new Error('Enter a web address of up to 4,096 characters.');
  }
  let url;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error('Enter a full address, including https:// or http://.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS address without embedded credentials.');
  }
  const seconds = input.expiresInSeconds ?? null;
  if (seconds !== null && (!Number.isInteger(seconds) || seconds < 1 || seconds > 31536000)) {
    throw new Error('Expiry must be a whole number from 1 to 31,536,000 seconds.');
  }
  return { destination: url.href, seconds };
}

export async function saveLink(db, destination, seconds) {
  // PostgreSQL decides uniqueness, including when two servers insert together.
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await db.query(
      `INSERT INTO links (code, destination, expires_at)
       VALUES ($1, $2, now() + $3::integer * interval '1 second')
       ON CONFLICT (code) DO NOTHING
       RETURNING code, destination, expires_at AS "expiresAt"`,
      [nextCode(), destination, seconds]
    );
    if (result.rowCount) return result.rows[0];
  }
  throw new Error('Unable to allocate a unique short code.');
}

export async function resolveLink(db, redis, code) {
  const key = 'shortlink:link:' + code;
  const cached = await redis.get(key);
  if (cached !== null) return { link: JSON.parse(cached), source: 'HIT' };

  const result = await db.query(
    'SELECT destination, expires_at AS "expiresAt" FROM links WHERE code = $1', [code]
  );
  const link = result.rows[0];
  if (link) {
    const remainingMs = link.expiresAt ? link.expiresAt.getTime() - Date.now() : Infinity;
    const ttl = Math.min(cacheLifetimeMs, remainingMs);
    if (ttl > 0) await redis.set(key, JSON.stringify(link), 'PX', ttl);
  }
  return { link, source: 'MISS' };
}

export async function countClick(db, code) {
  // A single SQL update counts concurrent visits and checks expiry at write time.
  const result = await db.query(
    `UPDATE links SET clicks = clicks + 1, last_clicked_at = clock_timestamp()
     WHERE code = $1 AND (expires_at IS NULL OR expires_at > clock_timestamp())`,
    [code]
  );
  return result.rowCount === 1;
}

export async function getStats(db, code) {
  const result = await db.query(
    `SELECT code, destination, created_at AS "createdAt", expires_at AS "expiresAt",
            clicks, last_clicked_at AS "lastClickedAt",
            (expires_at IS NOT NULL AND expires_at <= now()) AS expired
     FROM links WHERE code = $1`, [code]
  );
  return result.rows[0];
}
