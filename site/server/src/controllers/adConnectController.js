/**
 * adConnectController.js — HTTP layer for one-click ad connections.
 *
 * Admin routes (authMiddleware + requireOrgAdmin on :id, see routes/adConnect.js):
 *   GET  /api/workspaces/:id/ad-connect/overview
 *   POST /api/workspaces/:id/ad-connect/:platform/start         { gtm? } → { url }
 *   POST /api/workspaces/:id/ad-connect/:platform/confirm       { pendingId } → { <platform>: … }
 *   GET  /api/workspaces/:id/ad-connect/meta/assets
 *   GET  /api/workspaces/:id/ad-connect/meta/pixels?adAccountId=act_…
 *   POST /api/workspaces/:id/ad-connect/meta/select
 *   POST /api/workspaces/:id/ad-connect/meta/lead-ads
 *   POST /api/workspaces/:id/ad-connect/meta/disconnect
 *   GET  /api/workspaces/:id/ad-connect/google/accounts
 *   POST /api/workspaces/:id/ad-connect/google/select
 *   GET  /api/workspaces/:id/ad-connect/google/gtm/containers
 *   POST /api/workspaces/:id/ad-connect/google/gtm/install
 *   POST /api/workspaces/:id/ad-connect/google/disconnect
 *   GET  /api/workspaces/:id/ad-connect/tiktok/assets
 *   GET  /api/workspaces/:id/ad-connect/tiktok/pixels?advertiserId=
 *   POST /api/workspaces/:id/ad-connect/tiktok/select
 *   POST /api/workspaces/:id/ad-connect/tiktok/test
 *   POST /api/workspaces/:id/ad-connect/tiktok/disconnect
 *
 * Public (see the PUBLIC ROUTE ALLOWLIST in app.js):
 *   GET  /api/ad-connect/callback/:platform        OAuth return (signed single-use state) →
 *                                                  parks the grant, redirects with &pending=<id>
 *   GET  /api/ad-connect/webhooks/meta             hub.challenge verification
 *   POST /api/ad-connect/webhooks/meta             leadgen (X-Hub-Signature-256 over raw body)
 *   POST /api/ad-connect/webhooks/tiktok?k=…       Instant Form leads (URL secret + signature)
 *
 * Errors: clients only ever see fixed, generic messages; platform detail stays
 * in server logs (which never contain tokens).
 */

const svc = require('../services/adConnectService');
const { PlatformError } = require('../services/adConnectHttp');
const metaGraph = require('../services/metaGraph');

const CLIENT_URL = () => String(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
const PLATFORM_LABEL = { meta: 'Meta', google: 'Google', tiktok: 'TikTok', gtm: 'Google Tag Manager' };

const fail = (res, err, label, platform) => {
  if (err instanceof svc.ConnectError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err instanceof PlatformError) {
    console.warn(`[ad-connect] ${label}:`, err.message);
    const name = PLATFORM_LABEL[platform] || 'The ad platform';
    if (err.code === 'platform_auth') {
      return res.status(409).json({ error: `Your ${name} sign-in has expired or was revoked. Please reconnect.`, code: 'reauth_required' });
    }
    if (err.status === 400 || err.status === 409) {
      return res.status(409).json({ error: `${name} could not complete this step. Check the account and try again.`, code: err.code || 'platform_error' });
    }
    return res.status(502).json({ error: `${name} is not responding as expected. Please try again.`, code: 'platform_error' });
  }
  console.error(`[ad-connect] ${label} error:`, err && err.message ? err.message : err);
  return res.status(500).json({ error: 'Server error' });
};

const handler = (label, platform, fn) => async (req, res) => {
  try {
    return res.json(await fn(req, res));
  } catch (err) {
    return fail(res, err, label, platform);
  }
};

const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
const ws = (req) => String(req.params.id);

// --- admin ------------------------------------------------------------------------

const overview = handler('overview', null, (req) => svc.overview(ws(req), req));

const start = async (req, res) => {
  const { platform } = req.params;
  try {
    const url = await svc.startOAuth({ platform, workspaceId: ws(req), userId: req.user.userId, gtm: body(req).gtm === true });
    return res.json({ url });
  } catch (err) {
    return fail(res, err, 'start', platform);
  }
};

/** POST /:platform/confirm { pendingId } — claim a pending sign-in. */
const confirm = async (req, res) => {
  const { platform } = req.params;
  try {
    return res.json(await svc.confirmOAuth({ platform, workspaceId: ws(req), userId: req.user.userId, pendingId: body(req).pendingId }));
  } catch (err) {
    return fail(res, err, 'confirm', platform);
  }
};

const metaAssets = handler('meta assets', 'meta', (req) => svc.metaAssets(ws(req)));
const metaPixels = handler('meta pixels', 'meta', (req) => svc.metaPixels(ws(req), String(req.query.adAccountId || '')));
const metaSelect = handler('meta select', 'meta', (req) => svc.metaSelect(ws(req), body(req)));
const metaLeadAds = handler('meta lead-ads', 'meta', (req) => svc.metaLeadAds(ws(req), body(req), { userId: req.user.userId }));
const metaDisconnect = handler('meta disconnect', 'meta', (req) => svc.metaDisconnect(ws(req)));

const googleAccounts = handler('google accounts', 'google', (req) => svc.googleAccounts(ws(req)));
const googleSelect = handler('google select', 'google', (req) => svc.googleSelect(ws(req), body(req), { userId: req.user.userId, req }));
const gtmContainers = handler('gtm containers', 'gtm', (req) => svc.gtmContainers(ws(req)));
const gtmInstall = handler('gtm install', 'gtm', (req) => svc.gtmInstall(ws(req), body(req), { req }));
const googleDisconnect = handler('google disconnect', 'google', (req) => svc.googleDisconnect(ws(req)));

const tiktokAssets = handler('tiktok assets', 'tiktok', (req) => svc.tiktokAssets(ws(req)));
const tiktokPixels = handler('tiktok pixels', 'tiktok', (req) => svc.tiktokPixels(ws(req), String(req.query.advertiserId || '')));
const tiktokSelect = handler('tiktok select', 'tiktok', (req) => svc.tiktokSelect(ws(req), body(req), { userId: req.user.userId }));
const tiktokTest = handler('tiktok test', 'tiktok', (req) => svc.tiktokTest(ws(req), body(req)));
const tiktokDisconnect = handler('tiktok disconnect', 'tiktok', (req) => svc.tiktokDisconnect(ws(req)));

// --- public -----------------------------------------------------------------------

// Short, fixed reasons only — provider text is never reflected into the URL.
const REDIRECT_REASONS = new Set(['cancelled', 'expired', 'not_allowed', 'failed', 'not_configured']);

/** GET /api/ad-connect/callback/:platform */
const callback = async (req, res) => {
  const platform = ['meta', 'google', 'tiktok'].includes(req.params.platform) ? req.params.platform : null;
  const back = (params) => res.redirect(302, `${CLIENT_URL()}/settings?${new URLSearchParams({ tab: 'ads', ...params })}`);
  if (!platform) return back({ connect_error: 'failed' });
  try {
    const { pendingId } = await svc.completeOAuth({ platform, query: req.query || {} });
    return back({ connect: platform, pending: pendingId });
  } catch (err) {
    let reason = 'failed';
    if (err instanceof svc.ConnectError && REDIRECT_REASONS.has(err.code)) reason = err.code;
    if (!(err instanceof svc.ConnectError)) console.warn(`[ad-connect] ${platform} callback failed:`, err && err.message);
    return back({ connect: platform, connect_error: reason });
  }
};

/** GET /api/ad-connect/webhooks/meta — subscription verification. */
const metaWebhookVerify = (req, res) => {
  const challenge = metaGraph.verifyChallenge(req.query || {});
  if (!challenge) return res.sendStatus(403);
  return res.type('text/plain').send(challenge);
};

/** POST /api/ad-connect/webhooks/meta — raw body; verify, 200 fast, process async. */
const metaWebhook = (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : null;
  if (!raw || !metaGraph.verifySignature(raw, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }
  res.sendStatus(200);
  setImmediate(() => {
    svc.processMetaWebhook(parsed).catch((err) => console.error('[meta] webhook processing error:', err && err.message));
  });
  return undefined;
};

/** POST /api/ad-connect/webhooks/tiktok?k=… */
const tiktokWebhook = async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : null;
    if (!raw) return res.sendStatus(400);
    const config = await svc.authenticateTikTokWebhook({
      key: typeof req.query.k === 'string' ? req.query.k : '',
      rawBody: raw,
      signatureHeader: req.get('tiktok-signature') || req.get('x-tiktok-signature') || '',
    });
    if (!config) return res.sendStatus(401);
    let parsed;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }
    res.sendStatus(200);
    setImmediate(() => {
      svc.processTikTokWebhook(config, parsed).catch((err) => console.error('[tiktok] webhook processing error:', err && err.message));
    });
    return undefined;
  } catch (err) {
    console.error('[tiktok] webhook error:', err && err.message);
    return res.sendStatus(500);
  }
};

module.exports = {
  overview,
  start,
  confirm,
  metaAssets,
  metaPixels,
  metaSelect,
  metaLeadAds,
  metaDisconnect,
  googleAccounts,
  googleSelect,
  gtmContainers,
  gtmInstall,
  googleDisconnect,
  tiktokAssets,
  tiktokPixels,
  tiktokSelect,
  tiktokTest,
  tiktokDisconnect,
  callback,
  metaWebhookVerify,
  metaWebhook,
  tiktokWebhook,
};
