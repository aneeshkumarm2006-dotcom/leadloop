/**
 * importController.js — CSV import.
 *
 *   POST /api/boards/:id/import/preview  (admin) parse + suggest a mapping
 *   POST /api/boards/:id/import          (admin) create the leads
 *
 * Two steps on purpose: nobody should discover what an import did AFTER it
 * wrote 5,000 rows. Preview shows the mapping, a sample, and how many rows
 * already exist; the second call executes exactly what was shown.
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const Task = require('../models/Task');
const TaskGroup = require('../models/TaskGroup');
const Organisation = require('../models/Organisation');
const { parseCsvToObjects } = require('../utils/csvParse');
const { suggestMapping, buildLead, splitExisting } = require('../services/importService');
const { createTaskWithColumnValues } = require('../services/taskCreation');
const { normalizeEmail, normalizePhone } = require('../services/dedupeService');

const MAX_ROWS = 20000;

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const loadBoardAdmin = async (boardId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(boardId)) return { status: 400, error: 'Invalid board id' };
  const board = await Board.findById(boardId);
  if (!board) return { status: 404, error: 'Board not found' };
  const org = await Organisation.findById(board.organisation);
  if (!org) return { status: 404, error: 'Workspace not found' };
  if (!org.members.some((m) => m.toString() === userId)) {
    return { status: 403, error: 'Not a member of this workspace' };
  }
  if (!isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { board, org };
};

/** Index the board's existing leads by normalised email + phone. */
const existingIndex = async (board) => {
  const cols = (board.columns || []).filter((c) => !c.isPrimary);
  const emailCol = cols.find((c) => c.type === 'email');
  const phoneCol = cols.find((c) => c.type === 'phone');
  const emails = new Set();
  const phones = new Set();
  if (!emailCol && !phoneCol) return { emails, phones };

  const tasks = await Task.find({ board: board._id, parent: null }).select('columnValues').lean();
  for (const t of tasks) {
    const cv = t.columnValues || {};
    if (emailCol) {
      const e = normalizeEmail(cv[String(emailCol._id)]);
      if (e) emails.add(e);
    }
    if (phoneCol) {
      const p = normalizePhone(cv[String(phoneCol._id)]);
      if (p) phones.add(p);
    }
  }
  return { emails, phones };
};

/** POST /api/boards/:id/import/preview — body: { csv } */
const previewImport = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const csv = String(req.body?.csv || '');
    if (!csv.trim()) return res.status(400).json({ error: 'The file appears to be empty' });

    const { headers, rows } = parseCsvToObjects(csv, { maxRows: MAX_ROWS + 1 });
    if (!headers.length) return res.status(400).json({ error: 'No columns found — is this a CSV file?' });
    if (!rows.length) return res.status(400).json({ error: 'No rows found below the header' });

    const mapping = suggestMapping(headers, ctx.board.columns || []);
    const leads = rows.map((r) => buildLead(r, mapping));
    const { fresh, duplicates } = splitExisting(leads, await existingIndex(ctx.board));

    const groups = await TaskGroup.find({ board: ctx.board._id }).sort({ order: 1 }).select('name').lean();

    return res.json({
      headers,
      mapping,
      totalRows: rows.length,
      newCount: fresh.length,
      duplicateCount: duplicates.length,
      truncated: rows.length > MAX_ROWS,
      sample: rows.slice(0, 5),
      columns: (ctx.board.columns || []).map((c) => ({
        _id: String(c._id),
        name: c.name,
        type: c.type,
        isPrimary: !!c.isPrimary,
      })),
      groups: groups.map((g) => ({ _id: g._id, name: g.name })),
    });
  } catch (err) {
    console.error('previewImport error:', err);
    return res.status(500).json({ error: 'Could not read that file' });
  }
};

/** POST /api/boards/:id/import — body: { csv, mapping, groupId, skipExisting } */
const runImport = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const csv = String(req.body?.csv || '');
    const mapping = Array.isArray(req.body?.mapping) ? req.body.mapping : null;
    if (!csv.trim() || !mapping) return res.status(400).json({ error: 'Nothing to import' });

    const { rows } = parseCsvToObjects(csv, { maxRows: MAX_ROWS });
    const leads = rows.map((r) => buildLead(r, mapping));
    const { fresh, duplicates } = splitExisting(leads, await existingIndex(ctx.board));
    const toCreate = req.body?.skipExisting === false ? leads : fresh;

    // Landing group: explicit, else the board's first stage.
    let groupId = req.body?.groupId || null;
    if (groupId && !mongoose.Types.ObjectId.isValid(groupId)) groupId = null;
    if (groupId) {
      const owned = await TaskGroup.findOne({ _id: groupId, board: ctx.board._id }).select('_id');
      if (!owned) groupId = null;
    }

    let created = 0;
    const failures = [];
    for (const lead of toCreate) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await createTaskWithColumnValues({
          board: ctx.board,
          groupId: groupId || undefined,
          columnValues: lead.columnValues,
          name: lead.name,
          createdBy: req.user.userId,
        });
        created += 1;
      } catch (err) {
        // One bad row must not abort an import of thousands.
        failures.push({ name: lead.name, error: err.message });
      }
    }

    return res.json({
      created,
      skipped: duplicates.length,
      failed: failures.length,
      failures: failures.slice(0, 20),
    });
  } catch (err) {
    console.error('runImport error:', err);
    return res.status(500).json({ error: 'Import failed' });
  }
};

module.exports = { previewImport, runImport };
