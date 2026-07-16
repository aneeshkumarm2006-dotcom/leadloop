/**
 * marketingRoiService.js — Phase 2.3 Marketing/ROI aggregation.
 *
 * Attributes a board's leads to a "source" (read from a designated source
 * column), overlays campaign ad-spend (matched by source label,
 * case-insensitive), and computes per-source leads / won / conversion /
 * cost-per-lead / cost-per-acquisition + a totals row.
 *
 * `buildRoiRows` is pure (no DB) so it is unit-tested directly; `computeRoi`
 * loads the tasks + campaigns and delegates to it.
 */

const Task = require('../models/Task');
const Campaign = require('../models/Campaign');

// A lead is "won" when its status label looks like a closed/won deal. Covers
// EN + FR (the app's two locales). Used when no explicit won-status is given.
const WON_RE = /\b(won|sold|closed[\s-]?won|gagn|conclu|vendu)\b/i;

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

/** Resolve a lead's source label from its source column value. */
const sourceLabelFor = (task, sourceCol) => {
  if (!sourceCol) return null;
  const raw = readVal(task, sourceCol._id);
  if (raw == null || raw === '') return null;
  if (sourceCol.type === 'status' || sourceCol.type === 'dropdown') return optionLabel(sourceCol, raw);
  if (Array.isArray(raw)) return raw.map(String).join(', ');
  return String(raw);
};

/** Resolve a lead's status label (flexible status column, else legacy field). */
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

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Pure builder. Given the in-range leads, the resolved source/status columns,
 * and the matching campaigns, returns `{ rows, totals }`.
 *   rows: [{ source, leads, won, conversionRate, spend, costPerLead, costPerWon }]
 */
const buildRoiRows = (tasks, { sourceCol, statusCol, statusesById, campaigns, wonStatusId }) => {
  const acc = new Map(); // lowerKey → { source, leads, won, spend }
  const ensure = (label) => {
    const key = (label || 'Unknown').trim().toLowerCase();
    if (!acc.has(key)) acc.set(key, { source: label || 'Unknown', leads: 0, won: 0, spend: 0 });
    return acc.get(key);
  };

  const wonId = wonStatusId ? wonStatusId.toString() : null;

  for (const task of tasks) {
    const row = ensure(sourceLabelFor(task, sourceCol) || 'Unknown');
    row.leads += 1;
    let won = false;
    if (wonId) {
      const raw = statusCol ? readVal(task, statusCol._id) : task.status;
      won = raw != null && raw.toString() === wonId;
    } else {
      won = WON_RE.test(statusLabelFor(task, statusCol, statusesById));
    }
    if (won) row.won += 1;
  }

  for (const c of campaigns || []) {
    ensure(c.source).spend += Number(c.budget) || 0;
  }

  const rows = [...acc.values()].map((r) => ({
    source: r.source,
    leads: r.leads,
    won: r.won,
    conversionRate: r.leads > 0 ? round2((r.won / r.leads) * 100) : 0,
    spend: round2(r.spend),
    costPerLead: r.leads > 0 && r.spend > 0 ? round2(r.spend / r.leads) : r.spend > 0 ? null : 0,
    costPerWon: r.won > 0 && r.spend > 0 ? round2(r.spend / r.won) : null,
  }));
  rows.sort((a, b) => b.leads - a.leads || b.spend - a.spend);

  const totals = rows.reduce(
    (t, r) => {
      t.leads += r.leads;
      t.won += r.won;
      t.spend += r.spend;
      return t;
    },
    { leads: 0, won: 0, spend: 0 }
  );
  totals.spend = round2(totals.spend);
  totals.conversionRate = totals.leads > 0 ? round2((totals.won / totals.leads) * 100) : 0;
  totals.costPerLead = totals.leads > 0 && totals.spend > 0 ? round2(totals.spend / totals.leads) : null;
  totals.costPerWon = totals.won > 0 && totals.spend > 0 ? round2(totals.spend / totals.won) : null;

  return { rows, totals };
};

/**
 * Load + compute the ROI report for a board.
 * @param {Object} args { org, board, sourceColumnId, from, to, wonStatusId? }
 */
const computeRoi = async ({ org, board, sourceColumnId, from, to, wonStatusId }) => {
  const cols = Array.isArray(board.columns) ? board.columns : [];
  const sourceCol = cols.find((c) => c._id.toString() === String(sourceColumnId)) || null;
  const statusCol =
    cols.find((c) => c.key === 'status' && c.type === 'status') ||
    cols.find((c) => c.type === 'status') ||
    null;
  const statusesById = new Map((board.statuses || []).map((s) => [s._id.toString(), s]));

  const q = { board: board._id, parent: null, isPersonal: { $ne: true } };
  if (from || to) {
    q.createdAt = {};
    if (from) q.createdAt.$gte = from;
    if (to) q.createdAt.$lte = to;
  }
  const tasks = await Task.find(q).select('columnValues status createdAt').lean();

  const campaignQuery = {
    workspaceId: org._id,
    $or: [{ boardId: board._id }, { boardId: null }],
  };
  let campaigns = await Campaign.find(campaignQuery).lean();
  // Keep campaigns overlapping the report window (a campaign with no dates
  // always counts).
  if (from || to) {
    campaigns = campaigns.filter((c) => {
      if (from && c.endDate && c.endDate < from) return false;
      if (to && c.startDate && c.startDate > to) return false;
      return true;
    });
  }

  const { rows, totals } = buildRoiRows(tasks, {
    sourceCol,
    statusCol,
    statusesById,
    campaigns,
    wonStatusId,
  });

  return {
    boardId: board._id,
    sourceColumnId: sourceCol ? sourceCol._id : null,
    sourceColumnName: sourceCol ? sourceCol.name : null,
    rows,
    totals,
    campaignCount: campaigns.length,
  };
};

module.exports = { computeRoi, buildRoiRows, WON_RE };
