/**
 * leadConnections.js — lead-connection routers (Phase 4b, F14.4).
 *
 * Exports TWO routers because the ingest surface is unauthenticated (API-key
 * auth in the service) and management is admin/board-scoped:
 *
 *   - `publicLeadRouter` — `POST /api/leads/ingest`. Mounted in app.js BEFORE
 *     the global CORS layer and any auth-gated router, WITHOUT `authMiddleware`.
 *     It carries its OWN body parsers (JSON + urlencoded, both capped at 256KB —
 *     the global `express.json()` mounts after it), its OWN permissive CORS
 *     (external customer websites POST here from the browser), and the
 *     token-bucket rate limiter keyed per `(apiKey, ip)` (60/min → 429).
 *
 *   - `boardLeadRouter` — authed management; every handler re-checks board
 *     membership (reads) / workspace-admin (writes).
 *
 * See the PUBLIC ROUTE ALLOWLIST comment block in app.js.
 */

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const authMiddleware = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const {
  ingest,
  listConnections,
  createConnection,
  rotateKey,
  updateConnection,
  resetSchema,
  deleteConnection,
  listSubmissions,
} = require('../controllers/leadConnectionController');

// Rate-limit key: the presented API key (hashed so the raw key never lands in
// the in-memory bucket map) + ip. Falls back to ip-only when no key is sent.
const ingestKeyFn = (req) => {
  const raw =
    req.get('x-api-key') ||
    (/^Bearer\s+(.+)$/i.exec(req.get('authorization') || '') || [])[1] ||
    '';
  const keyPart = raw ? crypto.createHash('sha256').update(raw.trim()).digest('hex').slice(0, 16) : 'anon';
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  return `lead:${keyPart}:${ip}`;
};

// Browser-facing CORS: customers' websites call this endpoint from their own
// origins, so preflights must be answered permissively. Safe because auth is
// the API key header, never cookies (`credentials` stays false). app.js mounts
// this router BEFORE the global origin-restricted `cors()` — that layer ends
// OPTIONS preflights itself, so it must never see this route's.
const ingestCors = cors({
  origin: true, // reflect the caller's origin
  credentials: false,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
  maxAge: 86400,
});

// --- Public ingest router (NO auth) ----------------------------------------
const publicLeadRouter = express.Router();
publicLeadRouter.options('/api/leads/ingest', ingestCors);
publicLeadRouter.post(
  '/api/leads/ingest',
  ingestCors,
  rateLimit({ keyFn: ingestKeyFn }),
  express.json({ limit: '256kb' }), // body caps on this route only
  express.urlencoded({ extended: true, limit: '256kb' }), // zero-JS <form> posts
  ingest
);

// --- Admin board-scoped router (auth required) -----------------------------
const boardLeadRouter = express.Router();
boardLeadRouter.use(authMiddleware);
boardLeadRouter.get('/boards/:id/lead-connections', listConnections);
boardLeadRouter.post('/boards/:id/lead-connections', createConnection);
boardLeadRouter.post('/lead-connections/:cid/rotate', rotateKey);
boardLeadRouter.post('/lead-connections/:cid/reset-schema', resetSchema);
boardLeadRouter.patch('/lead-connections/:cid', updateConnection);
boardLeadRouter.delete('/lead-connections/:cid', deleteConnection);
boardLeadRouter.get('/lead-connections/:cid/submissions', listSubmissions);

module.exports = { publicLeadRouter, boardLeadRouter };
