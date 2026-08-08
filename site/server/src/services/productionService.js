/**
 * productionService.js — the Production report: GCI / commission, source ROI
 * with REVENUE, and the agent leaderboard.
 *
 * This is the money layer the Marketing/ROI report (marketingRoiService.js)
 * couldn't provide: that one knows ad SPEND per source but has no notion of
 * what a closing is worth, so it can only give cost-per-lead / cost-per-won.
 * Here every won lead carries a deal value, which yields:
 *
 *   • GCI (gross commission income) — deal value × commission rate. The rate is
 *     read per-deal from a commission column when the board has one, else the
 *     report-wide `commissionRate` is applied. A per-deal override matters in
 *     real estate: referral and team-split deals don't earn the house rate.
 *   • Source ROI — revenue (GCI) vs ad spend per source: profit and ROI%, not
 *     just cost. This is what tells an agent which portal actually pays.
 *   • Agent leaderboard — leads / closings / volume / GCI / conversion, ranked.
 *
 * `buildProduction` is PURE (no DB) so it is unit-tested directly;
 * `computeProduction` loads tasks + campaigns + members and delegates to it.
 *
 * Won-detection and the source/status label readers are deliberately shared
 * with marketingRoiService so the two reports can never disagree about what a
 * "won" lead or a "source" is.
 */

const Task = require('../models/Task');
const Campaign = require('../models/Campaign');
const User = require('../models/User');
const { WON_RE } = require('./marketingRoiService');

const round2 = (n) => Math.round(n * 100) / 100;

const readVal = (task, columnId) => {
  if (!task || !task.columnValues || !columnId) return null;
  const cv = task.columnValues;
  const key = columnId.toString();
  return typeof cv.get === 'function' ? cv.get(key) : cv[key];
};

const optionLabel = (col, raw) => {
  const opts = col && col.settings && Array.isArray(col.settings.options) ? col.settings.options : [];
  const match = opts.find((o) => o && (o.id === raw || String(o.id) === String(raw)));
  return match ? match.label || String(raw) : String(raw);
};

const sourceLabelFor = (task, sourceCol) => {
  if (!sourceCol) return null;
  const raw = readVal(task, sourceCol._id);
  if (raw == null || raw === '') return null;
  if (sourceCol.type === 'status' || sourceCol.type === 'dropdown') return optionLabel(sourceCol, raw);
  if (Array.isArray(raw)) return raw.map(String).join(', ');
  return String(raw);
};

const statusLabelFor = (task, statusCol, statusesById) => {
  if (statusCol) {
    const raw = readVal(task, statusCol._id);
    if (raw != null && raw !== '') return optionLabel(statusCol, raw);
  }
  if (task.status != null && statusesById) {
    const s = statusesById.get(task.status.toString());
    if (s) return s.name || '';
  }
  return task.status != null ? String(task.status) : '';
};

/** Coerce a column value to a non-negative number (blank/garbage → 0). */
const numeric = (raw) => {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The agents credited with a lead. Prefers an explicit `person` column (the
 * board's "Agent" column); falls back to Task.assignedTo. Returns an array of
 * id strings — a co-listed deal can legitimately have two agents, and each is
 * credited in full on the leaderboard (matching how brokerages report per-agent
 * production; the org totals are computed from deals, not summed per agent, so
 * co-listings don't inflate them).
 */
const agentIdsFor = (task, agentCol) => {
  const out = [];
  if (agentCol) {
    const raw = readVal(task, agentCol._id);
    if (Array.isArray(raw)) out.push(...raw.map(String).filter(Boolean));
    else if (raw) out.push(String(raw));
  }
  if (out.length === 0 && Array.isArray(task.assignedTo)) {
    out.push(...task.assignedTo.map((a) => String(a && a._id ? a._id : a)).filter(Boolean));
  }
  return out;
};

/**
 * Pure builder.
 *
 * @param {Array}  tasks   in-range leads (lean docs)
 * @param {Object} opts
 *   sourceCol, statusCol, statusesById, agentCol, valueCol, commissionCol,
 *   campaigns, wonStatusId, commissionRate (percent, e.g. 2.5), nameById (Map)
 * @returns {{ totals, agents, sources }}
 */
const buildProduction = (tasks, opts = {}) => {
  const {
    sourceCol = null,
    statusCol = null,
    statusesById = new Map(),
    agentCol = null,
    valueCol = null,
    commissionCol = null,
    campaigns = [],
    wonStatusId = null,
    commissionRate = 0,
    nameById = new Map(),
  } = opts;

  const wonId = wonStatusId ? wonStatusId.toString() : null;
  const defaultRate = Number(commissionRate) || 0;

  const bySource = new Map(); // lowerKey → { source, leads, closings, volume, gci, spend }
  const byAgent = new Map(); // agentId → { agentId, name, leads, closings, volume, gci }

  const ensureSource = (label) => {
    const key = (label || 'Unknown').trim().toLowerCase();
    if (!bySource.has(key)) {
      bySource.set(key, { source: label || 'Unknown', leads: 0, closings: 0, volume: 0, gci: 0, spend: 0 });
    }
    return bySource.get(key);
  };
  const ensureAgent = (id) => {
    const key = String(id);
    if (!byAgent.has(key)) {
      byAgent.set(key, {
        agentId: key,
        name: nameById.get(key) || 'Unassigned',
        leads: 0,
        closings: 0,
        volume: 0,
        gci: 0,
      });
    }
    return byAgent.get(key);
  };

  const totals = { leads: 0, closings: 0, volume: 0, gci: 0, spend: 0 };

  for (const task of tasks) {
    const srcRow = ensureSource(sourceLabelFor(task, sourceCol) || 'Unknown');
    const agents = agentIdsFor(task, agentCol);
    const agentRows = agents.length ? agents.map(ensureAgent) : [ensureAgent('unassigned')];

    srcRow.leads += 1;
    totals.leads += 1;
    agentRows.forEach((a) => {
      a.leads += 1;
    });

    // Won?
    let won;
    if (wonId) {
      const raw = statusCol ? readVal(task, statusCol._id) : task.status;
      won = raw != null && raw.toString() === wonId;
    } else {
      won = WON_RE.test(statusLabelFor(task, statusCol, statusesById));
    }
    if (!won) continue;

    // Money. A per-deal commission % overrides the report-wide rate.
    const value = valueCol ? numeric(readVal(task, valueCol._id)) : 0;
    const perDealRate = commissionCol ? numeric(readVal(task, commissionCol._id)) : 0;
    const rate = perDealRate > 0 ? perDealRate : defaultRate;
    const gci = value > 0 && rate > 0 ? (value * rate) / 100 : 0;

    srcRow.closings += 1;
    srcRow.volume += value;
    srcRow.gci += gci;
    totals.closings += 1;
    totals.volume += value;
    totals.gci += gci;
    agentRows.forEach((a) => {
      a.closings += 1;
      a.volume += value;
      a.gci += gci;
    });
  }

  // Overlay ad spend per source (campaign labels are matched case-insensitively).
  for (const c of campaigns || []) {
    const row = ensureSource(c.source);
    row.spend += Number(c.budget) || 0;
    totals.spend += Number(c.budget) || 0;
  }

  const sources = [...bySource.values()]
    .map((r) => ({
      source: r.source,
      leads: r.leads,
      closings: r.closings,
      volume: round2(r.volume),
      gci: round2(r.gci),
      spend: round2(r.spend),
      profit: round2(r.gci - r.spend),
      // ROI% = (revenue - spend) / spend. Null when nothing was spent — an
      // infinite return is not a number worth printing.
      roi: r.spend > 0 ? round2(((r.gci - r.spend) / r.spend) * 100) : null,
      conversionRate: r.leads > 0 ? round2((r.closings / r.leads) * 100) : 0,
      costPerLead: r.leads > 0 && r.spend > 0 ? round2(r.spend / r.leads) : null,
      revenuePerLead: r.leads > 0 && r.gci > 0 ? round2(r.gci / r.leads) : null,
    }))
    .sort((a, b) => b.gci - a.gci || b.leads - a.leads);

  const agents = [...byAgent.values()]
    .filter((a) => a.leads > 0)
    .map((a) => ({
      agentId: a.agentId,
      name: a.name,
      leads: a.leads,
      closings: a.closings,
      volume: round2(a.volume),
      gci: round2(a.gci),
      conversionRate: a.leads > 0 ? round2((a.closings / a.leads) * 100) : 0,
      avgDeal: a.closings > 0 ? round2(a.volume / a.closings) : 0,
    }))
    .sort((a, b) => b.gci - a.gci || b.closings - a.closings || b.leads - a.leads)
    .map((a, i) => ({ ...a, rank: i + 1 }));

  return {
    totals: {
      leads: totals.leads,
      closings: totals.closings,
      volume: round2(totals.volume),
      gci: round2(totals.gci),
      spend: round2(totals.spend),
      profit: round2(totals.gci - totals.spend),
      roi: totals.spend > 0 ? round2(((totals.gci - totals.spend) / totals.spend) * 100) : null,
      conversionRate: totals.leads > 0 ? round2((totals.closings / totals.leads) * 100) : 0,
      avgDeal: totals.closings > 0 ? round2(totals.volume / totals.closings) : 0,
      avgGci: totals.closings > 0 ? round2(totals.gci / totals.closings) : 0,
    },
    agents,
    sources,
  };
};

/**
 * Load + compute the Production report for a board.
 *
 * Column roles are passed by id from the UI (the board decides which of its
 * columns means "deal value" / "agent" / "source"); each falls back to a
 * sensible auto-detect so the report works on a fresh Real-Estate template
 * without any configuration.
 */
const computeProduction = async ({
  org,
  board,
  sourceColumnId,
  valueColumnId,
  agentColumnId,
  commissionColumnId,
  commissionRate = 0,
  from,
  to,
  wonStatusId,
}) => {
  const cols = Array.isArray(board.columns) ? board.columns : [];
  const byId = (id) => (id ? cols.find((c) => c._id.toString() === String(id)) || null : null);

  const sourceCol = byId(sourceColumnId) || cols.find((c) => c.key === 'source') || null;
  const statusCol =
    cols.find((c) => c.key === 'status' && c.type === 'status') ||
    cols.find((c) => c.type === 'status') ||
    null;
  const agentCol = byId(agentColumnId) || cols.find((c) => c.type === 'person') || null;
  // Deal value: an explicit choice, else the first money-ish number column.
  const valueCol =
    byId(valueColumnId) ||
    cols.find((c) => c.type === 'number' && /price|value|amount|deal|rent|montant|prix/i.test(c.name || c.key || '')) ||
    null;
  const commissionCol = byId(commissionColumnId) || null;

  const statusesById = new Map((board.statuses || []).map((s) => [s._id.toString(), s]));

  const q = { board: board._id, parent: null, isPersonal: { $ne: true } };
  if (from || to) {
    q.createdAt = {};
    if (from) q.createdAt.$gte = from;
    if (to) q.createdAt.$lte = to;
  }
  const tasks = await Task.find(q).select('columnValues status assignedTo createdAt').lean();

  let campaigns = await Campaign.find({
    workspaceId: org._id,
    $or: [{ boardId: board._id }, { boardId: null }],
  }).lean();
  if (from || to) {
    campaigns = campaigns.filter((c) => {
      if (from && c.endDate && c.endDate < from) return false;
      if (to && c.startDate && c.startDate > to) return false;
      return true;
    });
  }

  // Resolve agent display names for the leaderboard.
  const memberIds = Array.isArray(org.members) ? org.members.map((m) => (m && m._id ? m._id : m)) : [];
  const users = memberIds.length ? await User.find({ _id: { $in: memberIds } }).select('name email').lean() : [];
  const nameById = new Map(users.map((u) => [String(u._id), u.name || u.email || 'Agent']));

  const { totals, agents, sources } = buildProduction(tasks, {
    sourceCol,
    statusCol,
    statusesById,
    agentCol,
    valueCol,
    commissionCol,
    campaigns,
    wonStatusId,
    commissionRate,
    nameById,
  });

  return {
    boardId: board._id,
    boardName: board.name,
    commissionRate: Number(commissionRate) || 0,
    columns: {
      source: sourceCol ? { _id: sourceCol._id, name: sourceCol.name } : null,
      value: valueCol ? { _id: valueCol._id, name: valueCol.name } : null,
      agent: agentCol ? { _id: agentCol._id, name: agentCol.name } : null,
      commission: commissionCol ? { _id: commissionCol._id, name: commissionCol.name } : null,
    },
    totals,
    agents,
    sources,
  };
};

module.exports = { buildProduction, computeProduction };
