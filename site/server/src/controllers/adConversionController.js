/**
 * adConversionController.js — workspace ad-conversion settings (admin) and the
 * per-lead conversion log (members).
 *
 *   GET  /api/workspaces/:id/ad-conversions            settings (token redacted)
 *   PUT  /api/workspaces/:id/ad-conversions            update settings
 *   POST /api/workspaces/:id/ad-conversions/meta/test  send a Meta TEST event
 *   GET  /api/workspaces/:id/ad-conversions/events     recent sends (log)
 *   GET  /api/tasks/:id/conversions                    sends for one lead
 */

const mongoose = require('mongoose');
const AdConversionConfig = require('../models/AdConversionConfig');
const ConversionEvent = require('../models/ConversionEvent');
const Board = require('../models/Board');
const TaskGroup = require('../models/TaskGroup');
const Task = require('../models/Task');
const Organisation = require('../models/Organisation');
const aesEncrypt = require('../utils/aesEncrypt');
const googleAds = require('../services/googleAdsConversions');
const { sendMetaTestEvent } = require('../services/conversionService');
const { getChecklist } = require('../services/adTrackingService');

const asId = (v) => (v == null ? '' : v.toString());
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);
const clean = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

const serialize = (config, workspaceId) => {
  const c = config || new AdConversionConfig({ workspaceId });
  return {
    workspaceId: asId(workspaceId),
    exists: !!config,
    meta: {
      enabled: !!c.meta.enabled,
      datasetId: c.meta.datasetId || '',
      hasAccessToken: !!c.meta.accessToken,
      testEventCode: c.meta.testEventCode || '',
      eventNames: {
        qualified: c.meta.eventNames?.qualified || 'QualifiedLead',
        customer: c.meta.eventNames?.customer || 'ConvertedLead',
      },
    },
    google: {
      enabled: !!c.google.enabled,
      customerId: c.google.customerId || '',
      conversionActions: {
        qualified: c.google.conversionActions?.qualified || '',
        customer: c.google.conversionActions?.customer || '',
      },
      // Agency credentials live in server env — tell the UI what is missing.
      serverConfigured: googleAds.isConfigured(),
      serverMissing: googleAds.missingConfig(),
    },
    rules: (c.rules || []).map((r) => ({ boardId: asId(r.boardId), groupId: asId(r.groupId), stage: r.stage })),
    defaultPhoneCountryCode: c.defaultPhoneCountryCode || '1',
    encryptionConfigured: aesEncrypt.isConfigured(),
    updatedAt: config ? config.updatedAt : null,
  };
};

const serializeEvent = (e) => ({
  _id: asId(e._id),
  taskId: asId(e.taskId),
  platform: e.platform,
  stage: e.stage,
  status: e.status,
  reason: e.reason || '',
  test: !!e.test,
  attempts: e.attempts,
  eventTime: e.eventTime,
  sentAt: e.sentAt,
  nextAttemptAt: e.nextAttemptAt,
});

/** GET /api/workspaces/:id/ad-conversions */
const getConfig = async (req, res) => {
  try {
    const config = await AdConversionConfig.findOne({ workspaceId: req.params.id });
    return res.json({ config: serialize(config, req.params.id) });
  } catch (err) {
    console.error('getAdConversionConfig error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PUT /api/workspaces/:id/ad-conversions — partial update. Token is write-only. */
const updateConfig = async (req, res) => {
  try {
    const workspaceId = req.params.id;
    const body = req.body || {};
    const meta = body.meta || {};
    const google = body.google || {};

    const tokenProvided = typeof meta.accessToken === 'string' && meta.accessToken.trim();
    if (tokenProvided && !aesEncrypt.isConfigured()) {
      return res.status(503).json({ error: 'Token encryption is not configured on the server (EMAIL_TOKEN_ENCRYPTION_KEY).' });
    }
    if (meta.datasetId !== undefined && clean(meta.datasetId) && !/^\d{6,25}$/.test(clean(meta.datasetId))) {
      return res.status(400).json({ error: 'Meta dataset ID should be the numeric ID shown in Events Manager.' });
    }
    if (google.customerId !== undefined && clean(google.customerId) && clean(google.customerId).replace(/\D/g, '').length !== 10) {
      return res.status(400).json({ error: 'Google Ads customer ID must be 10 digits (xxx-xxx-xxxx).' });
    }

    let config = await AdConversionConfig.findOne({ workspaceId });
    if (!config) config = new AdConversionConfig({ workspaceId });

    // --- Meta
    if (meta.datasetId !== undefined) config.meta.datasetId = clean(meta.datasetId, 30);
    if (meta.testEventCode !== undefined) config.meta.testEventCode = clean(meta.testEventCode, 40);
    if (meta.eventNames) {
      for (const stage of AdConversionConfig.STAGES) {
        if (meta.eventNames[stage] !== undefined) {
          const name = clean(meta.eventNames[stage], 50);
          if (name && !/^[A-Za-z0-9_ ]+$/.test(name)) {
            return res.status(400).json({ error: 'Event names may use letters, numbers, spaces and underscores only.' });
          }
          config.meta.eventNames[stage] = name;
        }
      }
    }
    if (tokenProvided) config.setMetaToken(meta.accessToken.trim());
    else if (meta.accessToken === null) config.setMetaToken(null);
    if (meta.enabled !== undefined) config.meta.enabled = meta.enabled === true;

    // --- Google
    if (google.customerId !== undefined) config.google.customerId = clean(google.customerId, 20);
    if (google.conversionActions) {
      for (const stage of AdConversionConfig.STAGES) {
        if (google.conversionActions[stage] !== undefined) {
          config.google.conversionActions[stage] = clean(google.conversionActions[stage], 120);
        }
      }
    }
    if (google.enabled !== undefined) config.google.enabled = google.enabled === true;

    if (body.defaultPhoneCountryCode !== undefined) {
      const cc = clean(body.defaultPhoneCountryCode, 4).replace(/\D/g, '');
      config.defaultPhoneCountryCode = cc || '1';
    }

    // --- Stage rules: every board must belong to this workspace and every
    // group to its board, so nobody can wire another workspace's pipeline.
    if (Array.isArray(body.rules)) {
      const rules = body.rules
        .filter((r) => r && isObjectId(r.boardId) && isObjectId(r.groupId) && AdConversionConfig.STAGES.includes(r.stage))
        .slice(0, 100);
      const boardIds = [...new Set(rules.map((r) => asId(r.boardId)))];
      const boards = await Board.find({ _id: { $in: boardIds }, organisation: workspaceId }).select('_id').lean();
      const okBoards = new Set(boards.map((b) => asId(b._id)));
      const groups = await TaskGroup.find({ _id: { $in: rules.map((r) => r.groupId) } }).select('_id board').lean();
      const groupBoard = new Map(groups.map((g) => [asId(g._id), asId(g.board)]));
      const seen = new Set();
      config.rules = rules.filter((r) => {
        const key = `${r.boardId}:${r.groupId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return okBoards.has(asId(r.boardId)) && groupBoard.get(asId(r.groupId)) === asId(r.boardId);
      });
    }

    if (config.meta.enabled && !(config.meta.datasetId && config.meta.accessToken)) {
      return res.status(400).json({ error: 'Add the Meta dataset ID and access token before turning Meta on.' });
    }
    if (config.google.enabled && !config.google.customerId) {
      return res.status(400).json({ error: 'Add the Google Ads customer ID before turning Google on.' });
    }

    await config.save();
    return res.json({ config: serialize(config, workspaceId) });
  } catch (err) {
    console.error('updateAdConversionConfig error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/workspaces/:id/ad-conversions/meta/test — body { testEventCode? } */
const testMeta = async (req, res) => {
  try {
    const config = await AdConversionConfig.findOne({ workspaceId: req.params.id });
    if (!config || !config.meta.datasetId || !config.meta.accessToken) {
      return res.status(400).json({ error: 'Save the Meta dataset ID and access token first.' });
    }
    const result = await sendMetaTestEvent(config, req.body && req.body.testEventCode);
    if (result.ok) {
      // Meta can accept an event and still warn about it (e.g. the test code
      // doesn't match an open Test Events session) — pass warnings through.
      const warned = Array.isArray(result.response?.messages) && result.response.messages.length > 0;
      if (!warned) {
        config.meta.lastTestOkAt = new Date(); // ticks "Meta verified" on the checklist
        await config.save();
      }
      return res.json({
        ok: true,
        eventsReceived: result.response?.events_received ?? null,
        fbtraceId: result.response?.fbtrace_id || null,
        warnings: Array.isArray(result.response?.messages) ? result.response.messages : [],
      });
    }
    return res.status(502).json({ ok: false, error: result.error || 'Meta rejected the event' });
  } catch (err) {
    console.error('testMeta error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/workspaces/:id/ad-conversions/events — latest sends (admin). */
const listEvents = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const events = await ConversionEvent.find({ workspaceId: req.params.id }).sort({ createdAt: -1 }).limit(limit).lean();
    const tasks = await Task.find({ _id: { $in: events.map((e) => e.taskId) } }).select('name').lean();
    const names = new Map(tasks.map((t) => [asId(t._id), t.name]));
    return res.json({ events: events.map((e) => ({ ...serializeEvent(e), leadName: names.get(asId(e.taskId)) || '' })) });
  } catch (err) {
    console.error('listConversionEvents error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/tasks/:id/conversions — this lead's sends (workspace members). */
const listTaskConversions = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid task id' });
    const task = await Task.findById(req.params.id).select('board isPersonal').lean();
    if (!task || task.isPersonal) return res.status(404).json({ error: 'Task not found' });
    const board = await Board.findById(task.board).select('organisation').lean();
    const org = board && (await Organisation.findById(board.organisation).select('members').lean());
    if (!org || !(org.members || []).some((m) => asId(m) === req.user.userId)) {
      return res.status(403).json({ error: 'Not a member of this organisation' });
    }
    const events = await ConversionEvent.find({ taskId: req.params.id }).sort({ createdAt: 1 }).lean();
    return res.json({ events: events.map(serializeEvent) });
  } catch (err) {
    console.error('listTaskConversions error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/workspaces/:id/ad-conversions/checklist — derived setup progress (admin). */
const checklist = async (req, res) => {
  try {
    return res.json({ checklist: await getChecklist(req.params.id) });
  } catch (err) {
    console.error('adTrackingChecklist error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getConfig, updateConfig, testMeta, listEvents, listTaskConversions, checklist, serialize };
