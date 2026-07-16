/**
 * Mapping of task priority and status values to their background/text colors.
 * Colors are pulled from the CSS custom properties defined in globals.css
 * (see Macan_Design.md Section 2).
 */

export const PRIORITY_COLORS = {
  critical: {
    bg: '#FEF2F2',
    text: '#DC2626',
    solid: '#DC2626',
    label: 'Critical',
  },
  high: {
    bg: '#FFF7ED',
    text: '#EA580C',
    solid: '#EA580C',
    label: 'High',
  },
  medium: {
    bg: '#FFFBEB',
    text: '#D97706',
    solid: '#D97706',
    label: 'Medium',
  },
  low: {
    bg: '#F3F4F6',
    text: '#6B7280',
    solid: '#6B7280',
    label: 'Low',
  },
};

/**
 * Legacy status palette — used for personal tasks (which don't have a board)
 * and as a fallback during the Phase 2 migration period for any board task
 * whose `status` is still the old enum string.
 */
export const STATUS_COLORS = {
  done: {
    bg: 'var(--color-status-done-bg)',
    text: 'var(--color-status-done)',
    solid: '#16A34A',
    label: 'Done',
  },
  working_on_it: {
    bg: 'var(--color-status-working-bg)',
    text: 'var(--color-status-working)',
    solid: '#D97706',
    label: 'Working on it',
  },
  stuck: {
    bg: 'var(--color-status-stuck-bg)',
    text: 'var(--color-status-stuck)',
    solid: '#DC2626',
    label: 'Stuck',
  },
  not_started: {
    bg: 'var(--color-status-notstarted-bg)',
    text: 'var(--color-status-notstarted)',
    solid: '#6B7280',
    label: 'Not Started',
  },
};

export const getPriorityColor = (priority) =>
  PRIORITY_COLORS[priority] || PRIORITY_COLORS.low;

export const getStatusColor = (status) =>
  STATUS_COLORS[status] || STATUS_COLORS.not_started;

/**
 * Parse a `#RRGGBB` (or `#RGB`) hex string into `{ r, g, b }` (0-255).
 */
const parseHex = (hex) => {
  if (typeof hex !== 'string') return null;
  let value = hex.trim().replace(/^#/, '');
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const toHex = ({ r, g, b }) =>
  '#' +
  [r, g, b]
    .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
    .join('');

const lighten = ({ r, g, b }, amount) => ({
  r: r + (255 - r) * amount,
  g: g + (255 - g) * amount,
  b: b + (255 - b) * amount,
});

const darken = ({ r, g, b }, amount) => ({
  r: r * (1 - amount),
  g: g * (1 - amount),
  b: b * (1 - amount),
});

/**
 * Given a user-defined hex color, return a `{ bg, text, solid }` triple
 * suitable for rendering a chip background + readable foreground text.
 *
 * - `bg`    = 90% lightened toward white (pastel surface for the chip)
 * - `text`  = 20% darkened toward black  (high-contrast label color)
 * - `solid` = the original hex
 */
export const getColorPair = (hex) => {
  const rgb = parseHex(hex);
  if (!rgb) {
    return {
      bg: PRIORITY_COLORS.low.bg,
      text: PRIORITY_COLORS.low.text,
      solid: PRIORITY_COLORS.low.solid,
    };
  }
  return {
    bg: toHex(lighten(rgb, 0.9)),
    text: toHex(darken(rgb, 0.2)),
    solid: toHex(rgb),
  };
};

/**
 * Lightweight alias used by call sites that only need `{ bg, text }`.
 */
export const hexToPair = (hex) => {
  const { bg, text } = getColorPair(hex);
  return { bg, text };
};

const findById = (collection, id) => {
  if (!Array.isArray(collection) || id == null) return null;
  const target = id.toString();
  return collection.find((c) => c && c._id && c._id.toString() === target) || null;
};

/**
 * Resolve `{ bg, text, label, solid }` for a board status reference.
 *
 * `statusRef` may be:
 *   - an ObjectId / ObjectId-string referencing `board.statuses._id`
 *   - a legacy enum key string (`'done'`, etc.) — falls back to STATUS_COLORS
 *
 * Returns the legacy `not_started` palette if nothing matches, so callers
 * never have to null-check.
 */
export const getStatusPalette = (board, statusRef) => {
  if (board && Array.isArray(board.statuses)) {
    const match = findById(board.statuses, statusRef);
    if (match) {
      const pair = getColorPair(match.color);
      return { bg: pair.bg, text: pair.text, solid: pair.solid, label: match.name };
    }
  }
  // Fallback to the legacy enum palette.
  if (typeof statusRef === 'string' && STATUS_COLORS[statusRef]) {
    const entry = STATUS_COLORS[statusRef];
    return { bg: entry.bg, text: entry.text, solid: entry.solid, label: entry.label };
  }
  const fallback = STATUS_COLORS.not_started;
  return {
    bg: fallback.bg,
    text: fallback.text,
    solid: fallback.solid,
    label: fallback.label,
  };
};

/**
 * Resolve `{ bg, text, label, solid }` for a board label reference.
 */
export const getLabelPalette = (board, labelRef) => {
  const match = findById(board?.labels, labelRef);
  if (!match) {
    return {
      bg: PRIORITY_COLORS.low.bg,
      text: PRIORITY_COLORS.low.text,
      solid: PRIORITY_COLORS.low.solid,
      label: '',
    };
  }
  const pair = getColorPair(match.color);
  return { bg: pair.bg, text: pair.text, solid: pair.solid, label: match.name };
};

export default PRIORITY_COLORS;
