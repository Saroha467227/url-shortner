import { Pool } from 'pg';
import Redis from 'ioredis';

export function createClients(databaseUrl, redisUrl) {
  const db = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10000,
    max: 4
  });
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000
  });
  db.on('error', error => console.error('PostgreSQL:', error.message));
  redis.on('error', error => console.error('Redis:', error.message));
  return { db, redis };
}

export function deploymentSettings(env) {
  return {
    databaseUrl: env.DATABASE_URL || env.POSTGRES_URL,
    redisUrl: env.REDIS_URL || env.KV_URL,
    baseUrl: env.BASE_URL || 'https://' + (env.VERCEL_ENV === 'production'
      ? env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL
      : env.VERCEL_URL)
  };
}
