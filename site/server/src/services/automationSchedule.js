const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly'];
const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const getTzParts = (date, timeZone) => {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
  };
};

const getTzWeekday = (date, timeZone) => {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
  const str = fmt.format(date);
  return WEEKDAY_INDEX[str] ?? 0;
};

const isValidTimezone = (tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// Convert wall-clock time in a target tz to a UTC instant. We first guess the
// instant by treating the components as UTC, then measure how that guess
// renders in the target tz to derive the offset, and shift by it.
const localToUtcMs = (year, month, day, hour, minute, second, timeZone) => {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const guessParts = getTzParts(new Date(guess), timeZone);
  const localAsUtc = Date.UTC(
    guessParts.year,
    guessParts.month - 1,
    guessParts.day,
    guessParts.hour,
    guessParts.minute,
    guessParts.second
  );
  const offset = localAsUtc - guess;
  return guess - offset;
};

/**
 * Validate a schedule object. Returns { valid, error? }.
 */
const validateSchedule = (schedule) => {
  if (!schedule || typeof schedule !== 'object') {
    return { valid: false, error: 'Schedule is required' };
  }
  if (!VALID_FREQUENCIES.includes(schedule.frequency)) {
    return { valid: false, error: 'Invalid frequency' };
  }
  if (schedule.hour !== undefined && schedule.hour !== null) {
    const h = Number(schedule.hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      return { valid: false, error: 'Hour must be between 0 and 23' };
    }
  }
  if (schedule.timezone && !isValidTimezone(schedule.timezone)) {
    return { valid: false, error: 'Invalid timezone' };
  }
  if (schedule.frequency === 'weekly') {
    const days = schedule.daysOfWeek;
    if (!Array.isArray(days) || days.length === 0) {
      return { valid: false, error: 'Weekly schedule requires daysOfWeek' };
    }
    for (const d of days) {
      if (!Number.isInteger(d) || d < 0 || d > 6) {
        return { valid: false, error: 'daysOfWeek values must be 0–6' };
      }
    }
  }
  if (schedule.frequency === 'monthly') {
    if (schedule.useLastDayOfMonth === true) {
      // Valid — last day sentinel takes precedence over dayOfMonth.
    } else {
      const d = schedule.dayOfMonth;
      if (!Number.isInteger(d) || d < 1 || d > 28) {
        return {
          valid: false,
          error:
            'Monthly schedule requires dayOfMonth 1–28, or use the "Last day of the month" option',
        };
      }
    }
  }
  return { valid: true };
};

const getLastDayOfMonth = (year, monthOneBased) => {
  // monthOneBased is 1–12. new Date(Date.UTC(y, m, 0)) gives the last day of
  // month m-1 (i.e. month m here, since m is 1-based for our callers).
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
};

/**
 * Compute the next Date strictly after `fromDate` matching the schedule.
 * Walks forward day-by-day in the schedule's timezone.
 */
const computeNextRunAt = (schedule, fromDate = new Date()) => {
  const v = validateSchedule(schedule);
  if (!v.valid) return null;

  const tz = schedule.timezone || 'UTC';
  const hour = Number.isInteger(schedule.hour) ? schedule.hour : 9;
  const fromMs = fromDate.getTime();

  const startParts = getTzParts(fromDate, tz);
  let y = startParts.year;
  let m = startParts.month;
  let d = startParts.day;

  for (let i = 0; i < 366; i++) {
    const candidateMs = localToUtcMs(y, m, d, hour, 0, 0, tz);
    const candidate = new Date(candidateMs);
    const candParts = getTzParts(candidate, tz);

    let matches = false;
    if (schedule.frequency === 'daily') {
      matches = true;
    } else if (schedule.frequency === 'weekly') {
      const days = schedule.daysOfWeek || [];
      if (days.length > 0) {
        const wd = getTzWeekday(candidate, tz);
        matches = days.includes(wd);
      }
    } else if (schedule.frequency === 'monthly') {
      if (schedule.useLastDayOfMonth === true) {
        const lastDay = getLastDayOfMonth(candParts.year, candParts.month);
        matches = candParts.day === lastDay;
      } else {
        matches = candParts.day === schedule.dayOfMonth;
      }
    }

    if (matches && candidateMs > fromMs) {
      return candidate;
    }

    // Step forward one calendar day in the local timezone. We use a UTC midnight
    // anchor so DST transitions don't cause us to repeat or skip a day.
    const nextAnchor = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
    y = nextAnchor.getUTCFullYear();
    m = nextAnchor.getUTCMonth() + 1;
    d = nextAnchor.getUTCDate();
  }

  return null;
};

module.exports = {
  computeNextRunAt,
  validateSchedule,
  isValidTimezone,
  // Timezone primitives shared with dateAutomationRunner.js (F4.5) so the
  // wall-clock → UTC conversion lives in exactly one place.
  getTzParts,
  localToUtcMs,
};
