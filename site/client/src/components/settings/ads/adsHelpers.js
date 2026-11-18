/**
 * adsHelpers.js — pure helpers for the Ads & tracking hub: defensive
 * normalisation of the `/ad-connect/overview` payload (treated as untrusted),
 * derived statuses, and small browser utilities.
 */
import { formatDistanceToNowStrict } from 'date-fns';

const STATUSES = ['none', 'authorized', 'ready'];
const CHECK_STATUSES = ['ok', 'warn', 'missing', 'skip'];

const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const status = (v) => (STATUSES.includes(v) ? v : 'none');
const date = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const normalizeCheck = (raw) => {
  const c = obj(raw);
  if (!Array.isArray(c.checks)) return null;
  return {
    checkedAt: date(c.checkedAt),
    url: str(c.url, 500),
    pagesSeen: num(c.pagesSeen),
    lastSeenAt: date(c.lastSeenAt),
    checks: c.checks
      .map((x) => obj(x))
      .filter((x) => typeof x.id === 'string')
      .map((x) => ({
        id: str(x.id, 40),
        status: CHECK_STATUSES.includes(x.status) ? x.status : 'skip',
        title: str(x.title, 120),
        detail: str(x.detail, 400),
      })),
  };
};

const normalizeMeta = (raw) => {
  const m = obj(raw);
  return {
    status: status(m.status),
    method: str(m.method, 20),
    userName: str(m.userName, 120),
    businessName: str(m.businessName, 200),
    adAccountId: str(m.adAccountId, 60),
    adAccountName: str(m.adAccountName, 200),
    pixelId: str(m.pixelId, 60),
    pixelName: str(m.pixelName, 200),
    live: !!m.live,
    tokenExpiresAt: date(m.tokenExpiresAt),
    pages: arr(m.pages).map((p) => {
      const o = obj(p);
      return { pageId: str(o.pageId, 60), name: str(o.name, 200), subscribed: !!o.subscribed, hasInstagram: !!o.hasInstagram };
    }).filter((p) => p.pageId),
    lastSentAt: date(m.lastSentAt),
    errorsThisWeek: num(m.errorsThisWeek),
  };
};

const normalizeGoogle = (raw) => {
  const g = obj(raw);
  const gtm = g.gtm && typeof g.gtm === 'object' ? { containerPublicId: str(g.gtm.containerPublicId, 40), publishedAt: date(g.gtm.publishedAt) } : null;
  const ca = obj(g.conversionActions);
  return {
    status: status(g.status),
    method: str(g.method, 20),
    email: str(g.email, 200),
    customerId: str(g.customerId, 20),
    customerName: str(g.customerName, 200),
    conversionActions: { qualified: str(ca.qualified, 200), customer: str(ca.customer, 200) },
    autoTagging: !!g.autoTagging,
    conversionTrackingId: str(g.conversionTrackingId, 40),
    gtm,
    leadFormConnectionId: str(g.leadFormConnectionId, 40),
    // Missing flag (older server) → unknown; the GTM guide then asks the API.
    hasGtmAccess: typeof g.hasGtmAccess === 'boolean' ? g.hasGtmAccess : null,
    lastSentAt: date(g.lastSentAt),
    errorsThisWeek: num(g.errorsThisWeek),
  };
};

const normalizeTikTok = (raw) => {
  const t = obj(raw);
  const f = obj(t.instantForms);
  return {
    status: status(t.status),
    userName: str(t.userName, 120),
    advertiserId: str(t.advertiserId, 60),
    advertiserName: str(t.advertiserName, 200),
    pixelCode: str(t.pixelCode, 60),
    pixelName: str(t.pixelName, 200),
    live: !!t.live,
    instantForms: { enabled: !!f.enabled, connectionId: str(f.connectionId, 40) },
    lastSentAt: date(t.lastSentAt),
    errorsThisWeek: num(t.errorsThisWeek),
  };
};

export const normalizeWebsite = (raw) => {
  const w = obj(raw);
  return {
    connectionId: str(w.connectionId || w._id, 40),
    name: str(w.name, 200),
    boardId: str(w.boardId, 40),
    domains: arr(w.domains || w.allowedDomains).map((d) => str(d, 253)).filter(Boolean),
    siteKey: str(w.siteKey, 80),
    enabled: w.enabled !== false,
    loadPixels: (w.loadPixels ?? obj(w.snippet).loadPixels) !== false,
    snippetTag: str(w.snippetTag, 1000),
    lastSeenAt: date(w.lastSeenAt),
    pagesSeen: Array.isArray(w.pagesSeen) ? w.pagesSeen.length : num(w.pagesSeen),
    submissionCount: num(w.submissionCount),
    lastSubmissionAt: date(w.lastSubmissionAt),
    lastCheck: normalizeCheck(w.lastCheck),
  };
};

export const normalizeOverview = (raw) => {
  const o = obj(raw);
  const a = obj(o.availability);
  const sent = obj(o.sentLast7d);
  const checklist = o.checklist && Array.isArray(o.checklist.steps) ? o.checklist : null;
  return {
    availability: {
      meta: !!a.meta,
      google: !!a.google,
      tiktok: !!a.tiktok,
      gtm: !!a.gtm,
      // Treat a missing flag as "configured" so an older server doesn't block everything.
      encryption: a.encryption !== false,
    },
    meta: normalizeMeta(o.meta),
    google: normalizeGoogle(o.google),
    tiktok: normalizeTikTok(o.tiktok),
    websites: arr(o.websites).map(normalizeWebsite).filter((w) => w.connectionId),
    sentLast7d: {
      leadsCaptured: num(sent.leadsCaptured),
      meta: num(sent.meta),
      google: num(sent.google),
      tiktok: num(sent.tiktok),
    },
    recent: arr(o.recent).slice(0, 20).map((r) => {
      const x = obj(r);
      return { leadName: str(x.leadName, 120), platform: str(x.platform, 40), stage: str(x.stage, 20), status: str(x.status, 20), at: date(x.at) };
    }),
    checklist,
  };
};

/* ------------------------------ derived ------------------------------ */

const DAY = 24 * 3600 * 1000;

/** Is our tag live on this site? Last check found it, or the beacon fired within 7 days. */
export const websiteTagFound = (w) => {
  if (!w) return false;
  const tag = w.lastCheck?.checks.find((c) => c.id === 'tag');
  if (tag && tag.status === 'ok') return true;
  if (w.lastSeenAt && Date.now() - new Date(w.lastSeenAt).getTime() < 7 * DAY) return true;
  return false;
};

export const websiteLabel = (w) => (w ? w.domains[0] || w.name || '' : '');

/** "4 min ago" — '' for missing dates. */
export const timeAgo = (iso) => {
  if (!iso) return '';
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
};

/** Last 4 characters of an id, for "…9021" style display. */
export const tail = (id, n = 4) => {
  const s = String(id || '');
  return s.length > n ? `…${s.slice(-n)}` : s;
};

/** 1234567890 → 123-456-7890 */
export const formatCustomerId = (id) => {
  const d = String(id || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(id || '');
};

/**
 * Accept "example.com", "https://www.example.com/contact" etc. and return the
 * bare hostname, or '' when it isn't a plausible public domain.
 */
export const parseSiteHost = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let host = '';
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return '';
  }
  host = host.toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return '';
  return host;
};

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());

/** Copy text, falling back to a hidden textarea for older browsers. */
export const copyText = async (text) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
};

/** Website builders, in rail order. `kind` drives which guide renders. */
export const BUILDERS = [
  { id: 'gtm', logo: 'gtm', kind: 'gtm' },
  { id: 'wordpress', logo: 'wordpress', kind: 'wordpress' },
  { id: 'wix', logo: 'wix', kind: 'paste' },
  { id: 'squarespace', logo: 'squarespace', kind: 'paste' },
  { id: 'webflow', logo: 'webflow', kind: 'paste' },
  { id: 'shopify', logo: 'shopify', kind: 'paste' },
  { id: 'other', logo: 'leadloop', kind: 'paste' },
];

/** Brand mark for an activity row / platform key. */
export const platformLogo = (platform) => {
  const p = String(platform || '');
  if (p === 'meta' || p === 'meta_ads') return 'meta';
  if (p.startsWith('facebook')) return 'facebook';
  if (p.startsWith('instagram')) return 'instagram';
  if (p.startsWith('google')) return 'google-ads';
  if (p.startsWith('tiktok')) return 'tiktok';
  return 'leadloop';
};

/** Session-scoped note of which dialog to reopen after an OAuth round-trip. */
const RESUME_KEY = 'leadloop.adsHub.resume';
export const rememberResume = (value) => {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};
export const peekResume = () => {
  try {
    const v = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};
export const takeResume = () => {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

/** i18n `returnObjects` arrays, guarded (a missing key returns the key string). */
export const asList = (v) => (Array.isArray(v) ? v.filter((x) => x != null) : []);
