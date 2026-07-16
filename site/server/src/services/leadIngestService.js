/**
 * leadIngestService.js — API lead ingestion → task (Phase 4b, F14.3).
 *
 * The service behind the public `POST /api/leads/ingest`. It is the F14 sibling
 * of the F7 webhook resolver and the F13 form submission service, and shares
 * their spine: resolve → map onto columns → `createTaskWithColumnValues` →
 * audit row → fan out `item.created` / `lead.intake` so automations + the F9
 * intake policy wake up.
 *
 * What's different is onboarding. There is no pre-authored mapping: the FIRST
 * submission to a connection self-defines the board's columns. On that call we
 *   1. infer a column per payload key ([schemaInference.js](../utils/schemaInference.js)),
 *   2. provision the missing columns on the board (reusing any that already
 *      match by slug/name, never adding a second primary),
 *   3. persist the resolved `fieldMap` on the connection and flip
 *      `schemaLocked` (which means "initial provisioning done", not "frozen").
 *
 * The schema then EVOLVES: any later submission carrying a field the fieldMap
 * doesn't know runs the same infer→provision path for just those keys, so a
 * changed website form never silently drops data. Admins can freeze this per
 * connection (`evolveSchema: false`), restoring the old warn-only behaviour
 * for unknown keys.
 *
 * ─── Concurrency (v1) ──────────────────────────────────────────────────────
 * Within one process, submissions to the same connection are serialized by a
 * per-connection promise chain (`withConnectionLock`), so simultaneous calls
 * can't interleave their board/connection saves. Across instances there is no
 * distributed lock (last write wins) — accepted for v1: a website form is
 * low-QPS. If a race ever leaves the schema locked with an empty `fieldMap`,
 * the next call re-provisions (the guard below treats empty-fieldMap as "not
 * yet defined"), so it self-heals.
 */

const Board = require('../models/Board');
const LeadConnection = require('../models/LeadConnection');
const LeadIngestLog = require('../models/LeadIngestLog');
const eventBus = require('./eventBus');
const { createTaskWithColumnValues } = require('./taskCreation');
const {
  inferSchema,
  normalizeKey,
  IGNORED_KEYS,
  MAX_FIELDS,
} = require('../utils/schemaInference');

const asId = (v) => (v == null ? '' : v.toString());

// --- Per-connection in-process lock -----------------------------------------
// Serializes submissions to the same connection within this process so two
// simultaneous calls can't both mutate + save the board/connection docs with
// stale in-memory state (see the Concurrency note in the header).
const connectionLocks = new Map();

const withConnectionLock = (connectionId, fn) => {
  const key = asId(connectionId);
  const tail = connectionLocks.get(key) || Promise.resolve();
  const run = tail.then(fn, fn); // run regardless of the previous call's outcome
  const settled = run.catch(() => {});
  connectionLocks.set(key, settled);
  settled.then(() => {
    // Drop the map entry once nothing newer is queued behind us.
    if (connectionLocks.get(key) === settled) connectionLocks.delete(key);
  });
  return run;
};

class LeadIngestError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

// --- Local slug helpers (mirror columnController's, kept local to avoid ---
// --- coupling the public ingest path to the admin controller) -------------
const slugify = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'column';

const uniqueSlug = (board, baseName) => {
  const existing = new Set((board.columns || []).map((c) => c.key));
  const base = slugify(baseName);
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
};

const nextOrder = (board) => {
  const cols = board.columns || [];
  return cols.length === 0 ? 0 : Math.max(...cols.map((c) => c.order || 0)) + 1;
};

/**
 * Light pre-coercion so common wire shapes survive the column validator:
 *   - checkbox: accept "true"/"on"/"1"/"yes" (HTML forms don't send JSON bools);
 *   - long_text: JSON-stringify nested objects/arrays so nothing is dropped.
 * Everything else passes through to the columnTypes serializer untouched.
 */
const coerceForColumn = (col, value) => {
  if (col.type === 'checkbox') {
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    return s === 'true' || s === 'on' || s === '1' || s === 'yes';
  }
  if (col.type === 'long_text' && value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
};

/**
 * Provision board columns from an inferred schema. Reuses an existing column
 * when one matches by slug or by case-insensitive name, so re-pointing a key at
 * a board that already has columns doesn't duplicate them. Only creates a
 * primary column when the board had none (never adds a second — the board's
 * pre-save invariant enforces exactly one).
 *
 * Mutates + saves `board`. Returns `{ fieldMap }` binding each source key to a
 * column slug.
 */
const provisionColumnsFromSchema = async (board, inferred, connection) => {
  if (!board.useFlexibleColumns) board.useFlexibleColumns = true;
  const boardHadColumns = (board.columns || []).length > 0;
  const byName = new Map((board.columns || []).map((c) => [String(c.name).toLowerCase(), c]));
  let order = nextOrder(board);
  const fieldMap = [];

  for (const field of inferred.fields) {
    const label = field.label || field.sourceKey;
    const candidateSlug = slugify(label);
    // Reuse a matching existing column (by slug, then by name) rather than dup.
    let col =
      (board.columns || []).find((c) => c.key === candidateSlug) ||
      byName.get(String(label).toLowerCase()) ||
      null;

    if (!col) {
      const isPrimary =
        !boardHadColumns &&
        field.sourceKey === inferred.primaryKey &&
        !(board.columns || []).some((c) => c.isPrimary);
      col = {
        key: uniqueSlug(board, label),
        name: label,
        type: field.type,
        settings: {},
        order: order++,
        isPrimary,
      };
      board.columns.push(col);
      byName.set(String(col.name).toLowerCase(), col);
    }
    fieldMap.push({
      sourceKey: field.sourceKey,
      columnKey: col.key,
      label,
      type: col.type,
    });
  }

  // Marketing attribution: a `Source` column so these leads are traceable. Only
  // added when the connection opts in and the board doesn't already have one.
  if (
    connection.attributeSource &&
    !(board.columns || []).some((c) => c.key === 'source' || String(c.name).toLowerCase() === 'source')
  ) {
    board.columns.push({
      key: uniqueSlug(board, 'Source'),
      name: 'Source',
      type: 'text',
      settings: {},
      order: order++,
      isPrimary: false,
    });
  }

  // Defence in depth: guarantee exactly one primary before the pre-save hook runs.
  if (!(board.columns || []).some((c) => c.isPrimary) && (board.columns || []).length > 0) {
    board.columns[0].isPrimary = true;
  }

  await board.save();
  return { fieldMap };
};

/**
 * Pure helper: pick the payload keys the fieldMap doesn't know yet, applying
 * the same skip rules as first-call inference (`_`-prefix, IGNORED_KEYS) and
 * the CUMULATIVE per-connection field cap (a connection can never exceed
 * MAX_FIELDS mapped fields across its lifetime). Keys refused by the cap get a
 * visible `field_cap_reached` warning — never a silent drop.
 *
 * @returns {{ unseen: Object, warnings: Array<{reason, key}> }}
 */
const pickUnseenFields = (fieldMap, payload) => {
  const known = new Set((fieldMap || []).map((f) => f.sourceKey));
  const unseen = {};
  const warnings = [];
  let room = MAX_FIELDS - (fieldMap || []).length;
  for (const k of Object.keys(payload || {})) {
    if (known.has(k)) continue;
    const nkey = normalizeKey(k);
    if (!nkey || k.startsWith('_') || IGNORED_KEYS.has(nkey)) continue;
    if (room <= 0) {
      warnings.push({ reason: 'field_cap_reached', key: k });
      continue;
    }
    unseen[k] = payload[k];
    room -= 1;
  }
  return { unseen, warnings };
};

/** Best-effort audit row — a failed write must never fail the submission. */
const writeLog = async (connection, board, entry) => {
  try {
    await LeadIngestLog.create({
      connectionId: connection._id,
      boardId: board ? board._id : connection.boardId,
      taskId: entry.taskId || null,
      status: entry.status,
      payload: entry.payload || {},
      warnings: entry.warnings || [],
      error: entry.error || '',
      ip: entry.ip || '',
      userAgent: entry.userAgent || '',
    });
  } catch (err) {
    console.error('[lead/ingest] failed to write ingest log:', err?.message || err);
  }
};

/**
 * Ingest one API lead submission.
 *
 * @param {string} apiKey   the plaintext key from `X-API-Key` / Bearer
 * @param {Object} rawBody  parsed JSON body `{ [sourceKey]: value }`
 * @param {Object} [meta]   `{ ip, userAgent }`
 * @returns {Promise<{ status, taskId, boardId, created, schema, newColumns, warnings }>}
 * @throws {LeadIngestError} 401 missing/invalid key; 403 disabled; 422 board
 *         gone; 400 empty/uninferable body.
 */
const ingestLead = async (apiKey, rawBody, meta = {}) => {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new LeadIngestError(401, 'Missing API key');
  }
  const resolved = await LeadConnection.findOne({ tokenHash: LeadConnection.hashKey(apiKey.trim()) });
  if (!resolved) throw new LeadIngestError(401, 'Invalid API key');
  if (!resolved.enabled) throw new LeadIngestError(403, 'This API key is disabled');

  // Everything that reads-then-writes the connection/board runs under the
  // per-connection lock on FRESH docs, so a concurrent submission's saves are
  // visible to this one (the auth lookup above stays outside — it's read-only).
  return withConnectionLock(resolved._id, () => ingestLocked(resolved._id, rawBody, meta));
};

/** The lock-protected body of `ingestLead` — see above. */
const ingestLocked = async (connectionId, rawBody, meta = {}) => {
  const connection = await LeadConnection.findById(connectionId);
  if (!connection) throw new LeadIngestError(401, 'Invalid API key');
  if (!connection.enabled) throw new LeadIngestError(403, 'This API key is disabled');

  const board = await Board.findById(connection.boardId).select(
    'statuses columns useFlexibleColumns organisation createdBy name'
  );
  if (!board) throw new LeadIngestError(422, 'This key is no longer connected to a board');

  const payload =
    rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? rawBody : null;
  if (!payload || Object.keys(payload).length === 0) {
    await writeLog(connection, board, { status: 'rejected', payload: rawBody, error: 'empty_payload', ...meta });
    throw new LeadIngestError(400, 'Request body must be a non-empty JSON object');
  }

  const warnings = [];
  let provisioned = false;
  let newColumns = [];

  // FIRST call (or a self-heal after a half-locked schema): define the table.
  const needsSchema = !connection.schemaLocked || (connection.fieldMap || []).length === 0;
  if (needsSchema) {
    const inferred = inferSchema(payload);
    if (inferred.fields.length === 0) {
      await writeLog(connection, board, { status: 'rejected', payload, error: 'no_inferable_fields', ...meta });
      throw new LeadIngestError(400, 'Could not infer any fields from the submission body');
    }
    const { fieldMap } = await provisionColumnsFromSchema(board, inferred, connection);
    connection.fieldMap = fieldMap;
    connection.schemaLocked = true;
    provisioned = true;
    newColumns = fieldMap.map((f) => ({ sourceKey: f.sourceKey, columnKey: f.columnKey, label: f.label, type: f.type }));
    inferred.skipped.forEach((k) => warnings.push({ reason: 'skipped_key', key: k }));
  } else if (connection.evolveSchema !== false) {
    // LATER calls: the schema EVOLVES — any unseen field runs the same
    // infer→provision path, so a changed website form never drops data.
    const { unseen, warnings: capWarnings } = pickUnseenFields(connection.fieldMap, payload);
    warnings.push(...capWarnings);
    if (Object.keys(unseen).length > 0) {
      const inferred = inferSchema(unseen);
      if (inferred.fields.length > 0) {
        const { fieldMap } = await provisionColumnsFromSchema(board, inferred, connection);
        connection.fieldMap.push(...fieldMap);
        newColumns = fieldMap.map((f) => ({ sourceKey: f.sourceKey, columnKey: f.columnKey, label: f.label, type: f.type }));
      }
    }
  }

  // Map known keys onto their columns (board.columns is fresh — provisioning
  // above mutated the same in-memory doc).
  const columnsByKey = new Map((board.columns || []).map((c) => [c.key, c]));
  const columnValues = {};
  for (const f of connection.fieldMap) {
    if (!Object.prototype.hasOwnProperty.call(payload, f.sourceKey)) continue;
    const col = columnsByKey.get(f.columnKey);
    if (!col) {
      warnings.push({ reason: 'missing_column', columnKey: f.columnKey });
      continue;
    }
    const raw = payload[f.sourceKey];
    if (raw == null || raw === '') continue;
    columnValues[asId(col._id)] = coerceForColumn(col, raw);
  }

  // Frozen schema (`evolveSchema: false`): surface keys the fieldMap doesn't
  // know — visible, never silent. With evolution on, unseen keys became
  // columns above, so there is nothing left to warn about.
  if (connection.evolveSchema === false) {
    const frozenKnown = new Set(connection.fieldMap.map((f) => f.sourceKey));
    for (const k of Object.keys(payload)) {
      const nkey = normalizeKey(k);
      if (!frozenKnown.has(k) && nkey && !k.startsWith('_') && !IGNORED_KEYS.has(nkey)) {
        warnings.push({ reason: 'unmapped_key', key: k });
      }
    }
  }

  // Stamp the lead source for attribution (unless a mapped field already set it).
  if (connection.attributeSource) {
    const srcCol = columnsByKey.get('source');
    const tag = connection.sourceTag || connection.name;
    if (srcCol && columnValues[asId(srcCol._id)] === undefined && tag) {
      columnValues[asId(srcCol._id)] = tag;
    }
  }

  const { task, warnings: colWarnings } = await createTaskWithColumnValues({
    board,
    columnValues,
    createdBy: connection.createdBy || board.createdBy,
  });
  if (Array.isArray(colWarnings)) warnings.push(...colWarnings);

  // Persist the schema (provisioned or evolved) + rolling stats.
  connection.submissionCount = (connection.submissionCount || 0) + 1;
  connection.lastSubmissionAt = new Date();
  await connection.save();

  // Fan out domain events (parity with the form / webhook resolver). The lead is
  // a real external submission, so ITEM_CREATED automations run normally;
  // `lead.intake` drives F9; `lead.ingested` is the F14-specific analog of
  // `webhook.received` / `form.submitted`.
  const eventPayload = {
    taskId: task._id,
    boardId: board._id,
    connectionId: connection._id,
    payload,
  };
  eventBus.emit('item.created', {
    taskId: task._id,
    boardId: board._id,
    groupId: task.group,
    statusId: task.status,
    createdByUserId: asId(connection.createdBy || board.createdBy),
  });
  eventBus.emit('lead.intake', eventPayload);
  eventBus.emit('lead.ingested', eventPayload);

  // provisioned = first call defined the whole table; evolved = a later call
  // added columns for new fields; created = plain submission, schema unchanged.
  const status = provisioned ? 'provisioned' : newColumns.length > 0 ? 'evolved' : 'created';

  await writeLog(connection, board, {
    status,
    taskId: task._id,
    payload,
    warnings,
    ...meta,
  });

  return {
    status,
    taskId: task._id,
    boardId: board._id,
    created: provisioned,
    schema: connection.fieldMap.map((f) => ({ key: f.sourceKey, label: f.label, type: f.type })),
    newColumns,
    warnings,
  };
};

module.exports = {
  ingestLead,
  provisionColumnsFromSchema,
  coerceForColumn,
  LeadIngestError,
  // Exported for unit tests.
  pickUnseenFields,
  withConnectionLock,
};
