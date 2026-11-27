import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 3100);
const baseUrl = process.env.BASE_URL || 'http://localhost:' + port;
const db = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: 1,
  connectTimeout: 3000
});
redis.on('error', error => console.error('Redis:', error.message));
db.on('error', error => console.error('PostgreSQL:', error.message));

try {
  await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  await redis.ping();
  const app = createApp({ db, redis, baseUrl, limiterMode: process.env.LIMITER_MODE || 'bucket' });
  const server = app.listen(port, process.env.BIND_HOST || '127.0.0.1', () => {
    console.log('Shortlink Lab is ready at', baseUrl);
  });
  async function stop() {
    server.close(async () => {
      redis.disconnect();
      await db.end();
    });
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error('Startup failed:', error.message);
  redis.disconnect();
  await db.end();
  process.exitCode = 1;
}
