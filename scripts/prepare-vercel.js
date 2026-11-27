import { readFile } from 'node:fs/promises';
import { createClients, deploymentSettings } from '../src/services.js';

const { databaseUrl, redisUrl } = deploymentSettings(process.env);
if (!databaseUrl || !redisUrl) {
  if (process.env.VERCEL_ENV === 'production') {
    throw new Error('Connect PostgreSQL and Redis to production before deploying.');
  }
  console.log('Building a preview without database connections.');
} else {
  const { db, redis } = createClients(databaseUrl, redisUrl);
  try {
    const schema = await readFile(new URL('../src/schema.sql', import.meta.url), 'utf8');
    await redis.ping();
    await db.query(schema);
    console.log('Redis is reachable and the PostgreSQL links table is ready.');
  } finally {
    redis.disconnect();
    await db.end();
  }
}
