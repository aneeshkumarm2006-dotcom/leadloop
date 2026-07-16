/**
 * intakePolicyController.js — HTTP handlers for the F9 Lead Intake policy
 * (F9.4).
 *
 *   GET  /api/boards/:id/intake-policy          (member) — policy + form meta
 *   PUT  /api/boards/:id/intake-policy          (admin)  — upsert full policy
 *   GET  /api/boards/:id/intake-events?limit=10 (member) — last N executed intakes
 *
 * Access is gated by board membership / admin via `loadBoardContext` (shared
 * with the automation controller). The policy is one-per-board (unique boardId),
 * so PUT upserts.
 */

const mongoose = require('mongoose');
const LeadIntakePolicy = require('../models/LeadIntakePolicy');
const EmailTemplate = require('../models/EmailTemplate');
const AutomationRunLog = require('../models/AutomationRunLog');
const User = require('../models/User');
const { loadBoardContext } = require('./automationController');
const { getColumnType } = require('../utils/columnTypes');

const asId = (v) => (v == null ? '' : v.toString());
const isObjectId = (v) => v != null && mongoose.Types.ObjectId.isValid(asId(v));

const findColumn = (board, columnId) =>
  (board.columns || []).find((c) => asId(c._id) === asId(columnId)) || null;

/** Serialise a policy doc for the client (geoMap Map → plain object). */
const serializePolicy = (policy, boardId) => {
  if (!policy) {
    // Default skeleton so the form renders for a board with no policy yet.
    return {
      boardId: asId(boardId),
      exists: false,
      ownerStrategy: 'round_robin',
      ownerColumnId: null,
      ownerPool: [],
      geoColumnId: null,
      geoMap: {},
      fixedOwnerId: null,
      initialStageColumnId: null,
      initialStageValue: null,
      welcomeEmailTemplateId: null,
      welcomeEmailSubject: '',
      welcomeEmailBody: '',
      followupOffsetHours: 24,
      enabled: false,
    };
  }
  const geoMap = {};
  if (policy.geoMap && typeof policy.geoMap.forEach === 'function') {
    policy.geoMap.forEach((v, k) => {
      geoMap[k] = asId(v);
    });
  } else if (policy.geoMap && typeof policy.geoMap === 'object') {
    for (const [k, v] of Object.entries(policy.geoMap)) geoMap[k] = asId(v);
  }
  return {
    _id: policy._id,
    boardId: asId(policy.boardId),
    exists: true,
    ownerStrategy: policy.ownerStrategy,
    ownerColumnId: policy.ownerColumnId ? asId(policy.ownerColumnId) : null,
    ownerPool: (policy.ownerPool || []).map(asId),
    geoColumnId: policy.geoColumnId ? asId(policy.geoColumnId) : null,
    geoMap,
    fixedOwnerId: policy.fixedOwnerId ? asId(policy.fixedOwnerId) : null,
    initialStageColumnId: policy.initialStageColumnId ? asId(policy.initialStageColumnId) : null,
    initialStageValue: policy.initialStageValue,
    welcomeEmailTemplateId: policy.welcomeEmailTemplateId ? asId(policy.welcomeEmailTemplateId) : null,
    welcomeEmailSubject: policy.welcomeEmailSubject || '',
    welcomeEmailBody: policy.welcomeEmailBody || '',
    followupOffsetHours: policy.followupOffsetHours,
    enabled: policy.enabled,
    lastAssignedIndex: policy.lastAssignedIndex,
    updatedAt: policy.updatedAt,
  };
};

/** Form-helper metadata: typed columns, members, and available templates. */
const buildMeta = async (board, org) => {
  const cols = board.columns || [];
  const personColumns = cols.filter((c) => c.type === 'person').map((c) => ({ _id: asId(c._id), name: c.name, key: c.key }));
  const statusColumns = cols
    .filter((c) => c.type === 'status' || c.type === 'dropdown')
    .map((c) => ({
      _id: asId(c._id),
      name: c.name,
      key: c.key,
      type: c.type,
      options: ((c.settings && c.settings.options) || []).map((o) => ({ id: asId(o.id), label: o.label })),
    }));
  const emailColumns = cols.filter((c) => c.type === 'email').map((c) => ({ _id: asId(c._id), name: c.name, key: c.key }));
  // City/region candidates: text / dropdown / location columns the geo strategy
  // can read off the lead.
  const geoColumns = cols
    .filter((c) => ['text', 'dropdown', 'location', 'long_text'].includes(c.type))
    .map((c) => ({ _id: asId(c._id), name: c.name, key: c.key, type: c.type }));

  const members = await User.find({ _id: { $in: org.members } }).select('name email').lean();
  const templates = await EmailTemplate.find({
    $or: [{ isSeed: true }, { workspaceId: org._id }],
  })
    .select('name subject body region')
    .sort({ region: 1, name: 1 })
    .lean();

  return {
    personColumns,
    statusColumns,
    emailColumns,
    geoColumns,
    members: members.map((m) => ({ _id: asId(m._id), name: m.name, email: m.email })),
    templates: templates.map((t) => ({
      _id: asId(t._id),
      name: t.name,
      subject: t.subject,
      body: t.body,
      region: t.region || null,
    })),
  };
};

/** GET /api/boards/:id/intake-policy (member). */
const getIntakePolicy = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid board id' });
    const ctx = await loadBoardContext(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const policy = await LeadIntakePolicy.findOne({ boardId: req.params.id });
    const meta = await buildMeta(ctx.board, ctx.org);
    return res.json({
      policy: serializePolicy(policy, req.params.id),
      meta,
      isAdmin: ctx.isAdmin,
    });
  } catch (err) {
    console.error('getIntakePolicy error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * Validate + normalise the PUT body against the board + org. Returns
 * `{ doc }` or `{ error }`.
 */
const sanitizePolicy = (body, board, org) => {
  const cfg = body || {};
  const memberIds = new Set(org.members.map((m) => m.toString()));
  const doc = {};

  // Owner strategy
  const strategy = cfg.ownerStrategy;
  if (!['round_robin', 'geo', 'fixed'].includes(strategy)) {
    return { error: "ownerStrategy must be 'round_robin', 'geo' or 'fixed'" };
  }
  doc.ownerStrategy = strategy;

  // Owner column (optional) — must be a person column on the board.
  if (cfg.ownerColumnId) {
    const col = findColumn(board, cfg.ownerColumnId);
    if (!col || col.type !== 'person') return { error: 'ownerColumnId must be a person column on this board' };
    doc.ownerColumnId = asId(col._id);
  } else {
    doc.ownerColumnId = null;
  }

  // Owner pool — org members only.
  const pool = Array.isArray(cfg.ownerPool) ? cfg.ownerPool : [];
  const seen = new Set();
  const cleanPool = [];
  for (const raw of pool) {
    const id = asId(raw);
    if (!isObjectId(id)) return { error: 'ownerPool contains an invalid user id' };
    if (!memberIds.has(id)) return { error: 'ownerPool contains a non-member' };
    if (seen.has(id)) continue;
    seen.add(id);
    cleanPool.push(id);
  }
  doc.ownerPool = cleanPool;

  // Geo column + map
  if (cfg.geoColumnId) {
    const col = findColumn(board, cfg.geoColumnId);
    if (!col) return { error: 'geoColumnId does not belong to this board' };
    doc.geoColumnId = asId(col._id);
  } else {
    doc.geoColumnId = null;
  }
  const geoMap = {};
  if (cfg.geoMap && typeof cfg.geoMap === 'object' && !Array.isArray(cfg.geoMap)) {
    for (const [city, userId] of Object.entries(cfg.geoMap)) {
      const key = String(city).trim();
      if (!key) continue;
      const id = asId(userId);
      if (!id) continue;
      if (!isObjectId(id)) return { error: `geoMap["${key}"] is an invalid user id` };
      if (!memberIds.has(id)) return { error: `geoMap["${key}"] is not a workspace member` };
      geoMap[key] = id;
    }
  }
  doc.geoMap = geoMap;

  // Fixed owner
  if (cfg.fixedOwnerId) {
    const id = asId(cfg.fixedOwnerId);
    if (!isObjectId(id)) return { error: 'fixedOwnerId is invalid' };
    if (!memberIds.has(id)) return { error: 'fixedOwnerId is not a workspace member' };
    doc.fixedOwnerId = id;
  } else {
    doc.fixedOwnerId = null;
  }

  // Strategy-specific sanity (warn-by-reject so a misconfigured save is caught early).
  if (strategy === 'round_robin' && cleanPool.length === 0) {
    return { error: 'Round-robin requires at least one user in the owner pool' };
  }
  if (strategy === 'fixed' && !doc.fixedOwnerId) {
    return { error: 'Fixed strategy requires a fixed owner' };
  }
  if (strategy === 'geo' && !doc.geoColumnId) {
    return { error: 'Geo strategy requires a city/region column' };
  }

  // Initial stage
  if (cfg.initialStageColumnId) {
    const col = findColumn(board, cfg.initialStageColumnId);
    if (!col || (col.type !== 'status' && col.type !== 'dropdown')) {
      return { error: 'initialStageColumnId must be a status/dropdown column' };
    }
    doc.initialStageColumnId = asId(col._id);
    if (cfg.initialStageValue != null && cfg.initialStageValue !== '') {
      const entry = getColumnType(col.type);
      try {
        entry.validate(cfg.initialStageValue, col.settings || {});
      } catch (e) {
        return { error: `initialStageValue is not a valid option: ${e.message}` };
      }
      doc.initialStageValue = String(cfg.initialStageValue);
    } else {
      doc.initialStageValue = null;
    }
  } else {
    doc.initialStageColumnId = null;
    doc.initialStageValue = null;
  }

  // Welcome email
  if (cfg.welcomeEmailTemplateId) {
    if (!isObjectId(cfg.welcomeEmailTemplateId)) return { error: 'welcomeEmailTemplateId is invalid' };
    doc.welcomeEmailTemplateId = asId(cfg.welcomeEmailTemplateId);
  } else {
    doc.welcomeEmailTemplateId = null;
  }
  doc.welcomeEmailSubject = cfg.welcomeEmailSubject ? String(cfg.welcomeEmailSubject) : '';
  doc.welcomeEmailBody = cfg.welcomeEmailBody ? String(cfg.welcomeEmailBody) : '';

  // Follow-up offset
  if (cfg.followupOffsetHours != null && cfg.followupOffsetHours !== '') {
    const n = Number(cfg.followupOffsetHours);
    if (!Number.isFinite(n) || n < 0) return { error: 'followupOffsetHours must be a non-negative number' };
    doc.followupOffsetHours = n;
  } else {
    doc.followupOffsetHours = 24;
  }

  doc.enabled = cfg.enabled === true || cfg.enabled === 'true';
  doc.updatedAt = new Date();
  return { doc };
};

/** PUT /api/boards/:id/intake-policy (admin) — upsert. */
const upsertIntakePolicy = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid board id' });
    const ctx = await loadBoardContext(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    if (!ctx.isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const { doc, error } = sanitizePolicy(req.body, ctx.board, ctx.org);
    if (error) return res.status(400).json({ error });

    // `geoMap` is a Map field — set via $set with a plain object is fine; but a
    // partial $set won't clear removed keys, so we replace the whole doc body.
    const existing = await LeadIntakePolicy.findOne({ boardId: req.params.id });
    let policy;
    if (existing) {
      // Preserve the round-robin cursor across edits.
      Object.assign(existing, doc);
      existing.geoMap = doc.geoMap;
      policy = await existing.save();
    } else {
      policy = await LeadIntakePolicy.create({ boardId: req.params.id, ...doc });
    }

    return res.json({ policy: serializePolicy(policy, req.params.id) });
  } catch (err) {
    console.error('upsertIntakePolicy error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/boards/:id/intake-events?limit=10 (member). */
const listIntakeEvents = async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid board id' });
    const ctx = await loadBoardContext(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const policy = await LeadIntakePolicy.findOne({ boardId: req.params.id }).select('_id');
    if (!policy) return res.json({ events: [] });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const rows = await AutomationRunLog.find({
      policyId: policy._id,
      actionType: 'LEAD_INTAKE_POLICY',
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('taskId', 'name')
      .lean();

    // Enrich the owner id with a display name for the panel.
    const ownerIds = [
      ...new Set(rows.map((r) => r.payloadSummary && r.payloadSummary.ownerId).filter(Boolean).map(String)),
    ];
    const owners = ownerIds.length
      ? await User.find({ _id: { $in: ownerIds } }).select('name email').lean()
      : [];
    const ownerById = {};
    owners.forEach((o) => {
      ownerById[asId(o._id)] = { name: o.name, email: o.email };
    });

    const events = rows.map((r) => {
      const ps = r.payloadSummary || {};
      const ownerId = ps.ownerId ? asId(ps.ownerId) : null;
      return {
        _id: asId(r._id),
        runId: asId(r.runId),
        status: r.status,
        createdAt: r.createdAt,
        taskId: r.taskId ? asId(r.taskId._id || r.taskId) : null,
        taskName: r.taskId && r.taskId.name ? r.taskId.name : null,
        ownerId,
        ownerName: ownerId && ownerById[ownerId] ? ownerById[ownerId].name : null,
        strategy: ps.strategy || null,
        fallback: !!ps.fallback,
        city: ps.city || null,
        stageSet: !!ps.stageSet,
        welcomeStatus: ps.welcomeStatus || null,
        emailMessageId: ps.emailMessageId || null,
        followupTaskId: ps.followupTaskId || null,
      };
    });

    return res.json({ events });
  } catch (err) {
    console.error('listIntakeEvents error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getIntakePolicy,
  upsertIntakePolicy,
  listIntakeEvents,
};
