import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { createApp } from '../src/app.js';
import { makeLimiter } from '../src/rate-limit.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL
  ? 'Set DATABASE_URL and REDIS_URL, or run docker compose exec app npm test.'
  : false;

for (const mode of ['bucket', 'library']) {
  test('real HTTP, PostgreSQL and Redis with ' + mode + ' limits', { skip }, async t => {
    // Keep a single pooled connection so every query sees the same temporary table.
    const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    t.after(() => db.end());
    // This table shadows the application's table for this test connection only.
    const schema = await readFile(new URL('../src/schema.sql', import.meta.url), 'utf8');
    await db.query(schema.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE'));
    const redis = new Redis(process.env.REDIS_URL, { keyPrefix: 'labtest:' + randomUUID() + ':' });
    t.after(() => redis.disconnect());
    const app = createApp({ db, redis, baseUrl: 'http://example.test', limiterMode: mode });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port;
    const destination = 'https://example.com/learn?lesson=1#start';
    const post = body => fetch(base + '/api/links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const visit = (code, method = 'GET') => fetch(base + '/r/' + code, { method, redirect: 'manual' });
    const stats = async code => (await fetch(base + '/api/links/' + code + '/stats')).json();

    assert.equal((await fetch(base)).status, 200);
    assert.equal((await visit('unknown')).status, 404);
    assert.equal((await post({ url: 'invalid' })).status, 400);
    const created = await post({ url: destination });
    assert.equal(created.status, 201);
    const link = await created.json();
    assert.match(link.code, /^[a-zA-Z0-9]{7}$/);
    assert.equal(link.shortUrl, 'http://example.test/r/' + link.code);
    const first = await visit(link.code);
    assert.equal(first.status, 302);
    assert.equal(first.headers.get('x-cache'), 'MISS');
    assert.equal(first.headers.get('location'), destination);
    const second = await visit(link.code);
    assert.equal(second.headers.get('x-cache'), 'HIT');
    assert.equal(second.headers.get('cache-control'), 'no-store');
    assert.equal((await visit(link.code, 'HEAD')).status, 302);
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => visit(link.code)));
    assert.ok(concurrent.every(res => res.status === 302));
    assert.equal((await stats(link.code)).clicks, '10');
    await redis.del('shortlink:link:' + link.code);
    assert.equal((await visit(link.code)).headers.get('x-cache'), 'MISS');
    assert.equal((await stats(link.code)).clicks, '11');

    const short = await (await post({ url: destination, expiresInSeconds: 2 })).json();
    assert.equal((await visit(short.code)).status, 302);
    const ttl = await redis.pttl('shortlink:link:' + short.code);
    assert.ok(ttl > 0 && ttl <= 2000);
    await delay(2100);
    assert.equal((await visit(short.code)).status, 410);
    assert.equal((await stats(short.code)).clicks, '1');
    assert.equal((await stats(short.code)).expired, true);

    // Two slots remain in the five-create limit after our three POST requests.
    const burst = await Promise.all(Array.from({ length: 4 }, () => post({ url: destination })));
    assert.equal(burst.filter(res => res.status === 201).length, 2);
    for (const denied of burst.filter(res => res.status !== 201)) {
      assert.equal(denied.status, 429);
      assert.ok(Number(denied.headers.get('retry-after')) >= 1);
    }

    // Exercise the same middleware with a one-second refill period.
    const limit = makeLimiter(redis, mode, 'refill-test', 1, 1);
    const probe = async ip => {
      let outcome = 200;
      const res = { set() {}, status(n) { outcome = n; return this; }, json() {} };
      await limit({ ip }, res, error => { if (error) throw error; });
      return outcome;
    };
    assert.equal(await probe('192.0.2.1'), 200);
    assert.equal(await probe('192.0.2.1'), 429);
    assert.equal(await probe('192.0.2.2'), 200);
    await delay(1050);
    assert.equal(await probe('192.0.2.1'), 200);
  });
}
