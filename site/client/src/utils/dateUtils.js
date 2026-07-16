/**
 * Small date/time helpers used across Macan. Kept dependency-free so callers
 * can import them from anywhere without pulling in moment/date-fns.
 */

const MS_IN_MINUTE = 60 * 1000;
const MS_IN_HOUR = 60 * MS_IN_MINUTE;
const MS_IN_DAY = 24 * MS_IN_HOUR;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const toDate = (input) => {
  if (!input) return null;
  if (input instanceof Date) return input;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Format a date as "Apr 10, 2026". Returns empty string if invalid/nullish.
 */
export const formatDate = (input) => {
  const d = toDate(input);
  if (!d) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

/**
 * Format a date as "Apr 10". Useful for table cells where the year is implied.
 */
export const formatShortDate = (input) => {
  const d = toDate(input);
  if (!d) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

/**
 * Human-readable relative time: "just now", "5m ago", "2h ago", "3d ago",
 * otherwise the full formatted date.
 */
export const timeAgo = (input) => {
  const d = toDate(input);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return formatDate(d);
  if (diff < MS_IN_MINUTE) return 'just now';
  if (diff < MS_IN_HOUR) return `${Math.floor(diff / MS_IN_MINUTE)}m ago`;
  if (diff < MS_IN_DAY) return `${Math.floor(diff / MS_IN_HOUR)}h ago`;
  if (diff < 7 * MS_IN_DAY) return `${Math.floor(diff / MS_IN_DAY)}d ago`;
  return formatDate(d);
};

/**
 * Has this due date already passed (day-level comparison)?
 */
export const isOverdue = (input) => {
  const d = toDate(input);
  if (!d) return false;
  const now = new Date();
  const dueDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dueDay.getTime() < today.getTime();
};

/**
 * Is the due date within the next 24 hours (but not past)?
 */
export const isDueSoon = (input) => {
  const d = toDate(input);
  if (!d) return false;
  const diff = d.getTime() - Date.now();
  return diff >= 0 && diff <= MS_IN_DAY;
};

export default {
  formatDate,
  formatShortDate,
  timeAgo,
  isOverdue,
  isDueSoon,
};
