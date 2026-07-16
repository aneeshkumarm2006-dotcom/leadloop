/**
 * rateLimit.js — in-memory token-bucket rate limiter (Phase 3, F7.1).
 *
 * Per the pre-flight decision (phase-3-TODO §Decide rate-limit storage): ship a
 * v1 in-memory token bucket, single-process, 60 req/min keyed per `(token, ip)`.
 * Returns HTTP 429 on overflow. Used by F7's public inbound webhook route and
 * reusable by F13's public form-submit route (pass a custom `keyFn`).
 *
 * ─── Scaling note ──────────────────────────────────────────────────────────
 * Buckets live in this process's memory, so each replica enforces its OWN quota
 * — N replicas allow up to N× the configured rate in aggregate. That's accepted
 * for v1 (abuse mitigation, not hard metering). At startup we log a warning when
 * an env replica hint (SERVER_REPLICAS / WEB_CONCURRENCY) suggests > 2 instances.
 *
 * Redis upgrade path (when sustained horizontal scale > 2 replicas is required):
 * replace the in-process `buckets` Map with a shared store — e.g.
 * `rate-limiter-flexible` backed by Redis (sliding window / token bucket), or a
 * Lua `INCR`+`EXPIRE` script keyed the same `(token, ip)` way. The middleware
 * surface (keyFn → allow/deny → 429) stays identical; only the counter store
 * moves out-of-process. Keep the same 60/min default so behaviour is unchanged.
 * ───────────────────────────────────────────────────────────────────────────
 */

const DEFAULT_CAPACITY = 60; // tokens per window
const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute

// key -> { tokens, updatedAt }. Module-scoped so all requests share one store.
const buckets = new Map();

// Periodically drop idle buckets so a flood of distinct keys can't grow the Map
// unbounded. An entry is stale once it would have fully refilled anyway.
const SWEEP_EVERY_MS = 5 * 60 * 1000;
let lastSweep = 0;

const sweep = (now, windowMs) => {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (now - b.updatedAt > windowMs * 2) buckets.delete(key);
  }
};

/**
 * Core token-bucket decision. Refills `capacity` tokens linearly over
 * `windowMs`, spends one token per call. Pure-ish (mutates the shared Map);
 * exported for unit tests so the refill/overflow math can be exercised without
 * Express. Returns `{ allowed, remaining, retryAfterMs }`.
 */
const take = (key, now, capacity = DEFAULT_CAPACITY, windowMs = DEFAULT_WINDOW_MS) => {
  const refillPerMs = capacity / windowMs;
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: capacity, updatedAt: now };
    buckets.set(key, b);
  }
  // Refill based on elapsed time, capped at capacity.
  const elapsed = Math.max(0, now - b.updatedAt);
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
  b.updatedAt = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
  }
  // Not enough for one token — time until one token has refilled.
  const retryAfterMs = Math.ceil((1 - b.tokens) / refillPerMs);
  return { allowed: false, remaining: 0, retryAfterMs };
};

/** Default key extractor — `(token, ip)`. `req.params.token` is the webhook id. */
const defaultKeyFn = (req) =>
  `${req.params && req.params.token ? req.params.token : 'global'}:${req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'}`;

/**
 * Build an Express middleware enforcing the token bucket.
 *
 * @param {Object} [opts]
 * @param {number} [opts.capacity=60]   - tokens per window
 * @param {number} [opts.windowMs=60000]- refill window
 * @param {Function} [opts.keyFn]       - (req) => string bucket key
 */
const rateLimit = (opts = {}) => {
  const capacity = opts.capacity || DEFAULT_CAPACITY;
  const windowMs = opts.windowMs || DEFAULT_WINDOW_MS;
  const keyFn = typeof opts.keyFn === 'function' ? opts.keyFn : defaultKeyFn;

  return (req, res, next) => {
    const now = Date.now();
    sweep(now, windowMs);
    const key = keyFn(req);
    const { allowed, remaining, retryAfterMs } = take(key, now, capacity, windowMs);

    res.setHeader('X-RateLimit-Limit', String(capacity));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (!allowed) {
      res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({ error: 'Rate limit exceeded. Try again shortly.' });
    }
    return next();
  };
};

/**
 * Warn at startup if a replica hint suggests the single-process bucket won't
 * meter accurately across instances. Idempotent enough to call once on boot.
 */
const warnIfMultiReplica = () => {
  const hint = Number(process.env.SERVER_REPLICAS || process.env.WEB_CONCURRENCY || 0);
  if (hint > 2) {
    console.warn(
      `[rateLimit] ${hint} replicas detected — the in-memory token bucket is ` +
        'per-process, so the effective limit is ~N× the configured rate. ' +
        'Move to a Redis-backed limiter (see comment block in rateLimit.js).'
    );
  }
};

// Exported for tests so a deterministic store can be reset between cases.
const _reset = () => {
  buckets.clear();
  lastSweep = 0;
};

module.exports = rateLimit;
module.exports.rateLimit = rateLimit;
module.exports.take = take;
module.exports.defaultKeyFn = defaultKeyFn;
module.exports.warnIfMultiReplica = warnIfMultiReplica;
module.exports._reset = _reset;
module.exports.DEFAULT_CAPACITY = DEFAULT_CAPACITY;
module.exports.DEFAULT_WINDOW_MS = DEFAULT_WINDOW_MS;
