/**
 * complianceController.js — consent records, the suppression list, and the
 * audit export.
 *
 *   GET    /api/compliance/suppressions?org=   (member) the do-not-contact list
 *   POST   /api/compliance/suppressions        (admin)  add one
 *   DELETE /api/compliance/suppressions/:id    (admin)  remove one
 *   GET    /api/compliance/consent/:taskId     (member) a lead's consent
 *   POST   /api/compliance/consent/:taskId     (member) record consent
 *   GET    /api/compliance/export?org=         (admin)  CSV audit trail
 *
 * The export exists because "we had consent" is only worth anything if it can
 * be produced on demand, with dates and wording.
 */

const mongoose = require('mongoose');
const Organisation = require('../models/Organisation');
const Suppression = require('../models/Suppression');
const LeadConsent = require('../models/LeadConsent');
const Task = require('../models/Task');
const { suppress, unsuppress, recordConsent } = require('../services/consentGate');
const { STATES, CHANNELS, impliedExpiryFor } = require('../services/consentService');

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const loadOrg = async (orgId, userId, { admin = false } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(orgId)) return { status: 400, error: 'Invalid workspace id' };
  const org = await Organisation.findById(orgId);
  if (!org) return { status: 404, error: 'Workspace not found' };
  if (!org.members.some((m) => m.toString() === userId)) {
    return { status: 403, error: 'Not a member of this workspace' };
  }
  if (admin && !isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { org };
};

// --- suppression list -------------------------------------------------------

const listSuppressions = async (req, res) => {
  try {
    const ctx = await loadOrg(req.query.org, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const rows = await Suppression.find({ organisation: ctx.org._id }).sort({ createdAt: -1 }).limit(500).lean();
    return res.json({
      suppressions: rows.map((r) => ({
        _id: r._id,
        kind: r.kind,
        display: r.display || r.value,
        reason: r.reason,
        note: r.note || '',
        createdAt: r.createdAt,
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error('listSuppressions error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const addSuppression = async (req, res) => {
  try {
    const ctx = await loadOrg(req.body?.org, req.user.userId, { admin: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { kind, value, reason, note } = req.body || {};
    if (!['email', 'phone'].includes(kind)) return res.status(400).json({ error: 'kind must be email or phone' });
    if (!value || !String(value).trim()) return res.status(400).json({ error: 'A value is required' });

    const channel = kind === 'email' ? 'email' : 'sms';
    const row = await suppress(ctx.org._id, channel, value, {
      reason: ['stop', 'unsubscribe', 'dnc', 'manual', 'bounce'].includes(reason) ? reason : 'manual',
      note: String(note || '').trim(),
      userId: req.user.userId,
    });
    if (!row) return res.status(400).json({ error: 'That does not look like a valid email or phone number' });
    return res.status(201).json({ suppression: { _id: row._id, kind: row.kind, display: row.display, reason: row.reason } });
  } catch (err) {
    console.error('addSuppression error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const removeSuppression = async (req, res) => {
  try {
    const row = await Suppression.findById(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const ctx = await loadOrg(row.organisation, req.user.userId, { admin: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await unsuppress(row.organisation, row.kind, row.value);
    return res.json({ removed: true });
  } catch (err) {
    console.error('removeSuppression error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// --- per-lead consent -------------------------------------------------------

const getConsent = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId).select('board organisation name').lean();
    if (!task) return res.status(404).json({ error: 'Lead not found' });
    const Board = require('../models/Board');
    const board = await Board.findById(task.board).select('organisation').lean();
    if (!board) return res.status(404).json({ error: 'Board not found' });
    const ctx = await loadOrg(board.organisation, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const rows = await LeadConsent.find({ task: task._id }).lean();
    const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));
    return res.json({
      consent: CHANNELS.map((channel) => {
        const r = byChannel[channel] || null;
        return {
          channel,
          state: r?.state || STATES.NONE,
          basis: r?.basis || null,
          source: r?.source || '',
          wording: r?.wording || '',
          capturedAt: r?.capturedAt || null,
          withdrawnAt: r?.withdrawnAt || null,
          expiresAt: r ? impliedExpiryFor(r) : null,
        };
      }),
    });
  } catch (err) {
    console.error('getConsent error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const setConsent = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId).select('board').lean();
    if (!task) return res.status(404).json({ error: 'Lead not found' });
    const Board = require('../models/Board');
    const board = await Board.findById(task.board).select('organisation').lean();
    if (!board) return res.status(404).json({ error: 'Board not found' });
    const ctx = await loadOrg(board.organisation, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const { channel, state, basis, wording } = req.body || {};
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Unknown channel' });
    if (!Object.values(STATES).includes(state)) return res.status(400).json({ error: 'Unknown consent state' });

    const row = await recordConsent(ctx.org._id, task._id, channel, {
      state,
      basis,
      source: 'manual',
      wording: String(wording || '').trim(),
      ip: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
      userId: req.user.userId,
    });
    return res.json({ consent: { channel: row.channel, state: row.state, capturedAt: row.capturedAt } });
  } catch (err) {
    console.error('setConsent error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// --- audit export -----------------------------------------------------------

const csvEscape = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET /api/compliance/export?org= — the evidence, as CSV. */
const exportAudit = async (req, res) => {
  try {
    const ctx = await loadOrg(req.query.org, req.user.userId, { admin: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const [consents, suppressions] = await Promise.all([
      LeadConsent.find({ organisation: ctx.org._id }).populate('task', 'name').lean(),
      Suppression.find({ organisation: ctx.org._id }).lean(),
    ]);

    const rows = [['record', 'lead', 'channel', 'state', 'basis', 'source', 'wording', 'captured_at', 'expires_at', 'withdrawn_at']];
    for (const c of consents) {
      rows.push([
        'consent',
        c.task?.name || '',
        c.channel,
        c.state,
        c.basis || '',
        c.source || '',
        c.wording || '',
        c.capturedAt ? new Date(c.capturedAt).toISOString() : '',
        impliedExpiryFor(c) ? impliedExpiryFor(c).toISOString() : '',
        c.withdrawnAt ? new Date(c.withdrawnAt).toISOString() : '',
      ]);
    }
    for (const s of suppressions) {
      rows.push(['suppression', s.display || s.value, s.kind, 'suppressed', s.reason, s.note || '', '', new Date(s.createdAt).toISOString(), '', '']);
    }

    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="consent-audit.csv"');
    return res.send(csv);
  } catch (err) {
    console.error('exportAudit error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  listSuppressions,
  addSuppression,
  removeSuppression,
  getConsent,
  setConsent,
  exportAudit,
};
