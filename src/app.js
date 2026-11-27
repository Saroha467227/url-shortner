import express from 'express';
import { fileURLToPath } from 'node:url';
import { countClick, getStats, parseLink, resolveLink, saveLink } from './links.js';
import { makeLimiter } from './rate-limit.js';

export function createApp({ db, redis, baseUrl, limiterMode = 'bucket' }) {
  const app = express();
  app.disable('x-powered-by');
  const limitCreate = makeLimiter(redis, limiterMode, 'create', 5, 60);
  const limitRead = makeLimiter(redis, limiterMode, 'read', 60, 60);
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.post('/api/links', limitCreate, express.json({ limit: '16kb' }), async (req, res) => {
    let input;
    try {
      input = parseLink(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const link = await saveLink(db, input.destination, input.seconds);
    const shortUrl = new URL('/r/' + link.code, baseUrl).href;
    return res.status(201).json({ ...link, shortUrl });
  });

  app.get('/api/links/:code/stats', limitRead, async (req, res) => {
    const stats = await getStats(db, req.params.code);
    if (!stats) return res.status(404).json({ error: 'Unknown short code.' });
    return res.json(stats);
  });

  app.get('/r/:code', limitRead, async (req, res) => {
    const { link, source } = await resolveLink(db, redis, req.params.code);
    res.set('X-Cache', source);
    if (!link) return res.status(404).send('Unknown short code.');
    if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) {
      return res.status(410).send('This link has expired.');
    }
    // Express also routes HEAD here. A header inspection should cost zero clicks.
    if (req.method === 'GET' && !(await countClick(db, req.params.code))) {
      return res.status(410).send('This link has expired.');
    }
    return res.redirect(302, link.destination);
  });

  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((_req, res) => res.status(404).json({ error: 'Page not found.' }));
  app.use((err, _req, res, _next) => {
    if (err.status === 400) return res.status(400).json({ error: 'Send valid JSON.' });
    if (err.status === 413) return res.status(413).json({ error: 'Request body is too large.' });
    if (err.status === 415) return res.status(415).json({ error: 'Unsupported request encoding.' });
    console.error(err.message);
    return res.status(503).json({ error: 'Service unavailable. Check PostgreSQL and Redis and try again.' });
  });
  return app;
}
