import express from 'express';
import { createApp } from './src/app.js';
import { createClients, deploymentSettings } from './src/services.js';

// Vercel serves public/ at the edge and sends dynamic requests to this app.
const app = express();
const { databaseUrl, redisUrl, baseUrl } = deploymentSettings(process.env);
if (databaseUrl && redisUrl) {
  const clients = createClients(databaseUrl, redisUrl);
  const backend = createApp({ ...clients, baseUrl, limiterMode: process.env.LIMITER_MODE });
  // Vercel sets the forwarded client address at its edge.
  backend.set('trust proxy', 1);
  app.use(backend);
} else {
  app.use((_req, res) => res.status(503).json({
    error: 'PostgreSQL and Redis must be connected to this deployment environment.'
  }));
}

export default app;
