/**
 * adConnectWebsiteController.js — the "Website" part of Ads & tracking.
 *
 *   POST /api/workspaces/:id/ad-connect/website/check
 *   GET  /api/workspaces/:id/ad-connect/website/:connectionId/wordpress-plugin.zip
 *   POST /api/workspaces/:id/ad-connect/website/email-developer
 *
 * Authz: every route runs authMiddleware + requireOrgAdmin (caller is an admin
 * of workspace :id). On top of that, the website connection named in the
 * request must be a `website_snippet` LeadConnection whose board belongs to
 * workspace :id — otherwise 404 (no hint that it exists elsewhere).
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const LeadConnection = require('../models/LeadConnection');
const Board = require('../models/Board');
const AdConversionConfig = require('../models/AdConversionConfig');
const { publicBaseUrl } = require('../utils/publicBaseUrl');
const { hostAllowed } = require('../utils/siteDomains');
const { pixelsFromConfig, SITE_KEY_RE } = require('./captureController');
const siteCheck = require('../services/siteCheck');
const { createZip } = require('../utils/zipStore');
const steps = require('../utils/websiteBuilderSteps');
const emailService = require('../services/emailService');

const SNIPPET_SOURCE = 'website_snippet';
const PLUGIN_DIR = path.join(__dirname, '../../../integrations/wordpress/leadloop');
const PLUGIN_FILES = ['leadloop.php', 'readme.txt'];
// The origin baked into the plugin's PHP source: scheme + host[:port] only,
// so nothing can break out of the PHP string literal.
const SAFE_ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;
const EMAIL_RE = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+\.[a-z]{2,63}$/i;

const notFound = (res) => res.status(404).json({ error: 'Website not found' });

/** Strip control chars (incl. CR/LF) and clamp — for names shown in an email. */
const oneLine = (v, max = 80) =>
  String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * The website connection, only if it belongs to workspace `workspaceId`.
 * Returns null for anything else (bad id, other workspace, other source type).
 */
const loadWebsiteConnection = async (workspaceId, connectionId) => {
  if (!mongoose.Types.ObjectId.isValid(String(connectionId || ''))) return null;
  const connection = await LeadConnection.findOne({ _id: connectionId, sourceType: SNIPPET_SOURCE });
  if (!connection || !connection.boardId) return null;
  const board = await Board.findById(connection.boardId).select('organisation').lean();
  if (!board || !board.organisation || String(board.organisation) !== String(workspaceId)) return null;
  return connection;
};

const snippetTagFor = (connection, req) =>
  connection.siteKey ? `<script src="${publicBaseUrl(req)}/capture.js" data-site="${connection.siteKey}" defer></script>` : '';

/**
 * Pick the URL to check. An admin-supplied URL must be on one of the site's
 * allowed domains; otherwise the first allowed domain's homepage.
 * Returns { url } or { error }.
 */
const pickCheckUrl = (rawUrl, allowedDomains) => {
  const domains = Array.isArray(allowedDomains) ? allowedDomains : [];
  if (rawUrl === undefined || rawUrl === null || rawUrl === '') {
    if (!domains.length) return { error: 'Add your website domain to this site first' };
    return { url: `https://${domains[0]}/` };
  }
  if (typeof rawUrl !== 'string' || rawUrl.length > 2000) return { error: 'That is not a valid web address' };
  let s = rawUrl.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return { error: 'That is not a valid web address' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Only http and https addresses can be checked' };
  if (!hostAllowed(u.hostname.replace(/\.$/, ''), domains)) {
    return { error: 'That address is not on one of this site’s domains' };
  }
  u.hash = '';
  return { url: u.toString() };
};

/** POST /workspaces/:id/ad-connect/website/check  { connectionId, url? } */
const checkWebsite = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const connection = await loadWebsiteConnection(req.params.id, body.connectionId);
    if (!connection) return notFound(res);

    const picked = pickCheckUrl(body.url, connection.allowedDomains);
    if (picked.error) return res.status(400).json({ error: picked.error });

    const config = await AdConversionConfig.findOne({ workspaceId: req.params.id }).lean();
    const pixels = pixelsFromConfig(config);
    const sn = connection.snippet || {};

    let html = null;
    let fetchError = '';
    let finalUrl = picked.url;
    try {
      const r = await siteCheck.safeFetchHtml(picked.url);
      finalUrl = r.url;
      if (r.status >= 200 && r.status < 300) html = r.html;
      else fetchError = `Your homepage answered with an error (HTTP ${r.status})`;
    } catch (err) {
      fetchError = err instanceof siteCheck.SiteCheckError ? err.message : "We couldn't reach your website";
      if (!(err instanceof siteCheck.SiteCheckError)) console.error('[siteCheck] fetch error:', err?.message || err);
    }

    const checks = siteCheck.analyzeHtml({
      html,
      fetchError,
      siteKey: connection.siteKey,
      pixels,
      loadPixels: sn.loadPixels !== false,
      lastSeenAt: sn.lastSeenAt || null,
    });
    const result = {
      checkedAt: new Date(),
      url: finalUrl,
      checks,
      pagesSeen: Array.isArray(sn.pagesSeen) ? sn.pagesSeen.length : 0,
      lastSeenAt: sn.lastSeenAt || null,
    };
    await LeadConnection.updateOne({ _id: connection._id }, { $set: { 'snippet.lastCheck': result } });
    return res.json(result);
  } catch (err) {
    console.error('[adConnectWebsite] checkWebsite error:', err?.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** Pure: plugin source files → zip with the key + script URL filled in. */
const buildPluginZip = ({ siteKey, origin, files }) => {
  if (!SITE_KEY_RE.test(String(siteKey || ''))) throw new Error('invalid site key');
  if (!SAFE_ORIGIN_RE.test(String(origin || ''))) throw new Error('invalid origin');
  const fill = (text) =>
    text.split('{{LEADLOOP_SITE_KEY}}').join(siteKey).split('{{LEADLOOP_SCRIPT_URL}}').join(`${origin}/capture.js`);
  return createZip([
    { name: 'leadloop/' },
    ...Object.entries(files).map(([name, text]) => ({ name: `leadloop/${name}`, data: fill(text) })),
  ]);
};

let pluginCache = null;
const readPluginFiles = () => {
  if (pluginCache && process.env.NODE_ENV === 'production') return pluginCache;
  const files = {};
  for (const f of PLUGIN_FILES) files[f] = fs.readFileSync(path.join(PLUGIN_DIR, f), 'utf8');
  pluginCache = files;
  return files;
};

/** GET /workspaces/:id/ad-connect/website/:connectionId/wordpress-plugin.zip */
const wordpressPlugin = async (req, res) => {
  try {
    const connection = await loadWebsiteConnection(req.params.id, req.params.connectionId);
    if (!connection || !connection.siteKey) return notFound(res);
    const origin = publicBaseUrl(req);
    if (!SAFE_ORIGIN_RE.test(origin)) {
      console.error('[adConnectWebsite] public base URL is not a plain origin; refusing to build plugin');
      return res.status(500).json({ error: 'Server error' });
    }
    let files;
    try {
      files = readPluginFiles();
    } catch (err) {
      console.error('[adConnectWebsite] plugin source missing:', err.message);
      return res.status(503).json({ error: 'The WordPress plugin is not available on this server' });
    }
    const zip = buildPluginZip({ siteKey: connection.siteKey, origin, files });
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="leadloop.zip"');
    res.set('Content-Length', String(zip.length));
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.end(zip);
  } catch (err) {
    console.error('[adConnectWebsite] wordpressPlugin error:', err?.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** Pure: validated, normalised recipient address or ''. */
const normalizeEmail = (raw) => {
  if (typeof raw !== 'string') return '';
  const e = raw.trim();
  if (!e || e.length > 254 || /[\r\n]/.test(e) || !EMAIL_RE.test(e)) return '';
  return e;
};

/** Pure: subject + html + text for the developer email. */
const buildDeveloperEmail = ({ builder, snippetTag, site, senderName, workspaceName }) => {
  const b = steps.getBuilderSteps(builder);
  const who = oneLine(senderName) || 'Your client';
  const ws = oneLine(workspaceName);
  const subject = oneLine(`Please add the LeadLoop tag to ${site || 'our website'} (${b.name})`, 160);
  const intro = `${who}${ws ? ` (${ws})` : ''} asked us to send you the steps to add the LeadLoop tag to ${site || 'their website'}. It takes about two minutes.`;
  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#211E18;font-size:14px;line-height:1.6;max-width:560px">',
    `<p style="margin:0 0 16px">${steps.escapeHtml(intro)}</p>`,
    steps.renderStepsHtml(builder, snippetTag),
    '<p style="margin:16px 0 0;color:#5C554A;font-size:13px">The tag only works on the website domains set up in LeadLoop. It never collects password or card fields.</p>',
    '</div>',
  ].join('');
  const text = `${intro}\n\n${steps.renderStepsText(builder, snippetTag)}\n\nThe tag only works on the website domains set up in LeadLoop. It never collects password or card fields.`;
  return { subject, html, text };
};

/** POST /workspaces/:id/ad-connect/website/email-developer  { connectionId, email, builder } */
const emailDeveloper = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const to = normalizeEmail(body.email);
    if (!to) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!steps.isBuilder(body.builder)) return res.status(400).json({ error: 'Unknown website builder' });

    const connection = await loadWebsiteConnection(req.params.id, body.connectionId);
    if (!connection || !connection.siteKey) return notFound(res);
    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ error: 'Email is not set up on this server' });
    }

    const mail = buildDeveloperEmail({
      builder: body.builder,
      snippetTag: snippetTagFor(connection, req),
      site: (connection.allowedDomains || [])[0] || '',
      senderName: req.user?.name,
      workspaceName: req.org?.name,
    });
    try {
      await emailService.sendUserEmailViaResend({ to, subject: mail.subject, bodyHtml: mail.html, bodyText: mail.text });
    } catch (err) {
      console.error('[adConnectWebsite] email-developer send failed:', err?.message || err);
      return res.status(502).json({ error: 'Could not send the email. Try again later.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[adConnectWebsite] emailDeveloper error:', err?.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  checkWebsite,
  wordpressPlugin,
  emailDeveloper,
  // pure helpers (tests)
  pickCheckUrl,
  buildPluginZip,
  buildDeveloperEmail,
  normalizeEmail,
  loadWebsiteConnection,
  PLUGIN_DIR,
};
