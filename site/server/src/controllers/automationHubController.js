const mongoose = require('mongoose');
const Organisation = require('../models/Organisation');
const Board = require('../models/Board');
const Automation = require('../models/Automation');
const AutomationRunLog = require('../models/AutomationRunLog');
const EmailAccount = require('../models/EmailAccount');
const SmsConfig = require('../models/SmsConfig');
const WhatsAppConfig = require('../models/WhatsAppConfig');
const WebhookEndpoint = require('../models/WebhookEndpoint');
const LeadConnection = require('../models/LeadConnection');

/**
 * automationHubController — account-wide ("hub") views over every automation in
 * an organisation (Phase 1b). The board-scoped CRUD lives in
 * automationController; this controller is read-only aggregation:
 *   - GET /api/automations/hub?orgId=…   → all automations + health stats
 *   - GET /api/automations/usage?orgId=… → run-log observability aggregates
 *
 * Both are admin-only: the hub is an account-management surface.
 */

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const loadOrgContext = async (orgId, userId) => {
  if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) {
    return { status: 400, error: 'A valid orgId is required' };
  }
  const org = await Organisation.findById(orgId);
  if (!org) return { status: 404, error: 'Organisation not found' };
  const isMember = org.members.some((m) => m.toString() === userId);
  if (!isMember) return { status: 403, error: 'Not a member of this organisation' };
  if (!isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { org };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/automations/hub?orgId=…
 * Returns every automation across the org's boards with a lightweight summary,
 * plus health/aggregate stats for the hub header.
 */
const getHub = async (req, res) => {
  try {
    const ctx = await loadOrgContext(req.query.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const orgId = ctx.org._id;

    const [boards, automations] = await Promise.all([
      Board.find({ organisation: orgId }).select('name color').lean(),
      Automation.find({ organisation: orgId })
        .populate('createdBy', 'name profilePic email')
        .select('name board enabled validation triggerType triggerConfig actions lastRunAt createdBy createdAt')
        .lean(),
    ]);

    const boardById = new Map(boards.map((b) => [b._id.toString(), b]));

    // Recent failures (last 7 days) per automation, for the Health tab.
    const since = new Date(Date.now() - 7 * DAY_MS);
    const autoIds = automations.map((a) => a._id);
    const failures = autoIds.length
      ? await AutomationRunLog.aggregate([
          { $match: { automationId: { $in: autoIds }, status: 'failed', createdAt: { $gte: since } } },
          { $group: { _id: '$automationId', count: { $sum: 1 }, lastError: { $last: '$error' }, lastAt: { $max: '$createdAt' } } },
        ])
      : [];
    const failureBy = new Map(failures.map((f) => [f._id.toString(), f]));

    const items = automations.map((a) => {
      const board = boardById.get(a.board?.toString());
      const actions = Array.isArray(a.actions) ? a.actions : [];
      const fail = failureBy.get(a._id.toString());
      const incomplete = a.validation === 'incomplete';
      return {
        _id: a._id,
        name: a.name,
        enabled: a.enabled !== false,
        triggerType: a.triggerType,
        triggerConfig: a.triggerConfig || {},
        actionCount: actions.length,
        actionTypes: actions.map((ac) => ac.type),
        validation: a.validation || 'complete',
        needsSetup: incomplete,
        lastRunAt: a.lastRunAt || null,
        createdAt: a.createdAt || null,
        owner: a.createdBy
          ? { _id: a.createdBy._id, name: a.createdBy.name, profilePic: a.createdBy.profilePic, email: a.createdBy.email }
          : null,
        board: board ? { _id: board._id, name: board.name, color: board.color } : { _id: a.board, name: '—' },
        recentFailures: fail ? fail.count : 0,
        lastError: fail ? fail.lastError : null,
      };
    });

    const stats = {
      total: items.length,
      enabled: items.filter((i) => i.enabled).length,
      needsSetup: items.filter((i) => i.needsSetup).length,
      failing: items.filter((i) => i.recentFailures > 0).length,
      boards: boards.length,
    };

    return res.json({ automations: items, boards: boards.map((b) => ({ _id: b._id, name: b.name, color: b.color })), stats });
  } catch (err) {
    console.error('getHub error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/automations/usage?orgId=…&from=ISO&to=ISO
 * Observability aggregates over AutomationRunLog for the org, in a date range
 * (default: last 30 days). No quota / cap — purely informational.
 */
const getUsage = async (req, res) => {
  try {
    const ctx = await loadOrgContext(req.query.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const orgId = ctx.org._id;

    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(to.getTime() - 30 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ error: 'Invalid from/to date' });
    }

    // Resolve the org's automations → id → {name, board, owner}.
    const [automations, boards] = await Promise.all([
      Automation.find({ organisation: orgId })
        .populate('createdBy', 'name profilePic')
        .select('name board createdBy')
        .lean(),
      Board.find({ organisation: orgId }).select('name').lean(),
    ]);
    const autoById = new Map(automations.map((a) => [a._id.toString(), a]));
    const boardName = new Map(boards.map((b) => [b._id.toString(), b.name]));
    const autoIds = automations.map((a) => a._id);

    if (autoIds.length === 0) {
      return res.json({
        from, to, totalActions: 0, byStatus: {}, byDay: [], byActionType: [],
        topAutomations: [], topBoards: [], topCreators: [],
      });
    }

    const logs = await AutomationRunLog.find({
      automationId: { $in: autoIds },
      createdAt: { $gte: from, $lte: to },
    })
      .select('automationId actionType status createdAt')
      .lean();

    const byStatus = { ok: 0, failed: 0, skipped: 0 };
    const byDayMap = new Map();
    const byActionMap = new Map();
    const byAutoMap = new Map();
    const byBoardMap = new Map();
    const byCreatorMap = new Map();

    for (const l of logs) {
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;

      const day = l.createdAt.toISOString().slice(0, 10);
      byDayMap.set(day, (byDayMap.get(day) || 0) + 1);

      byActionMap.set(l.actionType, (byActionMap.get(l.actionType) || 0) + 1);

      const aId = l.automationId?.toString();
      byAutoMap.set(aId, (byAutoMap.get(aId) || 0) + 1);

      const auto = autoById.get(aId);
      if (auto) {
        const bId = auto.board?.toString();
        if (bId) byBoardMap.set(bId, (byBoardMap.get(bId) || 0) + 1);
        const cId = auto.createdBy?._id?.toString();
        if (cId) byCreatorMap.set(cId, (byCreatorMap.get(cId) || 0) + 1);
      }
    }

    // Fill empty days across the range so the bar chart is continuous.
    const byDay = [];
    const startDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const endDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    for (let d = startDay; d <= endDay; d = new Date(d.getTime() + DAY_MS)) {
      const key = d.toISOString().slice(0, 10);
      byDay.push({ date: key, count: byDayMap.get(key) || 0 });
    }

    const byActionType = [...byActionMap.entries()]
      .map(([actionType, count]) => ({ actionType, count }))
      .sort((a, b) => b.count - a.count);

    const topAutomations = [...byAutoMap.entries()]
      .map(([id, count]) => ({ _id: id, name: autoById.get(id)?.name || '—', boardName: boardName.get(autoById.get(id)?.board?.toString()) || '—', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topBoards = [...byBoardMap.entries()]
      .map(([id, count]) => ({ _id: id, name: boardName.get(id) || '—', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const topCreators = [...byCreatorMap.entries()]
      .map(([id, count]) => {
        const auto = automations.find((a) => a.createdBy?._id?.toString() === id);
        const owner = auto?.createdBy;
        return { _id: id, name: owner?.name || '—', profilePic: owner?.profilePic || null, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return res.json({
      from, to,
      totalActions: logs.length,
      byStatus,
      byDay,
      byActionType,
      topAutomations,
      topBoards,
      topCreators,
    });
  } catch (err) {
    console.error('getUsage error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/automations/connections?orgId=…
 * Real connected-status for each native channel automations can use, plus the
 * page that manages it (admin-only). Reuses the channel models' own
 * "is connected" logic so the hub never drifts from the settings screens.
 */
const getConnections = async (req, res) => {
  try {
    const ctx = await loadOrgContext(req.query.orgId, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const orgId = ctx.org._id;

    const [emailAccounts, smsConfig, whatsappConfig, boards] = await Promise.all([
      EmailAccount.find({ workspaceId: orgId }).select('provider defaultFrom status').lean(),
      SmsConfig.findOne({ workspaceId: orgId }),
      WhatsAppConfig.findOne({ workspaceId: orgId }),
      Board.find({ organisation: orgId }).select('name').lean(),
    ]);

    const boardIds = boards.map((b) => b._id);
    const [endpoints, leadConnections] = boardIds.length
      ? await Promise.all([
          WebhookEndpoint.find({ boardId: { $in: boardIds }, enabled: true })
            .select('boardId direction')
            .lean(),
          LeadConnection.find({ boardId: { $in: boardIds }, enabled: true })
            .select('boardId')
            .lean(),
        ])
      : [[], []];

    const activeEmail = emailAccounts.filter((a) => a.status === 'active');
    const hasGmail = activeEmail.some((a) => a.provider === 'gmail');

    // Webhook count per board (enabled only).
    const boardName = new Map(boards.map((b) => [b._id.toString(), b.name]));
    const byBoard = new Map();
    for (const e of endpoints) {
      const id = e.boardId.toString();
      byBoard.set(id, (byBoard.get(id) || 0) + 1);
    }
    const webhookBoards = [...byBoard.entries()].map(([id, count]) => ({
      _id: id,
      name: boardName.get(id) || '—',
      count,
    }));

    return res.json({
      channels: {
        email: {
          connected: activeEmail.length > 0,
          count: activeEmail.length,
          accounts: activeEmail.map((a) => ({ provider: a.provider, defaultFrom: a.defaultFrom, status: a.status })),
          manageLink: '/settings?tab=email',
        },
        sms: {
          connected: !!(smsConfig && smsConfig.isSendable && smsConfig.isSendable()),
          defaultFrom: smsConfig ? smsConfig.defaultFrom || smsConfig.messagingServiceSid || null : null,
          manageLink: '/settings?tab=sms',
        },
        whatsapp: {
          connected: !!(whatsappConfig && whatsappConfig.isSendable && whatsappConfig.isSendable()),
          sender: whatsappConfig ? whatsappConfig.whatsappSenderId || null : null,
          manageLink: '/settings?tab=whatsapp',
        },
        webhooks: {
          connected: endpoints.length > 0,
          count: endpoints.length,
          boards: webhookBoards,
        },
        // F14 — "Lead Intake API" keys (enabled only), surfaced so the
        // Integrations page can show the card as connected.
        leadApi: {
          connected: leadConnections.length > 0,
          count: leadConnections.length,
        },
        calendar: {
          // Calendar events ride the Gmail OAuth (same Google account); the
          // CREATE_CALENDAR_EVENT action ships in a later phase.
          connected: hasGmail,
          available: false,
          manageLink: '/settings?tab=email',
        },
      },
    });
  } catch (err) {
    console.error('getConnections error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getHub, getUsage, getConnections };
