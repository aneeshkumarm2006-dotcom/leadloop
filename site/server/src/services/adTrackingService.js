/**
 * adTrackingService.js — the ad-tracking checklist (live counts → pure rules
 * in utils/adTrackingHealth.js) and the hourly health check that tells
 * workspace admins when something breaks:
 *
 *   - a website lead source has gone quiet for longer than its normal pace
 *     (this is exactly how a broken contact form shows up), and
 *   - conversion sends to Meta / Google have failed permanently.
 *
 * Alerts go to the workspace's admins as an in-app notification (bell, with a
 * link to the fix) and a push notification on their devices. Each problem
 * alerts once (silence) or at most daily (failures) — never a stream.
 */

const cron = require('node-cron');
const H = require('../utils/adTrackingHealth');

const models = () => ({
  Organisation: require('../models/Organisation'),
  Board: require('../models/Board'),
  Task: require('../models/Task'),
  LeadConnection: require('../models/LeadConnection'),
  AdConversionConfig: require('../models/AdConversionConfig'),
  ConversionEvent: require('../models/ConversionEvent'),
});

const WEBSITE_SOURCES = ['website', 'website_snippet'];
const AD_CHANNELS = ['google_ads', 'meta_ads', 'microsoft_ads', 'tiktok_ads', 'campaign'];

/** Live snapshot → checklist for one workspace. */
const getChecklist = async (workspaceId) => {
  const { Board, Task, LeadConnection, AdConversionConfig, ConversionEvent } = models();
  const boards = await Board.find({ organisation: workspaceId }).select('_id').lean();
  const boardIds = boards.map((b) => b._id);
  const [sources, attributedLeads, consentedLeads, config, metaSent] = await Promise.all([
    boardIds.length
      ? LeadConnection.find({ boardId: { $in: boardIds }, sourceType: { $in: WEBSITE_SOURCES } }).select('submissionCount').lean()
      : [],
    boardIds.length ? Task.countDocuments({ board: { $in: boardIds }, 'attribution.channel': { $in: AD_CHANNELS } }) : 0,
    boardIds.length ? Task.countDocuments({ board: { $in: boardIds }, 'attribution.adConsent.granted': true }) : 0,
    AdConversionConfig.findOne({ workspaceId }).lean(),
    ConversionEvent.countDocuments({ workspaceId, platform: 'meta', status: 'sent' }),
  ]);
  const meta = (config && config.meta) || {};
  const google = (config && config.google) || {};
  return H.buildAdTrackingChecklist({
    websiteSources: sources.length,
    websiteSubmissions: sources.reduce((n, s) => n + (s.submissionCount || 0), 0),
    attributedLeads,
    consentedLeads,
    rulesCount: (config && config.rules ? config.rules.length : 0),
    metaConnected: !!(meta.enabled && meta.datasetId && meta.accessToken),
    metaVerified: !!meta.lastTestOkAt || metaSent > 0,
    metaLive: !!(meta.enabled && meta.datasetId && meta.accessToken && !meta.testEventCode),
    googleConnected: !!(google.enabled && google.customerId),
  });
};

/** Workspace admins (main + extra), de-duplicated. */
const adminIds = (org) => {
  const ids = [org.admin, ...(org.admins || [])].filter(Boolean).map(String);
  return [...new Set(ids)];
};

/** In-app + push to every admin. Never throws. */
const alertAdmins = async (org, { key, title, body, link }) => {
  // eslint-disable-next-line global-require
  const { createNotificationsForUsers } = require('./notificationService');
  // eslint-disable-next-line global-require
  const { notifySafely } = require('./pushService');
  const userIds = adminIds(org);
  try {
    await createNotificationsForUsers({ userIds, type: 'health', message: `${title} — ${body}`, orgId: org._id, link });
  } catch (err) {
    console.warn('[health] in-app alert failed:', err.message);
  }
  for (const uid of userIds) notifySafely(uid, org._id, 'health', { key, title, body, link });
  return userIds.length;
};

/** One pass of the health check. Returns what it alerted on (for tests/logs). */
const runHealthCheck = async ({ now = new Date() } = {}) => {
  const { Organisation, Board, LeadConnection, AdConversionConfig, ConversionEvent } = models();
  const alerts = [];

  // 1. Website lead sources that went quiet.
  const sources = await LeadConnection.find({
    enabled: true,
    sourceType: { $in: WEBSITE_SOURCES },
    submissionCount: { $gte: H.MIN_SUBMISSIONS_TO_MONITOR },
  });
  for (const source of sources) {
    const v = H.silenceVerdict({
      submissionCount: source.submissionCount,
      createdAt: source.createdAt,
      lastSubmissionAt: source.lastSubmissionAt,
      alertedAt: source.health && source.health.silentAlertedAt,
      now,
    });
    if (!v.shouldAlert) continue;
    const board = await Board.findById(source.boardId).select('organisation name').lean();
    const org = board && (await Organisation.findById(board.organisation).select('admin admins name').lean());
    if (!org) continue;
    await alertAdmins(org, {
      key: `silent-${source._id}`,
      title: `No leads from “${source.name}”`,
      body: `Nothing has arrived for ${H.humanDuration(v.silentForMs)}, which is unusual for this source. Check the website form still works.`,
      link: '/lead-sources',
    });
    source.health = { ...(source.health || {}), silentAlertedAt: now };
    await source.save();
    alerts.push({ type: 'silent', sourceId: String(source._id) });
  }

  // 2. Conversion sends that failed for good, per workspace.
  const configs = await AdConversionConfig.find({});
  for (const config of configs) {
    const since = (config.health && config.health.lastFailureAlertAt) || new Date(now.getTime() - 7 * 24 * 3600e3);
    const failedCount = await ConversionEvent.countDocuments({
      workspaceId: config.workspaceId,
      status: 'dead',
      updatedAt: { $gt: since },
    });
    const v = H.failureVerdict({ failedCount, lastAlertAt: config.health && config.health.lastFailureAlertAt, now });
    if (!v.shouldAlert) continue;
    const org = await Organisation.findById(config.workspaceId).select('admin admins name').lean();
    if (!org) continue;
    await alertAdmins(org, {
      key: `conversions-${config.workspaceId}`,
      title: 'Ad conversion sends are failing',
      body: `${failedCount} qualified lead${failedCount === 1 ? '' : 's'} could not be reported to Meta / Google. Open Ad conversions → Recent sends for the reason.`,
      link: '/settings?tab=ads',
    });
    config.health = { ...(config.health || {}), lastFailureAlertAt: now };
    await config.save();
    alerts.push({ type: 'failures', workspaceId: String(config.workspaceId), failedCount });
  }

  return alerts;
};

let started = false;
const startHealthRunner = () => {
  if (started) return;
  started = true;
  cron.schedule('17 * * * *', () => {
    runHealthCheck().catch((err) => console.error('[health] check error:', err?.message || err));
  });
  console.log('health runner started');
};

module.exports = { getChecklist, runHealthCheck, startHealthRunner, alertAdmins, adminIds };
