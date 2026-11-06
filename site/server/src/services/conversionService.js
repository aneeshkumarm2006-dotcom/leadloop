/**
 * conversionService.js — report qualified leads back to ad platforms.
 *
 * Flow:
 *   1. A lead is moved into a group (`task.moved_to_group`, fired by edits and
 *      by drag-and-drop between groups).
 *   2. If the workspace's AdConversionConfig has a rule for that board + group,
 *      one ConversionEvent row is created per enabled platform (unique per
 *      lead/platform/stage — a lead is reported as Qualified once, however often
 *      it is dragged around).
 *   3. Each row is attempted immediately; failures that can succeed later are
 *      retried by an every-minute runner with back-off, then marked `dead`.
 *
 * Eligibility (consent, something to match on) is decided per attempt by the
 * pure helpers in utils/conversionPayloads.js; ineligible rows are `skipped`
 * with a reason the lead panel can show.
 */

const cron = require('node-cron');
const eventBus = require('./eventBus');
const metaCapi = require('./metaCapi');
const googleAds = require('./googleAdsConversions');
const P = require('../utils/conversionPayloads');

// Lazy model access so this module stays cycle-free at load time.
const models = () => ({
  AdConversionConfig: require('../models/AdConversionConfig'),
  ConversionEvent: require('../models/ConversionEvent'),
  Task: require('../models/Task'),
  Board: require('../models/Board'),
});

// Back-off after attempt N fails (1-indexed). After the last one → `dead`.
const BACKOFF_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 12 * 3600e3];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

const trim = (s, n = 500) => String(s || '').slice(0, n);

/** Platforms this config can currently send to. */
const enabledPlatforms = (config) => {
  const out = [];
  if (config.meta && config.meta.enabled && config.meta.datasetId && config.meta.accessToken) out.push('meta');
  if (config.google && config.google.enabled && config.google.customerId) out.push('google');
  return out;
};

/**
 * Send one ConversionEvent row (any status but `sent`/`skipped`). Mutates and
 * saves the row; never throws.
 */
const attempt = async (row, { fetchImpl, now = new Date() } = {}) => {
  const { AdConversionConfig, Task, Board } = models();
  try {
    const [config, task, board] = await Promise.all([
      AdConversionConfig.findOne({ workspaceId: row.workspaceId }),
      Task.findById(row.taskId),
      Board.findById(row.boardId).select('columns organisation').lean(),
    ]);
    if (!config || !task || !board) {
      row.status = 'skipped';
      row.reason = !config ? 'not_configured' : 'lead_deleted';
      await row.save();
      return row;
    }

    const identity = P.leadIdentity(task, board);
    const attribution = task.attribution || null;
    const verdict = P.eligibility({ platform: row.platform, attribution, identity, now });
    if (!verdict.ok) {
      row.status = 'skipped';
      row.reason = verdict.reason;
      await row.save();
      return row;
    }

    const cc = config.defaultPhoneCountryCode || '1';
    let result;
    if (row.platform === 'meta') {
      const event = P.metaEvent({
        eventName: (config.meta.eventNames && config.meta.eventNames[row.stage]) || row.stage,
        eventTime: row.eventTime,
        eventId: row.eventId,
        taskId: row.taskId,
        identity,
        attribution,
        defaultCountryCode: cc,
      });
      row.test = !!config.meta.testEventCode;
      result = await metaCapi.sendEvents({
        datasetId: config.meta.datasetId,
        accessToken: config.getMetaToken(),
        events: [event],
        testEventCode: config.meta.testEventCode || undefined,
        fetchImpl,
      });
    } else {
      const action = config.google.conversionActions && config.google.conversionActions[row.stage];
      if (!action) {
        row.status = 'skipped';
        row.reason = 'no_conversion_action';
        await row.save();
        return row;
      }
      const conversion = P.googleClickConversion({
        customerId: config.google.customerId,
        conversionAction: action,
        eventTime: row.eventTime,
        eventId: row.eventId,
        identity,
        attribution,
        defaultCountryCode: cc,
        now,
      });
      result = await googleAds.uploadClickConversions({ customerId: config.google.customerId, conversions: [conversion], fetchImpl });
    }

    row.attempts += 1;
    row.response = result.response || null;
    if (result.ok) {
      row.status = 'sent';
      row.sentAt = now;
      // Accepted but warned (Meta `messages`, e.g. a test code that matches no
      // open Test Events session) — keep the warning visible in the log.
      const warnings = result.response && Array.isArray(result.response.messages) ? result.response.messages : [];
      row.reason = warnings.length ? trim(`warning: ${warnings.join(' ')}`) : '';
      row.nextAttemptAt = null;
    } else if (result.retryable && row.attempts < MAX_ATTEMPTS) {
      row.status = 'failed';
      row.reason = trim(result.error);
      row.nextAttemptAt = new Date(now.getTime() + BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)]);
    } else {
      row.status = 'dead';
      row.reason = trim(result.error);
      row.nextAttemptAt = null;
    }
    await row.save();
    return row;
  } catch (err) {
    console.error('[conversions] attempt error:', err?.message || err);
    try {
      row.attempts += 1;
      row.status = row.attempts < MAX_ATTEMPTS ? 'failed' : 'dead';
      row.reason = trim(`internal: ${err.message}`);
      row.nextAttemptAt = row.status === 'failed' ? new Date(Date.now() + BACKOFF_MS[0]) : null;
      await row.save();
    } catch (_) {
      /* the runner will pick it up again if it is still pending */
    }
    return row;
  }
};

/**
 * React to a lead entering a group. Creates + attempts one row per enabled
 * platform when the workspace has a rule for that board/group.
 */
const handleMovedToGroup = async ({ taskId, boardId, toGroupId }, opts = {}) => {
  const { AdConversionConfig, ConversionEvent, Board } = models();
  if (!taskId || !boardId || !toGroupId) return [];
  const board = await Board.findById(boardId).select('organisation').lean();
  if (!board || !board.organisation) return [];
  const config = await AdConversionConfig.findOne({ workspaceId: board.organisation });
  if (!config) return [];
  const rule = config.ruleFor(boardId, toGroupId);
  if (!rule) return [];

  const eventTime = opts.now || new Date();
  const rows = [];
  for (const platform of enabledPlatforms(config)) {
    let row;
    try {
      row = await ConversionEvent.create({
        workspaceId: board.organisation,
        taskId,
        boardId,
        platform,
        stage: rule.stage,
        eventId: `${taskId}:${rule.stage}`,
        eventTime,
        nextAttemptAt: eventTime,
      });
    } catch (err) {
      if (err && err.code === 11000) continue; // already reported at this stage
      throw err;
    }
    rows.push(await attempt(row, opts));
  }
  return rows;
};

/** Retry rows that are due. */
const retryDue = async (opts = {}) => {
  const { ConversionEvent } = models();
  const now = opts.now || new Date();
  const due = await ConversionEvent.find({
    status: { $in: ['pending', 'failed'] },
    nextAttemptAt: { $lte: now },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(50);
  for (const row of due) await attempt(row, opts);
  return due.length;
};

/**
 * Settings-page "Send test event": one Meta event for a fictitious lead, always
 * with a test event code so it only appears under Events Manager → Test events.
 */
const sendMetaTestEvent = async (config, testEventCode, { fetchImpl } = {}) => {
  const code = String(testEventCode || config.meta.testEventCode || '').trim();
  if (!code) return { ok: false, error: 'A test event code is required (Events Manager → Test events).' };
  const event = P.metaEvent({
    eventName: (config.meta.eventNames && config.meta.eventNames.qualified) || 'QualifiedLead',
    eventTime: new Date(),
    eventId: `leadloop-test-${Date.now()}`,
    taskId: 'leadloop-test',
    identity: { email: 'test@example.com', phone: '', firstName: 'Test', lastName: 'Lead' },
    attribution: {},
  });
  return metaCapi.sendEvents({
    datasetId: config.meta.datasetId,
    accessToken: config.getMetaToken(),
    events: [event],
    testEventCode: code,
    fetchImpl,
  });
};

let mounted = false;
const mountConversionDispatcher = () => {
  if (mounted) return;
  mounted = true;
  eventBus.on('task.moved_to_group', (payload) => {
    handleMovedToGroup(payload).catch((err) => console.error('[conversions] dispatch error:', err?.message || err));
  });
};

let started = false;
const startConversionRunner = () => {
  if (started) return;
  started = true;
  cron.schedule('* * * * *', () => {
    retryDue().catch((err) => console.error('[conversions] retry tick error:', err?.message || err));
  });
  console.log('conversion runner started');
};

module.exports = {
  handleMovedToGroup,
  attempt,
  retryDue,
  sendMetaTestEvent,
  enabledPlatforms,
  mountConversionDispatcher,
  startConversionRunner,
  BACKOFF_MS,
  MAX_ATTEMPTS,
};
