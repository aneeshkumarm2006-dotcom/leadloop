/**
 * adConnectService.js — one-click ad-platform connections ("Ads & tracking").
 *
 * A workspace admin signs in with Meta / Google / TikTok (OAuth), picks
 * accounts from dropdowns, and LeadLoop:
 *   - Meta:   stores the (long-lived) token, creates/picks a pixel (= CAPI
 *             dataset), subscribes Pages to Lead Ads and pulls each lead via
 *             the leadgen webhook into a LeadConnection.
 *   - Google: stores a refresh token, finds/creates the two offline conversion
 *             actions, turns on auto-tagging, reads the AW- tag id, and can
 *             install the website tag through Google Tag Manager.
 *   - TikTok: stores the advertiser token, creates/picks a pixel (Events API),
 *             and subscribes Instant Form leads to our webhook.
 *
 * Security model:
 *   - every workspace function is called only behind authMiddleware +
 *     requireOrgAdmin; every id coming from the client (board, connection,
 *     ad account, customer, advertiser, pixel) is re-validated against what
 *     this workspace / this token can actually see;
 *   - tokens are AES-encrypted at rest (aesEncrypt) and never serialised;
 *   - the OAuth state is a signed, single-use, user+workspace-bound JWT, and
 *     the callback re-checks that the user is still a workspace admin;
 *   - the callback never activates a token: it parks it (encrypted, 10 min,
 *     one-time pendingId) until the admin who started the flow confirms it
 *     from their own authenticated session (confirmOAuth);
 *   - public webhooks are authenticated (Meta: HMAC of the raw body; TikTok:
 *     per-workspace URL secret + signature when present) and idempotent.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const aesEncrypt = require('../utils/aesEncrypt');
const { publicBaseUrl } = require('../utils/publicBaseUrl');
const stateSvc = require('./adConnectState');
const { PlatformError } = require('./adConnectHttp');
const metaGraph = require('./metaGraph');
const googleAdsApi = require('./googleAdsApi');
const googleTagManager = require('./googleTagManager');
const tiktokApi = require('./tiktokApi');

const models = () => ({
  AdConversionConfig: require('../models/AdConversionConfig'),
  ConversionEvent: require('../models/ConversionEvent'),
  LeadConnection: require('../models/LeadConnection'),
  LeadIngestLog: require('../models/LeadIngestLog'),
  AdLeadReceipt: require('../models/AdLeadReceipt'),
  Board: require('../models/Board'),
  Task: require('../models/Task'),
  Organisation: require('../models/Organisation'),
});

const DAY = 24 * 3600e3;
const asId = (v) => (v == null ? '' : String(v));
const isObjectId = (v) => typeof v === 'string' && mongoose.Types.ObjectId.isValid(v) && /^[0-9a-f]{24}$/i.test(v);
const decryptToken = (cipher) => {
  if (!cipher) return null;
  const m = aesEncrypt.decryptWithMeta(cipher);
  return m ? m.plaintext : null;
};
const clean = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

/** A client-facing error with a fixed, generic message. */
class ConnectError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'bad_request';
  }
}

// --- environment ----------------------------------------------------------------

const redirectUri = (platform) => `${publicBaseUrl()}/api/ad-connect/callback/${platform}`;
const tiktokWebhookUrl = (key) => `${publicBaseUrl()}/api/ad-connect/webhooks/tiktok?k=${encodeURIComponent(key)}`;

const availability = () => {
  const encryption = aesEncrypt.isConfigured();
  const google = googleAdsApi.isConfigured() && encryption;
  return {
    meta: metaGraph.isConfigured() && encryption,
    google,
    tiktok: tiktokApi.isConfigured() && encryption,
    gtm: google,
    encryption,
  };
};

/** Same tag the Lead Sources page shows (leadConnectionController.snippetTag). */
const snippetTagFor = (connection, req) =>
  connection && connection.siteKey
    ? `<script src="${publicBaseUrl(req)}/capture.js" data-site="${connection.siteKey}" defer></script>`
    : '';

const loadConfig = async (workspaceId) => {
  const { AdConversionConfig } = models();
  let config = await AdConversionConfig.findOne({ workspaceId });
  if (!config) config = new AdConversionConfig({ workspaceId });
  return config;
};

/** The board must belong to this workspace (IDOR guard). */
const assertWorkspaceBoard = async (workspaceId, boardId) => {
  const { Board } = models();
  if (!isObjectId(boardId)) throw new ConnectError(400, 'Choose a board for incoming leads.', 'invalid_board');
  const board = await Board.findOne({ _id: boardId, organisation: workspaceId }).select('_id name').lean();
  if (!board) throw new ConnectError(404, 'Board not found in this workspace.', 'invalid_board');
  return board;
};

/** Workspace board ids (for scoping LeadConnection queries). */
const workspaceBoardIds = async (workspaceId) => {
  const { Board } = models();
  return (await Board.find({ organisation: workspaceId }).select('_id').lean()).map((b) => b._id);
};

/** Is `userId` (still) the main or an extra admin of the workspace? */
const isWorkspaceAdmin = async (workspaceId, userId) => {
  const { Organisation } = models();
  if (!isObjectId(asId(workspaceId))) return false;
  const org = await Organisation.findById(workspaceId).select('admin admins').lean();
  if (!org || !userId) return false;
  return asId(org.admin) === asId(userId) || (org.admins || []).some((a) => asId(a) === asId(userId));
};

/**
 * Create (or re-point) an internal lead connection — no API key: leads are
 * pulled by us, never posted by a third party with a key.
 */
const ensureInternalConnection = async ({ existingId, boardId, sourceType, name, userId }) => {
  const { LeadConnection } = models();
  if (existingId) {
    const existing = await LeadConnection.findById(existingId);
    if (existing && asId(existing.boardId) === asId(boardId) && existing.sourceType === sourceType) {
      existing.enabled = true;
      existing.name = name;
      await existing.save();
      return existing;
    }
    // Moving to another board: the old connection's columns belong to the old
    // board, so retire it and start a fresh one.
    if (existing) {
      existing.enabled = false;
      await existing.save();
    }
  }
  const created = new LeadConnection({ boardId, name, sourceType, createdBy: userId || undefined, attributeSource: true });
  // No API key: leave tokenHash ABSENT (not null) — the unique `tokenHash`
  // index is sparse, which still indexes explicit nulls.
  created.tokenHash = undefined;
  await created.save();
  return created;
};

const disableConnection = async (connectionId) => {
  const { LeadConnection } = models();
  if (!connectionId) return;
  await LeadConnection.updateOne({ _id: connectionId }, { $set: { enabled: false } });
};

// --- serialisers (never include tokens) -------------------------------------------

const platformStats = async (workspaceId) => {
  const { ConversionEvent } = models();
  const since = new Date(Date.now() - 7 * DAY);
  const [last, errors, sent] = await Promise.all([
    ConversionEvent.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(asId(workspaceId)), status: 'sent' } },
      { $group: { _id: '$platform', at: { $max: '$sentAt' } } },
    ]),
    ConversionEvent.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(asId(workspaceId)), status: { $in: ['failed', 'dead'] }, updatedAt: { $gte: since } } },
      { $group: { _id: '$platform', n: { $sum: 1 } } },
    ]),
    ConversionEvent.aggregate([
      { $match: { workspaceId: new mongoose.Types.ObjectId(asId(workspaceId)), status: 'sent', sentAt: { $gte: since } } },
      { $group: { _id: '$platform', n: { $sum: 1 } } },
    ]),
  ]);
  const pick = (rows, key, platform, dflt) => (rows.find((r) => r._id === platform) || {})[key] ?? dflt;
  const out = {};
  for (const p of ['meta', 'google', 'tiktok']) {
    out[p] = { lastSentAt: pick(last, 'at', p, null), errorsThisWeek: pick(errors, 'n', p, 0), sentLast7d: pick(sent, 'n', p, 0) };
  }
  return out;
};

const metaStatus = (c) => {
  const conn = (c.meta && c.meta.connection) || {};
  if (conn.status && conn.status !== 'none') return conn.status;
  return c.meta && c.meta.enabled && c.meta.datasetId && c.meta.accessToken ? 'ready' : 'none';
};

const googleStatus = (c) => {
  const conn = (c.google && c.google.connection) || {};
  if (conn.status && conn.status !== 'none') return conn.status;
  return c.google && c.google.enabled && c.google.customerId ? 'ready' : 'none';
};

const serializeMeta = (c, stats = {}) => {
  const m = c.meta || {};
  const conn = m.connection || {};
  return {
    status: metaStatus(c),
    method: conn.method || 'manual',
    userName: conn.userName || '',
    businessName: conn.businessName || '',
    adAccountId: conn.adAccountId || '',
    adAccountName: conn.adAccountName || '',
    pixelId: m.datasetId || '',
    pixelName: conn.pixelName || '',
    live: !!(m.enabled && m.datasetId && m.accessToken && !m.testEventCode),
    tokenExpiresAt: conn.tokenExpiresAt || null,
    pages: (conn.pages || []).map((p) => ({ pageId: p.pageId, name: p.name || '', subscribed: !!p.subscribed, hasInstagram: !!p.instagramId })),
    lastSentAt: stats.lastSentAt || null,
    errorsThisWeek: stats.errorsThisWeek || 0,
  };
};

const serializeGoogle = (c, stats = {}) => {
  const g = c.google || {};
  const conn = g.connection || {};
  const gtm = conn.gtm || {};
  return {
    status: googleStatus(c),
    method: conn.method || 'agency',
    email: conn.email || '',
    customerId: g.customerId || '',
    customerName: conn.customerName || '',
    conversionActions: { qualified: g.conversionActions?.qualified || '', customer: g.conversionActions?.customer || '' },
    autoTagging: !!conn.autoTagging,
    conversionTrackingId: conn.conversionTrackingId || '',
    gtm: gtm.containerPublicId ? { containerPublicId: gtm.containerPublicId, publishedAt: gtm.publishedAt || null } : null,
    hasGtmAccess: googleAdsApi.hasGtmScopes(conn.scopes || []),
    leadFormConnectionId: conn.leadFormConnectionId ? asId(conn.leadFormConnectionId) : null,
    lastSentAt: stats.lastSentAt || null,
    errorsThisWeek: stats.errorsThisWeek || 0,
  };
};

const serializeTikTok = (c, stats = {}) => {
  const t = c.tiktok || {};
  const conn = t.connection || {};
  const forms = t.instantForms || {};
  return {
    status: conn.status || 'none',
    userName: conn.userName || '',
    advertiserId: t.advertiserId || '',
    advertiserName: t.advertiserName || '',
    pixelCode: t.pixelCode || '',
    pixelName: t.pixelName || '',
    live: !!(t.enabled && t.pixelCode && t.accessToken && !t.testEventCode),
    instantForms: { enabled: !!forms.enabled, connectionId: forms.connectionId ? asId(forms.connectionId) : null },
    lastSentAt: stats.lastSentAt || null,
    errorsThisWeek: stats.errorsThisWeek || 0,
  };
};

// --- overview ---------------------------------------------------------------------

const AD_LEAD_SOURCES = { facebook_lead_ads: 'meta', instagram_lead_ads: 'meta', meta_ads: 'meta', google_ads: 'google', tiktok_lead_ads: 'tiktok' };

const overview = async (workspaceId, req) => {
  const { LeadConnection, LeadIngestLog, ConversionEvent, Task } = models();
  // eslint-disable-next-line global-require
  const { getChecklist } = require('./adTrackingService');
  const config = await loadConfig(workspaceId);
  const boardIds = await workspaceBoardIds(workspaceId);
  const since = new Date(Date.now() - 7 * DAY);

  const [stats, connections, checklist, recentEvents] = await Promise.all([
    platformStats(workspaceId),
    boardIds.length ? LeadConnection.find({ boardId: { $in: boardIds } }).lean() : [],
    getChecklist(workspaceId),
    ConversionEvent.find({ workspaceId }).sort({ updatedAt: -1 }).limit(10).lean(),
  ]);

  const websites = connections
    .filter((c) => c.sourceType === 'website_snippet' && c.siteKey)
    .map((c) => {
      const sn = c.snippet || {};
      return {
        connectionId: asId(c._id),
        name: c.name || '',
        boardId: asId(c.boardId),
        enabled: c.enabled !== false,
        domains: c.allowedDomains || [],
        siteKey: c.siteKey,
        snippetTag: snippetTagFor(c, req),
        lastSeenAt: sn.lastSeenAt || null,
        pagesSeen: Array.isArray(sn.pagesSeen) ? sn.pagesSeen.length : 0,
        submissionCount: c.submissionCount || 0,
        lastSubmissionAt: c.lastSubmissionAt || null,
        lastCheck: sn.lastCheck || null,
        loadPixels: sn.loadPixels !== false,
      };
    });

  const allConnIds = connections.map((c) => c._id);
  const adConns = connections.filter((c) => AD_LEAD_SOURCES[c.sourceType]);
  const platformByConn = new Map(adConns.map((c) => [asId(c._id), AD_LEAD_SOURCES[c.sourceType]]));
  const [leadsCaptured, recentLeads] = await Promise.all([
    allConnIds.length ? LeadIngestLog.countDocuments({ connectionId: { $in: allConnIds }, status: { $ne: 'rejected' }, createdAt: { $gte: since } }) : 0,
    adConns.length
      ? LeadIngestLog.find({ connectionId: { $in: adConns.map((c) => c._id) }, status: { $ne: 'rejected' } })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('connectionId taskId createdAt')
        .lean()
      : [],
  ]);

  const taskIds = [...recentEvents.map((e) => e.taskId), ...recentLeads.map((l) => l.taskId)].filter(Boolean);
  const tasks = taskIds.length ? await Task.find({ _id: { $in: taskIds } }).select('name').lean() : [];
  const names = new Map(tasks.map((t) => [asId(t._id), t.name || '']));
  const recent = [
    ...recentEvents.map((e) => ({
      leadName: names.get(asId(e.taskId)) || '',
      platform: e.platform,
      stage: e.stage,
      status: e.status,
      at: e.sentAt || e.updatedAt || e.createdAt,
    })),
    ...recentLeads.map((l) => ({
      leadName: names.get(asId(l.taskId)) || '',
      platform: platformByConn.get(asId(l.connectionId)) || '',
      stage: 'lead',
      status: 'received',
      at: l.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 10);

  return {
    availability: availability(),
    meta: { ...serializeMeta(config, stats.meta), pendingConfirm: hasPending(config, 'meta') },
    google: { ...serializeGoogle(config, stats.google), pendingConfirm: hasPending(config, 'google') },
    tiktok: { ...serializeTikTok(config, stats.tiktok), pendingConfirm: hasPending(config, 'tiktok') },
    websites,
    sentLast7d: { leadsCaptured, meta: stats.meta.sentLast7d, google: stats.google.sentLast7d, tiktok: stats.tiktok.sentLast7d },
    recent,
    checklist,
  };
};

// --- OAuth ------------------------------------------------------------------------

const platformAvailable = (platform) => {
  const a = availability();
  if (!a.encryption) throw new ConnectError(503, 'Token encryption is not configured on this server.', 'not_configured');
  if (!a[platform]) throw new ConnectError(503, 'This connection is not available on this server yet.', 'not_configured');
};

/** POST /:platform/start → consent URL. Stores the single-use nonce hash. */
const startOAuth = async ({ platform, workspaceId, userId, gtm = false }) => {
  if (!stateSvc.isPlatform(platform)) throw new ConnectError(400, 'Unknown platform.', 'invalid_platform');
  platformAvailable(platform);
  const { AdConversionConfig } = models();
  const { state, nonceHash } = stateSvc.signState({ userId, workspaceId, platform, gtm: platform === 'google' && !!gtm });
  await AdConversionConfig.updateOne(
    { workspaceId },
    { $set: { [`oauthNonces.${platform}`]: nonceHash } },
    { upsert: true }
  );
  const uri = redirectUri(platform);
  if (platform === 'meta') return metaGraph.authUrl({ state, redirectUri: uri });
  if (platform === 'google') return googleAdsApi.authUrl({ state, redirectUri: uri, gtm: !!gtm });
  return tiktokApi.authUrl({ state, redirectUri: uri });
};

/**
 * Callback: verify state (signature, platform, single-use nonce, admin still),
 * exchange the code and park the result in an encrypted pending slot; returns
 * a one-time `pendingId` for the confirm step (nothing is activated here).
 * Throws ConnectError with a short `code` used in the redirect.
 */
const completeOAuth = async ({ platform, query, fetchImpl }) => {
  const { AdConversionConfig } = models();
  if (!stateSvc.isPlatform(platform)) throw new ConnectError(400, 'bad_platform', 'failed');
  if (query.error || query.error_reason) throw new ConnectError(400, 'cancelled', 'cancelled');
  const code = clean(query.code || query.auth_code, 2048);
  const state = typeof query.state === 'string' ? query.state : '';
  if (!code || !state) throw new ConnectError(400, 'missing_params', 'failed');

  let decoded;
  try {
    decoded = stateSvc.verifyState(state);
  } catch {
    throw new ConnectError(400, 'bad_state', 'expired');
  }
  if (decoded.platform !== platform) throw new ConnectError(400, 'platform_mismatch', 'failed');
  if (!(await isWorkspaceAdmin(decoded.workspaceId, decoded.userId))) throw new ConnectError(403, 'not_admin', 'not_allowed');

  // Consume the nonce atomically: a state works once.
  const consumed = await AdConversionConfig.findOneAndUpdate(
    { workspaceId: decoded.workspaceId, [`oauthNonces.${platform}`]: stateSvc.hashNonce(decoded.nonce) },
    { $set: { [`oauthNonces.${platform}`]: null } },
    { returnDocument: 'after' }
  );
  if (!consumed) throw new ConnectError(400, 'state_used', 'expired');
  platformAvailable(platform);

  const uri = redirectUri(platform);

  // Exchange the code, but DO NOT activate anything: the result waits in an
  // encrypted, one-time, 10-minute pending slot until the SAME LeadLoop admin
  // who clicked Connect confirms it from their own signed-in session (see
  // confirmOAuth). This stops a consent link minted in one workspace from
  // silently attaching someone else's ad account to it.
  let grant;
  if (platform === 'meta') {
    const { accessToken, expiresAt } = await metaGraph.exchangeCode({ code, redirectUri: uri, fetchImpl });
    const user = await metaGraph.me(accessToken, { fetchImpl });
    grant = { accessToken, expiresAt: expiresAt ? expiresAt.toISOString() : null, userId: String(user.id || ''), userName: clean(user.name, 120) };
  } else if (platform === 'google') {
    const { refreshToken, scopes, email } = await googleAdsApi.exchangeCode({ code, redirectUri: uri, fetchImpl });
    grant = { refreshToken, scopes: scopes.slice(0, 20), email: clean(email, 200) };
  } else {
    const { accessToken, advertiserIds } = await tiktokApi.exchangeCode({ code, fetchImpl });
    let name = '';
    try {
      name = (await tiktokApi.userInfo(accessToken, { fetchImpl })).name;
    } catch (err) {
      console.warn('[tiktok] user info skipped:', err.message);
    }
    grant = { accessToken, advertiserIds: advertiserIds.slice(0, 200), userName: clean(name, 120) };
  }

  const pendingId = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  consumed.pendingOAuth[platform] = {
    idHash: hashKey(pendingId),
    userId: String(decoded.userId),
    grant: aesEncrypt.encrypt(JSON.stringify(grant)),
    createdAt: new Date(now),
    expiresAt: new Date(now + PENDING_TTL_MS),
  };
  await consumed.save();
  return { workspaceId: asId(decoded.workspaceId), platform, pendingId };
};

const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_ID_RE = /^[0-9a-f]{48}$/;

/** Is there an unexpired pending (unconfirmed) sign-in for this platform? */
const hasPending = (config, platform, now = Date.now()) => {
  const p = config.pendingOAuth && config.pendingOAuth[platform];
  return !!(p && p.idHash && p.expiresAt && new Date(p.expiresAt).getTime() > now);
};

/** Activate a decrypted grant on the config exactly as the callback used to. */
const applyGrant = (config, platform, grant) => {
  if (platform === 'meta') {
    const conn = config.meta.connection;
    const sameUser = conn.status === 'ready' && conn.userId && conn.userId === grant.userId;
    config.setMetaUserToken(grant.accessToken);
    conn.method = 'oauth';
    conn.userId = grant.userId || '';
    conn.userName = grant.userName || '';
    conn.tokenExpiresAt = grant.expiresAt ? new Date(grant.expiresAt) : null;
    // Re-auth of the same Facebook user (e.g. token renewal): keep sending with the fresh token.
    if (sameUser) config.setMetaToken(grant.accessToken);
    else conn.status = 'authorized';
  } else if (platform === 'google') {
    const conn = config.google.connection;
    const sameUser = conn.status === 'ready' && conn.email && grant.email && conn.email.toLowerCase() === grant.email.toLowerCase();
    config.setGoogleRefreshToken(grant.refreshToken);
    conn.method = 'oauth';
    conn.email = grant.email || '';
    conn.scopes = grant.scopes || [];
    if (!sameUser) conn.status = 'authorized';
  } else {
    const t = config.tiktok;
    const ids = grant.advertiserIds || [];
    const sameAdvertiser = t.connection.status === 'ready' && t.advertiserId && ids.includes(t.advertiserId);
    config.setTikTokToken(grant.accessToken);
    t.connection.userName = grant.userName || '';
    t.connection.advertiserIds = ids;
    if (!sameAdvertiser) t.connection.status = 'authorized';
  }
};

const SERIALIZERS = { meta: (c, s) => serializeMeta(c, s), google: (c, s) => serializeGoogle(c, s), tiktok: (c, s) => serializeTikTok(c, s) };

/**
 * POST /:platform/confirm { pendingId } — the signed-in admin who started the
 * connect claims the pending sign-in. One-time and atomic.
 *   unknown / expired / already used → 410 pending_expired
 *   another user (or another workspace's slot) → 403 confirm_mismatch
 */
const confirmOAuth = async ({ platform, workspaceId, userId, pendingId }) => {
  const { AdConversionConfig } = models();
  if (!stateSvc.isPlatform(platform)) throw new ConnectError(400, 'Unknown platform.', 'invalid_platform');
  const expired = () => new ConnectError(410, 'This sign-in has expired. Please connect again.', 'pending_expired');
  if (typeof pendingId !== 'string' || !PENDING_ID_RE.test(pendingId)) throw expired();
  const idHash = hashKey(pendingId);
  const slot = `pendingOAuth.${platform}`;

  // Atomically take the slot only if EVERYTHING matches (id, user, workspace, not expired).
  const config = await AdConversionConfig.findOneAndUpdate(
    { workspaceId, [`${slot}.idHash`]: idHash, [`${slot}.userId`]: String(userId), [`${slot}.expiresAt`]: { $gt: new Date() } },
    { $set: { [slot]: null } },
    { returnDocument: 'before' }
  );
  if (!config) {
    // Tell apart "someone else's sign-in" from "gone": a live slot with this id
    // exists but belongs to another user / workspace.
    const other = await AdConversionConfig.findOne({ [`${slot}.idHash`]: idHash, [`${slot}.expiresAt`]: { $gt: new Date() } }).select('_id').lean();
    if (other) throw new ConnectError(403, 'This sign-in was started by someone else.', 'confirm_mismatch');
    throw expired();
  }
  const pending = config.pendingOAuth[platform];
  let grant;
  try {
    grant = JSON.parse(aesEncrypt.decrypt(pending.grant));
  } catch {
    throw expired();
  }
  config.pendingOAuth[platform] = null;
  applyGrant(config, platform, grant);
  await config.save();
  const stats = (await platformStats(workspaceId))[platform];
  return { [platform]: SERIALIZERS[platform](config, stats) };
};

// --- Meta -------------------------------------------------------------------------

const metaUserToken = (config) => {
  const token = config.getMetaUserToken() || (config.meta.connection.method === 'oauth' ? config.getMetaToken() : null);
  if (!token) throw new ConnectError(409, 'Sign in with Facebook first.', 'not_authorized');
  return token;
};

const ACT_RE = /^act_\d{1,25}$/;
const NUM_RE = /^\d{1,30}$/;

const metaAssets = async (workspaceId, { fetchImpl } = {}) => {
  const config = await loadConfig(workspaceId);
  const token = metaUserToken(config);
  const [user, businesses, adAccounts, pages] = await Promise.all([
    metaGraph.me(token, { fetchImpl }),
    metaGraph.listBusinesses(token, { fetchImpl }).catch((err) => {
      console.warn('[meta] business list skipped:', err.message);
      return [];
    }),
    metaGraph.listAdAccounts(token, { fetchImpl }),
    metaGraph.listPagesWithTokens(token, { fetchImpl }),
  ]);
  return {
    user: { id: String(user.id || ''), name: user.name || '' },
    businesses,
    adAccounts,
    pages: pages.map((p) => ({ id: p.id, name: p.name, hasInstagram: !!p.instagramId })), // no page tokens out
  };
};

const metaPixels = async (workspaceId, adAccountId, { fetchImpl } = {}) => {
  if (!ACT_RE.test(String(adAccountId || ''))) throw new ConnectError(400, 'Choose an ad account.', 'invalid_ad_account');
  const config = await loadConfig(workspaceId);
  const token = metaUserToken(config);
  return { pixels: await metaGraph.listPixels(token, adAccountId, { fetchImpl }) };
};

const metaSelect = async (workspaceId, body, { fetchImpl } = {}) => {
  const adAccountId = clean(body.adAccountId, 40);
  const businessId = clean(body.businessId, 30);
  const pixelId = clean(body.pixelId, 30);
  const createPixel = body.createPixel === true;
  if (!ACT_RE.test(adAccountId)) throw new ConnectError(400, 'Choose an ad account.', 'invalid_ad_account');
  if (businessId && !NUM_RE.test(businessId)) throw new ConnectError(400, 'Invalid business.', 'invalid_business');
  if (!createPixel && !NUM_RE.test(pixelId)) throw new ConnectError(400, 'Choose a pixel or create a new one.', 'invalid_pixel');

  const config = await loadConfig(workspaceId);
  const token = metaUserToken(config);

  // The ad account must be one this token can see.
  const accounts = await metaGraph.listAdAccounts(token, { fetchImpl });
  const account = accounts.find((a) => a.id === adAccountId);
  if (!account) throw new ConnectError(403, 'That ad account is not available to this Facebook login.', 'invalid_ad_account');
  let businessName = '';
  if (businessId) {
    const businesses = await metaGraph.listBusinesses(token, { fetchImpl }).catch(() => []);
    const biz = businesses.find((b) => b.id === businessId);
    if (!biz) throw new ConnectError(403, 'That business is not available to this Facebook login.', 'invalid_business');
    businessName = biz.name;
  }

  let pixel;
  if (createPixel) {
    const name = clean(body.pixelName, 100) || 'LeadLoop pixel';
    if (!/^[\p{L}\p{N} _.'·-]{1,100}$/u.test(name)) throw new ConnectError(400, 'Pixel name has unsupported characters.', 'invalid_pixel_name');
    pixel = await metaGraph.createPixel(token, adAccountId, name, { fetchImpl });
  } else {
    const pixels = await metaGraph.listPixels(token, adAccountId, { fetchImpl });
    if (!pixels.some((p) => p.id === pixelId)) throw new ConnectError(403, 'That pixel does not belong to the chosen ad account.', 'invalid_pixel');
    pixel = { id: pixelId };
  }
  // Read check: proves this token can reach the dataset before we switch it on.
  const verified = await metaGraph.readPixel(token, pixel.id, { fetchImpl });

  const conn = config.meta.connection;
  conn.method = 'oauth';
  conn.status = 'ready';
  conn.businessId = businessId || account.businessId || '';
  conn.businessName = businessName;
  conn.adAccountId = adAccountId;
  conn.adAccountName = account.name;
  conn.pixelName = verified.name || pixel.name || '';
  conn.connectedAt = new Date();
  config.meta.datasetId = verified.id;
  config.setMetaToken(token);
  config.meta.enabled = true;
  config.meta.lastTestOkAt = new Date();
  await config.save();
  return { meta: serializeMeta(config, (await platformStats(workspaceId)).meta) };
};

/** Subscribe chosen Pages to Lead Ads; unsubscribe the rest. */
const metaLeadAds = async (workspaceId, body, { userId, fetchImpl } = {}) => {
  const pageIds = Array.isArray(body.pageIds) ? [...new Set(body.pageIds.map((p) => clean(p, 30)))] : null;
  if (!pageIds || pageIds.length > 50 || pageIds.some((p) => !NUM_RE.test(p))) {
    throw new ConnectError(400, 'Choose up to 50 Pages.', 'invalid_pages');
  }
  const config = await loadConfig(workspaceId);
  const token = metaUserToken(config);
  const board = pageIds.length ? await assertWorkspaceBoard(workspaceId, clean(body.boardId, 30)) : null;
  const available = await metaGraph.listPagesWithTokens(token, { fetchImpl });
  const byId = new Map(available.map((p) => [p.id, p]));
  const missing = pageIds.filter((id) => !byId.has(id));
  if (missing.length) throw new ConnectError(403, 'Some Pages are not managed by this Facebook login.', 'invalid_pages');

  const conn = config.meta.connection;
  const existing = new Map((conn.pages || []).map((p) => [p.pageId, p]));
  const next = [];
  const errors = [];

  for (const pageId of pageIds) {
    const page = byId.get(pageId);
    const prev = existing.get(pageId);
    const entry = {
      pageId,
      name: clean(page.name, 200),
      accessToken: page.accessToken ? aesEncrypt.encrypt(page.accessToken) : (prev && prev.accessToken) || null,
      instagramId: page.instagramId || '',
      subscribed: false,
      connectionId: prev ? prev.connectionId : null,
    };
    try {
      if (!page.accessToken) throw new PlatformError('meta: no page token', { code: 'no_page_token' });
      await metaGraph.subscribePage(pageId, page.accessToken, { fetchImpl });
      const lc = await ensureInternalConnection({
        existingId: entry.connectionId,
        boardId: board._id,
        sourceType: 'facebook_lead_ads',
        name: clean(`Facebook Lead Ads · ${page.name || pageId}`, 200),
        userId,
      });
      entry.connectionId = lc._id;
      entry.subscribed = true;
    } catch (err) {
      console.warn('[meta] page lead-ads subscribe failed:', err.message);
      errors.push(pageId);
    }
    next.push(entry);
  }

  // Pages no longer selected: unsubscribe (best effort) + stop their connection.
  for (const [pageId, prev] of existing) {
    if (pageIds.includes(pageId)) continue;
    const pageToken = decryptToken(prev.accessToken) || (byId.get(pageId) && byId.get(pageId).accessToken);
    if (pageToken) await metaGraph.unsubscribePage(pageId, pageToken, { fetchImpl }).catch((err) => console.warn('[meta] unsubscribe failed:', err.message));
    await disableConnection(prev.connectionId);
  }

  conn.pages = next;
  await config.save();
  return {
    pages: next.map((p) => ({ pageId: p.pageId, name: p.name, subscribed: p.subscribed, hasInstagram: !!p.instagramId, connectionId: p.connectionId ? asId(p.connectionId) : null })),
    failed: errors,
  };
};

const metaDisconnect = async (workspaceId, { fetchImpl } = {}) => {
  const config = await loadConfig(workspaceId);
  const conn = config.meta.connection;
  for (const p of conn.pages || []) {
    const pageToken = decryptToken(p.accessToken);
    if (pageToken && p.subscribed) {
      await metaGraph.unsubscribePage(p.pageId, pageToken, { fetchImpl }).catch((err) => console.warn('[meta] unsubscribe failed:', err.message));
    }
    await disableConnection(p.connectionId);
  }
  config.meta.connection = { method: 'manual', status: 'none' };
  config.setMetaToken(null);
  config.meta.enabled = false;
  config.meta.datasetId = '';
  config.meta.lastTestOkAt = null;
  await config.save();
  return { meta: serializeMeta(config) };
};

// --- Google -----------------------------------------------------------------------

const googleRefresh = (config) => {
  const rt = config.getGoogleRefreshToken();
  if (!rt || config.google.connection.method !== 'oauth') throw new ConnectError(409, 'Sign in with Google first.', 'not_authorized');
  return rt;
};

const googleAccounts = async (workspaceId, { fetchImpl } = {}) => {
  const config = await loadConfig(workspaceId);
  const ads = googleAdsApi.client(googleRefresh(config), { fetchImpl });
  return { user: { email: config.google.connection.email || '' }, accounts: await ads.listAccounts() };
};

const createLeadFormConnection = async ({ workspaceId, existingId, boardId, userId, req }) => {
  const { LeadConnection } = models();
  if (existingId) {
    const existing = await LeadConnection.findById(existingId);
    if (existing && existing.sourceType === 'google_ads' && asId(existing.boardId) === asId(boardId)) {
      existing.enabled = true;
      await existing.save();
      // The key is only ever shown once; the user already pasted it.
      return { connection: existing, webhookUrl: null, key: null, existing: true };
    }
    if (existing) {
      existing.enabled = false;
      await existing.save();
    }
  }
  const { apiKey, keyId, tokenHash, tokenLast4 } = LeadConnection.generateApiKey();
  const connection = await LeadConnection.create({
    boardId,
    name: 'Google Ads lead forms',
    sourceType: 'google_ads',
    keyId,
    tokenHash,
    tokenLast4,
    attributeSource: true,
    createdBy: userId || undefined,
  });
  return { connection, webhookUrl: `${publicBaseUrl(req)}/api/leads/in/${apiKey}`, key: apiKey, existing: false, workspaceId };
};

const googleSelect = async (workspaceId, body, { userId, req, fetchImpl } = {}) => {
  const customerId = clean(body.customerId, 20).replace(/\D/g, '');
  if (customerId.length !== 10) throw new ConnectError(400, 'Choose a Google Ads account.', 'invalid_customer');
  const config = await loadConfig(workspaceId);
  const ads = googleAdsApi.client(googleRefresh(config), { fetchImpl });

  // Only an account this login can actually reach; the login-customer-id comes
  // from OUR discovery, never from the request.
  const accounts = await ads.listAccounts();
  const account = accounts.find((a) => a.customerId === customerId);
  if (!account) throw new ConnectError(403, 'That Google Ads account is not available to this Google login.', 'invalid_customer');
  if (account.manager) throw new ConnectError(400, 'Choose an advertiser account, not a manager account.', 'manager_account');
  const login = account.loginCustomerId || '';

  let leadFormBoard = null;
  if (body.leadForms && body.leadForms.enabled === true) leadFormBoard = await assertWorkspaceBoard(workspaceId, clean(body.leadForms.boardId, 30));

  const settings = await ads.customerSettings(customerId, login);
  let autoTagging = settings.autoTagging;
  if (body.enableAutoTagging !== false && !autoTagging) {
    try {
      await ads.enableAutoTagging(customerId, login);
      autoTagging = true;
    } catch (err) {
      console.warn('[google] enabling auto-tagging failed:', err.message);
    }
  }
  let actions = { qualified: config.google.conversionActions?.qualified || '', customer: config.google.conversionActions?.customer || '' };
  if (body.createConversionActions !== false) {
    const created = await ads.ensureConversionActions(customerId, login);
    actions = { qualified: created.qualified || '', customer: created.customer || '' };
  }

  const conn = config.google.connection;
  conn.method = 'oauth';
  conn.status = 'ready';
  conn.loginCustomerId = login;
  conn.customerName = clean(settings.name || account.name, 200);
  conn.currencyCode = clean(settings.currencyCode || account.currencyCode, 10);
  conn.conversionTrackingId = settings.conversionTrackingId;
  conn.autoTagging = autoTagging;
  conn.connectedAt = new Date();
  config.google.customerId = customerId;
  config.google.conversionActions.qualified = actions.qualified;
  config.google.conversionActions.customer = actions.customer;
  config.google.enabled = !!(actions.qualified || actions.customer);

  let leadForm;
  if (leadFormBoard) {
    const lf = await createLeadFormConnection({ workspaceId, existingId: conn.leadFormConnectionId, boardId: leadFormBoard._id, userId, req });
    conn.leadFormConnectionId = lf.connection._id;
    leadForm = { connectionId: asId(lf.connection._id), webhookUrl: lf.webhookUrl, key: lf.key, existing: lf.existing };
  }
  await config.save();
  const out = { google: serializeGoogle(config, (await platformStats(workspaceId)).google) };
  if (leadForm) out.leadForm = leadForm;
  return out;
};

const gtmContainers = async (workspaceId, { fetchImpl } = {}) => {
  const config = await loadConfig(workspaceId);
  const rt = googleRefresh(config);
  if (!googleAdsApi.hasGtmScopes(config.google.connection.scopes)) {
    throw new ConnectError(403, 'Allow LeadLoop to manage Google Tag Manager first.', 'needs_gtm_scope');
  }
  return { containers: await googleTagManager.client(rt, { fetchImpl }).listContainers() };
};

const gtmInstall = async (workspaceId, body, { req, fetchImpl } = {}) => {
  const { LeadConnection } = models();
  const accountId = clean(body.accountId, 20);
  const containerId = clean(body.containerId, 20);
  const connectionId = clean(body.connectionId, 30);
  if (!NUM_RE.test(accountId) || !NUM_RE.test(containerId)) throw new ConnectError(400, 'Choose a Tag Manager container.', 'invalid_container');
  if (!isObjectId(connectionId)) throw new ConnectError(400, 'Choose a website.', 'invalid_connection');

  const config = await loadConfig(workspaceId);
  const rt = googleRefresh(config);
  if (!googleAdsApi.hasGtmScopes(config.google.connection.scopes)) {
    throw new ConnectError(403, 'Allow LeadLoop to manage Google Tag Manager first.', 'needs_gtm_scope');
  }
  const boardIds = await workspaceBoardIds(workspaceId);
  const site = await LeadConnection.findOne({ _id: connectionId, boardId: { $in: boardIds }, sourceType: 'website_snippet' }).lean();
  if (!site || !site.siteKey) throw new ConnectError(404, 'Website not found in this workspace.', 'invalid_connection');

  const gtm = googleTagManager.client(rt, { fetchImpl });
  // The container must be one this login can see (and a web container).
  const containers = await gtm.listContainers();
  if (!containers.some((c) => c.accountId === accountId && c.containerId === containerId)) {
    throw new ConnectError(403, 'That container is not available to this Google login.', 'invalid_container');
  }
  const result = await gtm.install({ accountId, containerId, snippetTag: snippetTagFor(site, req) });
  config.google.connection.gtm = { accountId, containerId, ...result };
  await config.save();
  return { ok: true, containerPublicId: result.containerPublicId, versionId: result.versionId, publishedAt: result.publishedAt };
};

const googleDisconnect = async (workspaceId, { fetchImpl = fetch } = {}) => {
  const config = await loadConfig(workspaceId);
  const conn = config.google.connection;
  const wasOAuth = conn.method === 'oauth';
  const rt = config.getGoogleRefreshToken();
  if (rt) {
    // Revoke at Google (best effort) so the grant disappears from the user's account.
    try {
      await fetchImpl('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: rt }).toString(),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      console.warn('[google] token revoke failed:', err.message);
    }
    require('./googleAdsConversions').forgetAccessToken(rt);
  }
  // Lead forms keep flowing (they authenticate with their own API key) — the
  // link is kept so the hub still shows the source.
  const leadFormConnectionId = conn.leadFormConnectionId || null;
  config.google.connection = { method: 'agency', status: 'none', leadFormConnectionId };
  if (wasOAuth) {
    config.google.enabled = false;
    config.google.customerId = '';
    config.google.conversionActions = { qualified: '', customer: '' };
  }
  await config.save();
  return { google: serializeGoogle(config) };
};

// --- TikTok -----------------------------------------------------------------------

const tiktokToken = (config) => {
  const t = config.getTikTokToken();
  if (!t) throw new ConnectError(409, 'Sign in with TikTok first.', 'not_authorized');
  return t;
};

const ADV_RE = /^\d{1,30}$/;
const PIXEL_CODE_RE = /^[A-Z0-9]{8,40}$/i;

const assertAdvertiser = (config, advertiserId) => {
  if (!ADV_RE.test(String(advertiserId || ''))) throw new ConnectError(400, 'Choose an ad account.', 'invalid_advertiser');
  if (!(config.tiktok.connection.advertiserIds || []).includes(String(advertiserId))) {
    throw new ConnectError(403, 'That ad account is not available to this TikTok login.', 'invalid_advertiser');
  }
};

const tiktokAssets = async (workspaceId, { fetchImpl } = {}) => {
  const config = await loadConfig(workspaceId);
  const token = tiktokToken(config);
  const allowed = new Set(config.tiktok.connection.advertiserIds || []);
  const [advertisers, businessCenters] = await Promise.all([
    tiktokApi.listAdvertisers(token, { fetchImpl }),
    tiktokApi.listBusinessCenters(token, { fetchImpl }),
  ]);
  return {
    user: { name: config.tiktok.connection.userName || '' },
    businessCenters,
    advertisers: advertisers.filter((a) => allowed.size === 0 || allowed.has(a.id)),
  };
};

const tiktokPixels = async (workspaceId, advertiserId, { fetchImpl } = {}) => {
  const config = await loadConfig(workspaceId);
  assertAdvertiser(config, advertiserId);
  return { pixels: await tiktokApi.listPixels(tiktokToken(config), advertiserId, { fetchImpl }) };
};

const newWebhookKey = () => crypto.randomBytes(24).toString('hex');
const hashKey = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');

const tiktokSelect = async (workspaceId, body, { userId, fetchImpl } = {}) => {
  const advertiserId = clean(body.advertiserId, 30);
  const config = await loadConfig(workspaceId);
  const token = tiktokToken(config);
  assertAdvertiser(config, advertiserId);
  const bcId = clean(body.bcId, 30);
  if (bcId && !ADV_RE.test(bcId)) throw new ConnectError(400, 'Invalid Business Center.', 'invalid_bc');

  let instantBoard = null;
  if (body.instantForms && body.instantForms.enabled === true) instantBoard = await assertWorkspaceBoard(workspaceId, clean(body.instantForms.boardId, 30));

  let pixel;
  if (body.createPixel === true) {
    const name = clean(body.pixelName, 100) || 'LeadLoop pixel';
    if (!/^[\p{L}\p{N} _.'·-]{1,100}$/u.test(name)) throw new ConnectError(400, 'Pixel name has unsupported characters.', 'invalid_pixel_name');
    pixel = await tiktokApi.createPixel(token, advertiserId, name, { fetchImpl });
  } else {
    const code = clean(body.pixelCode, 40);
    if (!PIXEL_CODE_RE.test(code)) throw new ConnectError(400, 'Choose a pixel or create a new one.', 'invalid_pixel');
    const pixels = await tiktokApi.listPixels(token, advertiserId, { fetchImpl });
    pixel = pixels.find((p) => p.code === code);
    if (!pixel) throw new ConnectError(403, 'That pixel does not belong to the chosen ad account.', 'invalid_pixel');
  }

  const advertisers = await tiktokApi.listAdvertisers(token, { fetchImpl }).catch(() => []);
  const adv = advertisers.find((a) => a.id === advertiserId);

  const t = config.tiktok;
  const previousAdvertiser = t.advertiserId;
  t.advertiserId = advertiserId;
  t.advertiserName = clean(adv ? adv.name : '', 200);
  t.bcId = bcId;
  t.pixelCode = pixel.code;
  t.pixelName = clean(pixel.name, 200);
  t.enabled = true;
  t.connection.status = 'ready';
  t.connection.connectedAt = new Date();

  const forms = t.instantForms;
  const wantForms = !!instantBoard;
  if (forms.enabled && (!wantForms || previousAdvertiser !== advertiserId)) {
    await tiktokApi.unsubscribeLeads({ token, subscriptionId: forms.subscriptionId, fetchImpl }).catch((err) => console.warn('[tiktok] unsubscribe failed:', err.message));
    if (!wantForms) await disableConnection(forms.connectionId);
    forms.enabled = false;
    forms.subscriptionId = '';
    forms.webhookKeyHash = null;
  }
  if (wantForms) {
    const lc = await ensureInternalConnection({
      existingId: forms.connectionId,
      boardId: instantBoard._id,
      sourceType: 'tiktok_lead_ads',
      name: clean(`TikTok Instant Forms · ${t.advertiserName || advertiserId}`, 200),
      userId,
    });
    forms.connectionId = lc._id;
    if (!forms.enabled) {
      const key = newWebhookKey();
      try {
        const { subscriptionId } = await tiktokApi.subscribeLeads({ token, advertiserId, callbackUrl: tiktokWebhookUrl(key), fetchImpl });
        forms.subscriptionId = subscriptionId;
        forms.webhookKeyHash = hashKey(key);
        forms.enabled = true;
        forms.subscribedAt = new Date();
      } catch (err) {
        console.warn('[tiktok] lead subscription failed:', err.message);
        forms.enabled = false;
      }
    }
  }
  await config.save();
  return { tiktok: serializeTikTok(config, (await platformStats(workspaceId)).tiktok) };
};

const tiktokTest = async (workspaceId, body, { fetchImpl } = {}) => {
  // eslint-disable-next-line global-require
  const { sendTikTokTestEvent } = require('./conversionService');
  const code = clean(body.testEventCode, 40);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) throw new ConnectError(400, 'Enter the test event code from TikTok Events Manager.', 'invalid_test_code');
  const config = await loadConfig(workspaceId);
  if (!config.tiktok.pixelCode || !config.tiktok.accessToken) throw new ConnectError(409, 'Connect TikTok and choose a pixel first.', 'not_ready');
  const result = await sendTikTokTestEvent(config, code, { fetchImpl });
  if (result.ok) {
    config.tiktok.lastTestOkAt = new Date();
    await config.save();
    return { ok: true };
  }
  return { ok: false, error: clean(result.error || 'TikTok rejected the event', 300) };
};

const tiktokDisconnect = async (workspaceId, { fetchImpl } = {}) => {
  const config = await loadConfig(workspaceId);
  const t = config.tiktok;
  const token = config.getTikTokToken();
  if (token && t.instantForms && t.instantForms.subscriptionId) {
    await tiktokApi.unsubscribeLeads({ token, subscriptionId: t.instantForms.subscriptionId, fetchImpl }).catch((err) => console.warn('[tiktok] unsubscribe failed:', err.message));
  }
  if (t.instantForms) await disableConnection(t.instantForms.connectionId);
  const eventNames = { qualified: t.eventNames?.qualified || 'QualifiedLead', customer: t.eventNames?.customer || 'ConvertedLead' };
  config.tiktok = { enabled: false, accessToken: null, connection: { status: 'none' }, eventNames };
  await config.save();
  return { tiktok: serializeTikTok(config) };
};

// --- webhooks (public) ------------------------------------------------------------

/** Insert-first idempotency; returns the receipt or null when already handled. */
const claimReceipt = async ({ workspaceId, platform, externalId, connectionId }) => {
  const { AdLeadReceipt } = models();
  try {
    return await AdLeadReceipt.create({ workspaceId, platform, externalId, connectionId });
  } catch (err) {
    if (err && err.code === 11000) return null;
    throw err;
  }
};

const ingestWithReceipt = async (receipt, connectionId, payload, meta) => {
  // eslint-disable-next-line global-require
  const { ingestForConnection } = require('./leadIngestService');
  try {
    await ingestForConnection(connectionId, payload, meta);
    receipt.status = 'ingested';
  } catch (err) {
    receipt.status = 'failed';
    receipt.error = clean(err && err.message, 300);
    console.warn(`[ad-connect] ${receipt.platform} lead ingest failed:`, receipt.error);
  }
  await receipt.save().catch(() => {});
};

/** Process a verified Meta leadgen webhook body (async, after the 200). */
const processMetaWebhook = async (body, { fetchImpl } = {}) => {
  const { AdConversionConfig } = models();
  const changes = metaGraph.parseLeadgenChanges(body);
  for (const ch of changes) {
    const configs = await AdConversionConfig.find({ 'meta.connection.pages': { $elemMatch: { pageId: ch.pageId, subscribed: true } } });
    for (const config of configs) {
      const page = config.meta.connection.pages.find((p) => p.pageId === ch.pageId);
      if (!page || !page.connectionId) continue;
      const receipt = await claimReceipt({ workspaceId: config.workspaceId, platform: 'meta', externalId: ch.leadgenId, connectionId: page.connectionId });
      if (!receipt) continue; // duplicate delivery
      const pageToken = config.getMetaPageToken(ch.pageId);
      if (!pageToken) {
        receipt.status = 'failed';
        receipt.error = 'no_page_token';
        await receipt.save().catch(() => {});
        continue;
      }
      let lead;
      try {
        lead = await metaGraph.getLead(ch.leadgenId, pageToken, { fetchImpl });
      } catch (err) {
        receipt.status = 'failed';
        receipt.error = clean(err.message, 300);
        await receipt.save().catch(() => {});
        console.warn('[meta] lead fetch failed:', err.message);
        continue;
      }
      const payload = { ...lead, leadgen_id: ch.leadgenId };
      delete payload.id;
      await ingestWithReceipt(receipt, page.connectionId, payload, { ip: '', userAgent: 'meta-leadgen-webhook' });
    }
  }
  return changes.length;
};

/**
 * Authenticate a TikTok lead webhook: the URL secret must match a workspace
 * with Instant Forms on, and a signature (when TikTok sends one) must verify.
 * @returns config or null
 */
const authenticateTikTokWebhook = async ({ key, rawBody, signatureHeader }) => {
  const { AdConversionConfig } = models();
  if (typeof key !== 'string' || !/^[0-9a-f]{48}$/.test(key)) return null;
  const config = await AdConversionConfig.findOne({ 'tiktok.instantForms.webhookKeyHash': hashKey(key), 'tiktok.instantForms.enabled': true });
  if (!config) return null;
  const sig = tiktokApi.verifyWebhookSignature(rawBody, signatureHeader);
  if (sig === false) return null;
  return config;
};

const processTikTokWebhook = async (config, body) => {
  const forms = config.tiktok.instantForms;
  const leads = tiktokApi.extractLeads(body);
  if (!leads.length) {
    console.warn('[tiktok] lead webhook with unrecognised shape; keys:', Object.keys(body || {}).slice(0, 20).join(','));
    return 0;
  }
  for (const l of leads) {
    if (l.advertiserId && config.tiktok.advertiserId && l.advertiserId !== config.tiktok.advertiserId) continue;
    const receipt = await claimReceipt({ workspaceId: config.workspaceId, platform: 'tiktok', externalId: l.leadId, connectionId: forms.connectionId });
    if (!receipt) continue;
    await ingestWithReceipt(receipt, forms.connectionId, l.lead, { ip: '', userAgent: 'tiktok-lead-webhook' });
  }
  return leads.length;
};

module.exports = {
  ConnectError,
  availability,
  redirectUri,
  snippetTagFor,
  isWorkspaceAdmin,
  overview,
  startOAuth,
  completeOAuth,
  confirmOAuth,
  hasPending,
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
  processMetaWebhook,
  authenticateTikTokWebhook,
  processTikTokWebhook,
  // exported for tests
  serializeMeta,
  serializeGoogle,
  serializeTikTok,
  hashKey,
};
