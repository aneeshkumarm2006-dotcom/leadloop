/**
 * templateInterpolate.js — variable substitution engine (Phase 2, F5.5).
 *
 * Substitutes two families of `{{ … }}` tokens into a template string:
 *   - `{{Column Name}}`      → the triggering task's value for the board column
 *                              whose *name* matches (case-insensitive), rendered
 *                              human-readably (status → option label, date →
 *                              calendar date, person → display names, …).
 *   - `{{user.displayName}}` → a user field (`displayName`/`name`/`email`) from
 *                              the supplied `user` (e.g. the notification
 *                              recipient or the F9 welcome-touch lead).
 *
 * Used now by `NOTIFY_PERSON`; `SEND_EMAIL` / `SEND_SMS` / `SEND_WHATSAPP` wire
 * it into their `execute` to compose the outbound message body (delivery lands
 * in Phase 3). Reused later by F9 welcome touch and F13 form auto-reply.
 *
 * Pure + synchronous — no DB. Callers that want person/tags rendered as names
 * pass a `users` map (`{ [userId]: { name } }`) in the context; otherwise those
 * render as raw ids. Unknown variables fall back to an empty string (override
 * with `options.onMissing`).
 */

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const toIdString = (v) => (v == null ? '' : v.toString());

/**
 * Render an ISO/date value as `Mon D, YYYY` using UTC calendar components so a
 * midnight-UTC date column never slips a day when the host runs in a negative
 * offset (matches the date column's midnight-UTC serialisation).
 */
const renderDate = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

const optionLabel = (col, id) => {
  const opts = col?.settings?.options;
  if (!Array.isArray(opts)) return toIdString(id);
  const match = opts.find((o) => o && toIdString(o.id) === toIdString(id));
  return match ? match.label || toIdString(id) : toIdString(id);
};

const renderUserIds = (ids, users) => {
  const list = Array.isArray(ids) ? ids : [ids];
  return list
    .map((raw) => {
      const id = toIdString(raw);
      if (!id) return '';
      const u = users && (users[id] || users.get?.(id));
      return (u && (u.name || u.displayName)) || id;
    })
    .filter(Boolean)
    .join(', ');
};

/**
 * Render a single column's stored value to a human-readable string given the
 * column definition. Falls back to a JSON-ish string for shapes it doesn't
 * special-case so a template never silently emits `[object Object]`.
 */
const renderColumnValue = (col, value, users) => {
  if (value == null || value === '') return '';
  switch (col.type) {
    case 'status':
      return optionLabel(col, value);
    case 'dropdown':
    case 'tags': {
      const ids = Array.isArray(value) ? value : [value];
      return ids.map((id) => optionLabel(col, id)).filter(Boolean).join(', ');
    }
    case 'date':
      return renderDate(value);
    case 'timeline': {
      const start = value.start ? renderDate(value.start) : '';
      const end = value.end ? renderDate(value.end) : '';
      return start && end ? `${start} – ${end}` : start || end;
    }
    case 'person':
      return renderUserIds(value, users);
    case 'checkbox':
      return value ? 'Yes' : 'No';
    case 'link':
      return typeof value === 'object' ? value.url || '' : String(value);
    case 'location':
      return typeof value === 'object'
        ? value.label || [value.lat, value.lng].filter((n) => n != null).join(', ')
        : String(value);
    case 'number':
    case 'rating':
    case 'text':
    case 'long_text':
    case 'email':
    case 'phone':
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
};

const readColumnValue = (task, columnId) => {
  const cv = task && task.columnValues;
  if (!cv) return undefined;
  const key = toIdString(columnId);
  return typeof cv.get === 'function' ? cv.get(key) : cv[key];
};

/**
 * Resolve a `user.<field>` token. `displayName` aliases the User model's `name`
 * field (there is no separate displayName column).
 */
const resolveUserToken = (path, user) => {
  if (!user) return null;
  const field = path.slice('user.'.length).trim().toLowerCase();
  if (field === 'displayname' || field === 'name') return user.name || user.displayName || '';
  if (field === 'email') return user.email || '';
  if (field === 'firstname') return (user.name || '').split(' ')[0] || '';
  return null;
};

/**
 * Substitute every `{{ … }}` token in `template`.
 *
 * @param {string} template
 * @param {Object} ctx
 * @param {Object} [ctx.task]   - triggering task (reads `columnValues`)
 * @param {Object} [ctx.board]  - board with `columns` (resolves names → values)
 * @param {Object} [ctx.user]   - user for `{{user.*}}` tokens
 * @param {Object} [ctx.users]  - { [userId]: { name } } map for person rendering
 * @param {Object} [options]
 * @param {Function} [options.onMissing] - (token) => string, defaults to '' so
 *   unknown variables disappear rather than leaking `{{…}}` into the output.
 * @returns {string}
 */
const interpolate = (template, ctx = {}, options = {}) => {
  if (typeof template !== 'string' || template.indexOf('{{') === -1) {
    return typeof template === 'string' ? template : '';
  }
  const { task, board, user, users } = ctx;
  const onMissing = typeof options.onMissing === 'function' ? options.onMissing : () => '';

  const columnsByName = new Map();
  if (board && Array.isArray(board.columns)) {
    for (const col of board.columns) {
      if (col && col.name) columnsByName.set(col.name.trim().toLowerCase(), col);
    }
  }

  return template.replace(VARIABLE_PATTERN, (whole, rawToken) => {
    const token = rawToken.trim();

    if (token.toLowerCase().startsWith('user.')) {
      const resolved = resolveUserToken(token, user);
      return resolved == null ? onMissing(token) : resolved;
    }

    const col = columnsByName.get(token.toLowerCase());
    if (col && task) {
      const value = readColumnValue(task, col._id);
      if (value === undefined) return onMissing(token);
      return renderColumnValue(col, value, users);
    }

    return onMissing(token);
  });
};

/**
 * Extract the distinct raw variable tokens present in a template (e.g.
 * `['Lead Name', 'user.displayName']`). Handy for previewing which variables a
 * config string references.
 */
const findVariables = (template) => {
  if (typeof template !== 'string') return [];
  const out = [];
  const seen = new Set();
  let m;
  VARIABLE_PATTERN.lastIndex = 0;
  while ((m = VARIABLE_PATTERN.exec(template)) !== null) {
    const token = m[1].trim();
    if (token && !seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
};

module.exports = {
  interpolate,
  findVariables,
  renderColumnValue,
};
