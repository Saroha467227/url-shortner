# Shortlink Lab

Paste a long URL, get a short code, and open it twice. This exercise shows which work Redis saves and which work PostgreSQL still does on every visit.

## Start the app

Install Docker Desktop with Docker Compose and start its engine. Open PowerShell in the folder containing this README, then run the following command. Docker downloads PostgreSQL, Redis, and Node on the first run.

```powershell
docker compose up --build -d
```

Open [Shortlink Lab on your computer](http://localhost:3100). Paste `https://example.org/notes?lesson=1`, leave the expiry at **Never**, and click **Create short link**. Open the result twice. Return to the form and click **Refresh stats**. You should see **2** recorded clicks.

The generated URL starts with `localhost`, which means the computer opening it. For this exercise, use it on the same computer. The Compose setup binds the web port to loopback and keeps the database ports inside the Compose network.

To stop the app and retain its PostgreSQL data, run `docker compose down`. To start it again, run `docker compose up -d`. If the page does not open, run `docker compose logs app` and look for “Shortlink Lab is ready”.

## Follow one request through the code

1. **Create a link.** In [app.js](src/app.js), find `app.post('/api/links', limitCreate, ...)`. Express matches the method and path. It runs the functions in order. The form sends JSON containing a URL and an optional lifetime in seconds.
2. **Check the visitor's allowance.** [rate-limit.js](src/rate-limit.js) uses `req.ip` to find the visitor's bucket. `next()` passes an allowed request to the next function. When the bucket is empty, the middleware sends HTTP `429` with a `Retry-After` delay in seconds. Calling the route handler ends there.
3. **Save the destination.** In [links.js](src/links.js), `parseLink` accepts an HTTP or HTTPS destination. `saveLink` uses Nano ID to draw seven random letters and digits. The code is a lookup key. PostgreSQL stores it beside the original URL. Its primary key enforces uniqueness and the app retries a collision. The `$1`, `$2` and `$3` in SQL are places for separate query values.
4. **Open the short link.** Suppose your code is `k8Qp2Lm`. Opening `/r/k8Qp2Lm` sends a GET request. `req.params.code` contains `k8Qp2Lm`. After the read limiter, `resolveLink` asks Redis for the string at `shortlink:link:k8Qp2Lm`.
5. **Follow a cache miss.** The first lookup returns `null`. The app reads the row from PostgreSQL and saves a copy of the destination and expiry in Redis. In `redis.set(key, ..., 'PX', ttl)`, `PX` gives the key a lifetime in milliseconds. The copy lasts up to five minutes or the remaining lifetime of the link, whichever is shorter.
6. **Count and redirect.** `countClick` adds one with `clicks = clicks + 1`. PostgreSQL checks expiry again during this update. Express replies with `302 Found` and a `Location` header containing the long URL. Your browser makes a separate request to that address. A click means the shortener accepted a GET and issued a redirect. Destination page loads and unique visitors are different measurements.
7. **Open it again.** While the cached copy is live, Redis supplies the destination. The app skips the PostgreSQL destination lookup and still sends the database its click update. This lookup-on-demand pattern is called **cache-aside**. `await` in these functions means that this request waits for the Redis or SQL result before moving on.

## See MISS and HIT for yourself

In PowerShell, create a fresh link. Use the code the app gives you.

```powershell
$base = 'http://localhost:3100'
$link = Invoke-RestMethod -Method Post -Uri "$base/api/links" -ContentType 'application/json' -Body '{"url":"https://example.org/notes?lesson=1"}'
$link.shortUrl
curl.exe -s -D - -o NUL $link.shortUrl
curl.exe -s -D - -o NUL $link.shortUrl
Invoke-RestMethod "$base/api/links/$($link.code)/stats"
```

The first response contains `X-Cache: MISS`. The second contains `X-Cache: HIT`. Both include `302` and the same `Location`. These commands send a GET and display headers without following the redirect. Stats should show `clicks` as `"2"` and a last-visit timestamp. PostgreSQL's large integer counter travels as a string to preserve precision.

Now look at the actual Redis entry. `GET` reads its value. `TTL` shows the number of seconds left. If that returns `-2`, the key is absent. Visit the still-active link once to cache it again.

```powershell
docker compose exec cache redis-cli GET "shortlink:link:$($link.code)"
docker compose exec cache redis-cli TTL "shortlink:link:$($link.code)"
```

**Try expiry.** Create a new link in the form with a 30-second lifetime. Open it immediately, then open it after 30 seconds. The first visit redirects. The later visit gets `410 Gone`, and the counter stays at one. Analytics remain available because PostgreSQL keeps the row. A code the app has never stored gets `404`.

## Build intuition for the token bucket

Start with five tokens for one IP. Spend one on each creation attempt. Five requests can arrive together. A sixth immediate request gets `429`. Twelve seconds add one token. A second IP has its own balance. Redirects and stats share a separate read bucket with 60 tokens per minute.

Read [token-bucket.lua](src/token-bucket.lua) in order. Redis supplies the clock. The script reads two fields from a hash, adds tokens based on elapsed time, caps the balance, and spends one if available. The following is the refill calculation expressed in seconds.

```js
const earned = elapsedSeconds * 5 / 60;
const tokens = Math.min(5, previousTokens + earned);
```

If the previous balance was zero and six seconds passed, you have half a token. You must wait another six seconds to send a request that costs one. Redis runs the full script atomically, so two simultaneous requests cannot spend the same token. Idle bucket keys expire after a minute, when they would be full again.

**Compare the library version.** The default mode is the hand-written token bucket. Switch to the included `rate-limiter-flexible` implementation with the following PowerShell commands.

```powershell
$env:LIMITER_MODE = 'library'
docker compose up -d app
```

The library gives an IP five creation points in a 60-second fixed window starting with its first request. After exhausting them, it waits for that window to end. The custom bucket earns tokens gradually. The two modes use separate Redis keys. Set `$env:LIMITER_MODE = 'bucket'` and run the Compose command again to switch back.

## Find the code and check your changes

| File | What to look for |
| --- | --- |
| [server.js](src/server.js) | Connects to PostgreSQL and Redis, creates the table, and starts Express. |
| [app.js](src/app.js) | Maps POST, GET, and stats requests to functions. |
| [links.js](src/links.js) | Generates codes, looks up the destination, caches it, and records clicks. |
| [schema.sql](src/schema.sql) | Defines what one saved link contains. |
| [rate-limit.js](src/rate-limit.js) and [token-bucket.lua](src/token-bucket.lua) | Apply the per-IP rules before a handler runs. |
| [client.js](public/client.js) | Sends the form to the API and displays the result in the browser. |

With the containers running, execute `docker compose exec app npm test`. The HTTP tests exercise both limiters, cache hits and misses, expiry, independent IPs, and concurrent visits using a temporary database table and isolated Redis keys. After editing local code, rebuild with `docker compose up --build -d` before rerunning the tests.

**Using your own services.** With Node 22 or newer, PostgreSQL and Redis running, set `DATABASE_URL` and `REDIS_URL` in your shell, then run `npm ci` and `npm start`. The default address is `http://localhost:3100`. Set `BASE_URL` to the address the app should put in generated links, and `PORT` if you need another port. This local setup uses the direct connection's IP for rate limiting.

For more background, read the [Express middleware guide](https://expressjs.com/en/guide/using-middleware/) and the [Redis cache-aside guide](https://redis.io/docs/latest/develop/use-cases/cache-aside/).

## Deploy on Vercel

Import the repository as an Express project. Connect a PostgreSQL database and a Redis database to the production environment. The app reads `DATABASE_URL` (or `POSTGRES_URL`) and a TCP connection string in `REDIS_URL` (or `KV_URL`). Use the pooled connection string for managed PostgreSQL and the TLS connection string for managed Redis. Keep these values in Vercel’s environment settings.

The production build checks Redis and creates the PostgreSQL table before publishing. Vercel serves the form from `public/` and sends API requests and short-link visits to [index.js](index.js). Short links use the project's production domain automatically. Set `BASE_URL` if you want to use a particular custom domain.
