/**
 * columnTypes.js — registry of supported column types for the flexible
 * column engine (Phase 1, F1).
 *
 * Each entry exposes:
 *   - validate(value, settings)  : throws on invalid; returns void
 *   - serialize(value)           : pre-write transform (e.g. trim, normalise)
 *   - deserialize(value)         : post-read transform (defaults to identity)
 *   - defaultValue(settings)     : what an empty cell holds
 *   - indexable                  : hint for Mongo index strategy
 *
 * Callers (column CRUD, task PUT, migration) look up the entry by `type` and
 * call the relevant method. Unknown types throw immediately at lookup so a
 * malformed column never lands in the DB.
 *
 * `connect_boards` and `mirror` are registered here as F2 stubs so the
 * registry shape is stable; their `validate` throws `NOT_IMPLEMENTED` until
 * F2 fills them in.
 */

const mongoose = require('mongoose');

const isObjectIdLike = (value) =>
  value && (mongoose.Types.ObjectId.isValid(value) || typeof value?.toString === 'function');

const toIdString = (value) => {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
};

const ValidationError = (message, code = 'INVALID_VALUE') => {
  const err = new Error(message);
  err.code = code;
  return err;
};

const requireString = (value, field = 'value') => {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') {
    throw ValidationError(`${field} must be a string`);
  }
  return value;
};

const optionIdsFromSettings = (settings) => {
  const opts = settings && Array.isArray(settings.options) ? settings.options : [];
  return new Set(
    opts.map((o) => (o && o.id != null ? o.id.toString() : '')).filter(Boolean)
  );
};

const identity = (v) => v;

const baseEntry = (overrides) => ({
  serialize: identity,
  deserialize: identity,
  defaultValue: () => null,
  indexable: false,
  ...overrides,
});

const columnTypes = {
  // ----- Plain text --------------------------------------------------------
  text: baseEntry({
    validate: (value) => {
      if (value == null) return;
      if (typeof value !== 'string') throw ValidationError('text must be a string');
      if (value.length > 500) throw ValidationError('text exceeds 500 characters');
    },
    serialize: (value) => (typeof value === 'string' ? value.trim() : value),
    defaultValue: () => '',
    indexable: true,
  }),

  long_text: baseEntry({
    validate: (value) => {
      if (value == null) return;
      if (typeof value !== 'string') throw ValidationError('long_text must be a string');
      if (value.length > 20000) throw ValidationError('long_text exceeds 20000 characters');
    },
    defaultValue: () => '',
  }),

  // ----- Numbers -----------------------------------------------------------
  number: baseEntry({
    validate: (value, settings) => {
      if (value == null || value === '') return;
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || Number.isNaN(n)) {
        throw ValidationError('number must be a valid number');
      }
      if (settings && typeof settings.min === 'number' && n < settings.min) {
        throw ValidationError(`number must be >= ${settings.min}`);
      }
      if (settings && typeof settings.max === 'number' && n > settings.max) {
        throw ValidationError(`number must be <= ${settings.max}`);
      }
    },
    serialize: (value) => {
      if (value == null || value === '') return null;
      const n = typeof value === 'string' ? Number(value) : value;
      return Number.isNaN(n) ? null : n;
    },
    defaultValue: () => null,
    indexable: true,
  }),

  // ----- Dates -------------------------------------------------------------
  date: baseEntry({
    validate: (value) => {
      if (value == null || value === '') return;
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw ValidationError('date is not a valid date');
    },
    serialize: (value) => {
      if (value == null || value === '') return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    },
    defaultValue: () => null,
    indexable: true,
  }),

  timeline: baseEntry({
    // Value: { start, end } — both ISO date strings.
    validate: (value) => {
      if (value == null) return;
      if (typeof value !== 'object') throw ValidationError('timeline must be an object');
      const { start, end } = value;
      if (start) {
        const d = new Date(start);
        if (Number.isNaN(d.getTime())) throw ValidationError('timeline.start invalid');
      }
      if (end) {
        const d = new Date(end);
        if (Number.isNaN(d.getTime())) throw ValidationError('timeline.end invalid');
      }
      if (start && end && new Date(start).getTime() > new Date(end).getTime()) {
        throw ValidationError('timeline.start must be <= timeline.end');
      }
    },
    serialize: (value) => {
      if (!value || typeof value !== 'object') return null;
      const out = {};
      if (value.start) out.start = new Date(value.start).toISOString();
      if (value.end) out.end = new Date(value.end).toISOString();
      return Object.keys(out).length ? out : null;
    },
    defaultValue: () => null,
  }),

  // ----- People ------------------------------------------------------------
  person: baseEntry({
    // Value: ObjectId[] of User. Empty array allowed.
    validate: (value) => {
      if (value == null) return;
      if (!Array.isArray(value)) throw ValidationError('person must be an array of user ids');
      for (const raw of value) {
        if (!isObjectIdLike(raw) || !mongoose.Types.ObjectId.isValid(toIdString(raw))) {
          throw ValidationError('person contains an invalid user id');
        }
      }
    },
    serialize: (value) => {
      if (!Array.isArray(value)) return [];
      const seen = new Set();
      const out = [];
      for (const raw of value) {
        const id = toIdString(raw);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out;
    },
    defaultValue: () => [],
    indexable: true,
  }),

  // ----- Status / Dropdown -------------------------------------------------
  status: baseEntry({
    // Value: one option id (string). Settings: { options: [{ id, label, color, order }] }
    validate: (value, settings) => {
      if (value == null || value === '') return;
      const ids = optionIdsFromSettings(settings);
      if (!ids.has(value.toString())) {
        throw ValidationError('status value is not one of the configured options');
      }
    },
    serialize: (value) => (value == null || value === '' ? null : value.toString()),
    defaultValue: (settings) => {
      const opts = settings && Array.isArray(settings.options) ? settings.options : [];
      const def = opts.find((o) => o && o.isDefault);
      const pick = def || opts[0];
      return pick && pick.id != null ? pick.id.toString() : null;
    },
    indexable: true,
  }),

  dropdown: baseEntry({
    // Value: option-id[] (multi-select, Monday-style). Accepts a legacy single
    // id string for back-compat and normalises everything to a de-duped array.
    validate: (value, settings) => {
      if (value == null || value === '') return;
      const ids = optionIdsFromSettings(settings);
      const arr = Array.isArray(value) ? value : [value];
      for (const v of arr) {
        if (v == null || v === '') continue;
        if (!ids.has(v.toString())) {
          throw ValidationError('dropdown value is not one of the configured options');
        }
      }
    },
    serialize: (value) => {
      if (value == null || value === '') return [];
      const arr = Array.isArray(value) ? value : [value];
      const seen = new Set();
      const out = [];
      for (const v of arr) {
        if (v == null || v === '') continue;
        const id = v.toString();
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out;
    },
    defaultValue: () => [],
    indexable: true,
  }),

  // ----- Tags --------------------------------------------------------------
  tags: baseEntry({
    // Value: option-id[] referencing settings.options[].id
    validate: (value, settings) => {
      if (value == null) return;
      if (!Array.isArray(value)) throw ValidationError('tags must be an array');
      const ids = optionIdsFromSettings(settings);
      for (const v of value) {
        if (v == null) continue;
        if (!ids.has(v.toString())) {
          throw ValidationError('tags contains an unknown option id');
        }
      }
    },
    serialize: (value) => {
      if (!Array.isArray(value)) return [];
      const seen = new Set();
      const out = [];
      for (const v of value) {
        if (v == null) continue;
        const id = v.toString();
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return out;
    },
    defaultValue: () => [],
    indexable: true,
  }),

  // ----- Booleans ----------------------------------------------------------
  checkbox: baseEntry({
    validate: (value) => {
      if (value == null) return;
      if (typeof value !== 'boolean') throw ValidationError('checkbox must be a boolean');
    },
    serialize: (value) => !!value,
    defaultValue: () => false,
    indexable: true,
  }),

  // ----- Simple structured -------------------------------------------------
  link: baseEntry({
    // Value: { url, label? }
    validate: (value) => {
      if (value == null) return;
      if (typeof value === 'string') return;
      if (typeof value !== 'object') throw ValidationError('link must be an object');
      if (value.url && typeof value.url !== 'string') {
        throw ValidationError('link.url must be a string');
      }
      if (value.label && typeof value.label !== 'string') {
        throw ValidationError('link.label must be a string');
      }
    },
    serialize: (value) => {
      if (value == null) return null;
      if (typeof value === 'string') return { url: value.trim(), label: '' };
      return {
        url: requireString(value.url, 'link.url').trim(),
        label: requireString(value.label, 'link.label').trim(),
      };
    },
    defaultValue: () => null,
  }),

  phone: baseEntry({
    validate: (value) => {
      if (value == null || value === '') return;
      if (typeof value !== 'string') throw ValidationError('phone must be a string');
      // Loose check: allow +, digits, spaces, dashes, parens — most international forms.
      if (!/^[+\d][\d\s()\-.]{2,30}$/.test(value.trim())) {
        throw ValidationError('phone is not a recognisable phone number');
      }
    },
    serialize: (value) => (typeof value === 'string' ? value.trim() : value),
    defaultValue: () => '',
    indexable: true,
  }),

  email: baseEntry({
    validate: (value) => {
      if (value == null || value === '') return;
      if (typeof value !== 'string') throw ValidationError('email must be a string');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
        throw ValidationError('email is not a valid email address');
      }
    },
    serialize: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    defaultValue: () => '',
    indexable: true,
  }),

  location: baseEntry({
    // Value: { lat, lng, label }. Client supplies lat/lng from navigator.geolocation.
    validate: (value) => {
      if (value == null) return;
      if (typeof value !== 'object') throw ValidationError('location must be an object');
      const { lat, lng, label } = value;
      if (lat != null) {
        if (typeof lat !== 'number' || lat < -90 || lat > 90) {
          throw ValidationError('location.lat must be a number between -90 and 90');
        }
      }
      if (lng != null) {
        if (typeof lng !== 'number' || lng < -180 || lng > 180) {
          throw ValidationError('location.lng must be a number between -180 and 180');
        }
      }
      if (label != null && typeof label !== 'string') {
        throw ValidationError('location.label must be a string');
      }
    },
    serialize: (value) => {
      if (!value || typeof value !== 'object') return null;
      const out = {};
      if (typeof value.lat === 'number') out.lat = value.lat;
      if (typeof value.lng === 'number') out.lng = value.lng;
      if (typeof value.label === 'string') out.label = value.label.trim();
      return Object.keys(out).length ? out : null;
    },
    defaultValue: () => null,
  }),

  file: baseEntry({
    // Value: [{ url, name, mime, size }]
    validate: (value) => {
      if (value == null) return;
      if (!Array.isArray(value)) throw ValidationError('file must be an array of attachments');
      for (const f of value) {
        if (!f || typeof f !== 'object') throw ValidationError('file entry must be an object');
        if (f.url != null && typeof f.url !== 'string') throw ValidationError('file.url must be a string');
        if (f.name != null && typeof f.name !== 'string') throw ValidationError('file.name must be a string');
        if (f.mime != null && typeof f.mime !== 'string') throw ValidationError('file.mime must be a string');
        if (f.size != null && typeof f.size !== 'number') throw ValidationError('file.size must be a number');
      }
    },
    serialize: (value) => {
      if (!Array.isArray(value)) return [];
      return value.map((f) => ({
        url: typeof f.url === 'string' ? f.url : '',
        name: typeof f.name === 'string' ? f.name : '',
        mime: typeof f.mime === 'string' ? f.mime : '',
        size: typeof f.size === 'number' ? f.size : 0,
      }));
    },
    defaultValue: () => [],
  }),

  rating: baseEntry({
    // Value: integer 0..max (default max = 5)
    validate: (value, settings) => {
      if (value == null || value === '') return;
      const max = settings && typeof settings.max === 'number' ? settings.max : 5;
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max) {
        throw ValidationError(`rating must be an integer between 0 and ${max}`);
      }
    },
    serialize: (value) => {
      if (value == null || value === '') return 0;
      const n = typeof value === 'string' ? Number(value) : value;
      return Number.isFinite(n) ? Math.round(n) : 0;
    },
    defaultValue: () => 0,
    indexable: true,
  }),

  // ----- Read-only computed ------------------------------------------------
  formula: baseEntry({
    // Read-only. The value is never written directly; it's computed at read
    // time from a narrow expression over sibling number columns.
    validate: () => {
      throw ValidationError(
        'formula is read-only — set the formula in settings.expression instead of writing a value',
        'READ_ONLY'
      );
    },
    serialize: () => null,
    defaultValue: () => null,
  }),

  // ----- Cross-board connectivity (F2) -------------------------------------
  // connect_boards: a multi-pointer to rows on another board.
  //   settings: { targetBoardIds: [ObjectId], allowMultiple: bool,
  //               restrictTo?: { columnId, value } }
  //   value:    { links: [{ boardId, taskId }] }
  //
  // The registry validate is SYNCHRONOUS, so it only checks shape +
  // settings-level invariants (valid ObjectIds, target-board membership,
  // allowMultiple). Deep checks that need the DB — that a `taskId` actually
  // resolves to a row on a target board, and the `restrictTo` filter — run in
  // the link endpoint (controllers/linkController.js), which is async.
  connect_boards: baseEntry({
    validate: (value, settings) => {
      if (value == null) return;
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw ValidationError('connect_boards value must be an object { links: [] }');
      }
      const links = value.links;
      if (links == null) return;
      if (!Array.isArray(links)) {
        throw ValidationError('connect_boards.links must be an array');
      }
      const allowMultiple = !!(settings && settings.allowMultiple);
      if (!allowMultiple && links.length > 1) {
        throw ValidationError('this connect column allows only a single linked row');
      }
      const targetIds =
        settings && Array.isArray(settings.targetBoardIds)
          ? new Set(settings.targetBoardIds.map((id) => toIdString(id)))
          : null;
      for (const link of links) {
        if (!link || typeof link !== 'object') {
          throw ValidationError('each connect_boards link must be an object');
        }
        const boardId = toIdString(link.boardId);
        const taskId = toIdString(link.taskId);
        if (!boardId || !mongoose.Types.ObjectId.isValid(boardId)) {
          throw ValidationError('connect_boards link has an invalid boardId');
        }
        if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
          throw ValidationError('connect_boards link has an invalid taskId');
        }
        if (targetIds && targetIds.size > 0 && !targetIds.has(boardId)) {
          throw ValidationError('connect_boards link points at a board outside targetBoardIds');
        }
      }
    },
    serialize: (value) => {
      if (!value || typeof value !== 'object') return { links: [] };
      const links = Array.isArray(value.links) ? value.links : [];
      const seen = new Set();
      const out = [];
      for (const link of links) {
        if (!link || typeof link !== 'object') continue;
        const boardId = toIdString(link.boardId);
        const taskId = toIdString(link.taskId);
        if (!boardId || !taskId || seen.has(taskId)) continue;
        seen.add(taskId);
        out.push({ boardId, taskId });
      }
      return { links: out };
    },
    defaultValue: () => ({ links: [] }),
  }),

  // mirror: a read-only projection of a column on the rows a sibling
  // connect_boards column points at.
  //   settings: { sourceConnectColumnId, sourceColumnId,
  //               aggregation: 'first'|'concat'|'sum'|'min'|'max'|'count' }
  //   value:    computed at read time (services/mirrorRefresh.js), cached on
  //             Task.columnValues with a freshness marker.
  //
  // Direct writes are rejected (like `formula`). A `null`/empty probe is
  // allowed so column creation — which validates the default value against
  // the new settings — doesn't trip the read-only guard.
  mirror: baseEntry({
    validate: (value) => {
      if (value == null) return;
      throw ValidationError(
        'mirror is read-only — it is computed from the source column, not written directly',
        'READ_ONLY'
      );
    },
    serialize: () => null,
    defaultValue: () => null,
  }),
};

// Valid aggregation modes for a `mirror` column. Shared with mirrorRefresh.js
// and the column-settings validation in columnController.js.
const MIRROR_AGGREGATIONS = ['first', 'concat', 'sum', 'min', 'max', 'count'];

/**
 * Evaluate a formula column's expression over a task's column values.
 *
 * v1 scope (intentionally narrow): a simple numeric expression over sibling
 * column slugs. Supported tokens: numbers, +, -, *, /, parentheses, and
 * `column.<key>` references. Anything else throws.
 *
 * Returns a number, or null if any referenced cell is empty / non-numeric.
 */
const evaluateFormula = (expression, columnValuesByKey) => {
  if (typeof expression !== 'string' || !expression.trim()) return null;
  // Replace `column.<key>` with the numeric value, or `null` if missing.
  const referencePattern = /column\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let usedNull = false;
  const substituted = expression.replace(referencePattern, (_match, key) => {
    const raw = columnValuesByKey ? columnValuesByKey[key] : undefined;
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (raw == null || raw === '' || typeof n !== 'number' || Number.isNaN(n)) {
      usedNull = true;
      return '0';
    }
    return String(n);
  });
  // Whitelist: digits, dots, whitespace, operators, parens.
  if (!/^[\d\s+\-*/().]+$/.test(substituted)) {
    throw ValidationError('formula expression contains unsupported tokens', 'INVALID_FORMULA');
  }
  if (usedNull) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${substituted});`)();
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch (err) {
    throw ValidationError(`formula evaluation failed: ${err.message}`, 'INVALID_FORMULA');
  }
};

/**
 * Look up a registry entry by type name. Returns null on unknown type so
 * callers can decide whether to 400 or fall through.
 */
const getColumnType = (type) =>
  Object.prototype.hasOwnProperty.call(columnTypes, type) ? columnTypes[type] : null;

/**
 * Convenience: validate `value` against the registry. Wraps the
 * registry-thrown error with a stable shape `{ columnId, message }` for
 * controllers to ship straight back to clients.
 */
const validateColumnValue = (column, value) => {
  const entry = column ? getColumnType(column.type) : null;
  if (!entry) {
    return {
      ok: false,
      error: { columnId: column?._id?.toString() || null, message: `Unknown column type: ${column?.type}` },
    };
  }
  try {
    entry.validate(value, column.settings || {});
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: { columnId: column._id?.toString() || null, message: err.message, code: err.code },
    };
  }
};

module.exports = {
  columnTypes,
  getColumnType,
  validateColumnValue,
  evaluateFormula,
  ValidationError,
  MIRROR_AGGREGATIONS,
};
