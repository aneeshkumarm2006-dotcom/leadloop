/**
 * captureController.js — public endpoints behind the no-code website snippet.
 *
 *   GET  /capture.js                      the snippet script itself
 *   GET  /api/capture/:siteKey/config     form selector + consent wording
 *   POST /api/capture/:siteKey            one form submission → a lead
 *
 * Trust model: the site key is PUBLIC (it sits in the client's page source).
 * What makes it safe is the domain lock — every request must come from one of
 * the connection's `allowedDomains` (Origin header, Referer fallback) — plus
 * per-visitor and per-site rate limits and two bot checks (a hidden honeypot
 * field the script adds, and a minimum time between the form appearing and
 * being submitted). Bot drops answer 204 like a success so bots learn nothing.
 *
 * The submission feeds the same pipeline as every other source
 * (leadIngestService.ingestForConnection): ad attribution, consent, columns,
 * duplicates, SLA clock, events and the Meta/Google send-back.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const LeadConnection = require('../models/LeadConnection');
const { ingestForConnection, LeadIngestError } = require('../services/leadIngestService');
const { checkRequestSite } = require('../utils/siteDomains');

const SCRIPT_PATH = path.join(__dirname, '../public/leadloop-capture.js');
const MAX_FIELDS = 60;
const MIN_ELAPSED_MS = 1500; // a human can't find, fill and submit a form faster
const SITE_KEY_RE = /^site_[a-z0-9]{8,32}$/;

let scriptCache = null;
const readScript = () => {
  if (!scriptCache || process.env.NODE_ENV !== 'production') scriptCache = fs.readFileSync(SCRIPT_PATH, 'utf8');
  return scriptCache;
};

/** The visitor's IP: first X-Forwarded-For hop (set by the host's proxy), else the socket. */
const clientIp = (req) => {
  const first = String(req.get('x-forwarded-for') || '').split(',')[0].trim();
  if (first && net.isIP(first)) return first;
  return req.ip || (req.socket && req.socket.remoteAddress) || '';
};

/**
 * Pure screen of a submission body. Returns { ok, reason, payload } — `payload`
 * is the lead with the snippet's control fields (`_ll_*`) removed.
 *   reason: 'invalid_body' | 'too_many_fields' | 'honeypot' | 'too_fast' | 'empty'
 * Bot reasons (honeypot / too_fast) are dropped silently by the caller.
 */
const screenSubmission = (body) => {
  let data = body;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, reason: 'invalid_body' };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'invalid_body' };
  const keys = Object.keys(data);
  if (keys.length > MAX_FIELDS + 10) return { ok: false, reason: 'too_many_fields' };
  if (String(data._ll_hp || '').trim() !== '') return { ok: false, reason: 'honeypot' };
  const elapsed = Number(data._ll_elapsed);
  if (!Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_MS) return { ok: false, reason: 'too_fast' };

  const payload = {};
  for (const k of keys) {
    if (k.startsWith('_ll_')) continue;
    const v = data[k];
    if (v == null || typeof v === 'object') continue; // flat strings/numbers/bools only
    payload[k] = typeof v === 'string' ? v.slice(0, 5000) : v;
  }
  if (Object.keys(payload).length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, payload };
};

const findBySiteKey = async (siteKey) => {
  if (!SITE_KEY_RE.test(String(siteKey || ''))) return null;
  return LeadConnection.findOne({ siteKey, sourceType: 'website_snippet', enabled: true });
};

const allowOrigin = (res, origin) => {
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
};

/** GET /capture.js — the snippet. Cached briefly; any site may load it (it's inert without a valid key + domain). */
const serveScript = (req, res) => {
  try {
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(readScript());
  } catch (err) {
    console.error('[capture] serveScript error:', err.message);
    return res.status(500).type('text/plain').send('// LeadLoop capture script unavailable');
  }
};

/** GET /api/capture/:siteKey/config — only answered for allowed domains. */
const getConfig = async (req, res) => {
  try {
    const connection = await findBySiteKey(req.params.siteKey);
    if (!connection) return res.status(404).json({ error: 'Unknown site' });
    const site = checkRequestSite(req.get('origin'), req.get('referer'), connection.allowedDomains);
    if (!site.allowed) return res.status(403).json({ error: 'This domain is not allowed for this site key' });
    allowOrigin(res, site.origin);
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({
      formSelector: connection.snippet?.formSelector || '',
      consentWording: connection.snippet?.consentWording || '',
      accent: connection.snippet?.accent || '',
    });
  } catch (err) {
    console.error('[capture] getConfig error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/capture/:siteKey — body is JSON sent as text/plain (no CORS preflight). */
const submit = async (req, res) => {
  try {
    const connection = await findBySiteKey(req.params.siteKey);
    if (!connection) return res.status(404).json({ error: 'Unknown site' });
    const site = checkRequestSite(req.get('origin'), req.get('referer'), connection.allowedDomains);
    if (!site.allowed) return res.status(403).json({ error: 'This domain is not allowed for this site key' });
    allowOrigin(res, site.origin);

    const screened = screenSubmission(req.body);
    if (!screened.ok) {
      if (screened.reason === 'honeypot' || screened.reason === 'too_fast') return res.status(204).end();
      return res.status(400).json({ error: screened.reason });
    }

    // The request comes straight from the visitor's browser, so its IP/UA are
    // the visitor's — record them for consent evidence and Meta matching.
    const ip = clientIp(req);
    const userAgent = String(req.get('user-agent') || '').slice(0, 512);
    const payload = { ...screened.payload };
    if (!payload.client_ip && ip && net.isIP(ip)) payload.client_ip = ip;
    if (!payload.client_user_agent && userAgent) payload.client_user_agent = userAgent;

    await ingestForConnection(connection._id, payload, { ip, userAgent });
    return res.status(204).end();
  } catch (err) {
    if (err instanceof LeadIngestError) return res.status(err.status).json({ error: err.message });
    console.error('[capture] submit error:', err?.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { serveScript, getConfig, submit, screenSubmission, clientIp, MIN_ELAPSED_MS, SITE_KEY_RE };
