import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { createClients } from './services.js';

const port = Number(process.env.PORT || 3100);
const baseUrl = process.env.BASE_URL || 'http://localhost:' + port;
const { db, redis } = createClients(process.env.DATABASE_URL, process.env.REDIS_URL || 'redis://127.0.0.1:6379');

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
