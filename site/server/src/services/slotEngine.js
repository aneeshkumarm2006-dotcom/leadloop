/**
 * slotEngine.js — Phase 4b open-slot computation for the Visit Booking system.
 *
 * Given a booking link's manual availability (weekly hours + date overrides),
 * duration/buffers/limits, and the already-booked slots, returns the open time
 * slots grouped by calendar day (in the link's timezone) over the bookable
 * window [now, now + dateRangeDays].
 *
 * Availability hours are wall-clock times in the link's IANA timezone; slots are
 * returned as absolute UTC instants (ISO). Wall-clock → UTC conversion (DST-safe)
 * reuses `localToUtcMs` from automationSchedule so the conversion lives in one
 * place.
 *
 * Pure (no DB) → unit-tested directly. The controller loads the bookings and
 * passes them in.
 */

const { localToUtcMs, getTzParts } = require('./automationSchedule');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const pad = (n) => String(n).padStart(2, '0');

// "HH:MM" → minutes from midnight (or null).
const toMinutes = (hhmm) => {
  if (typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

const toMs = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/**
 * @param {Object} cfg
 *   weeklyHours    [{ dayOfWeek:0-6, start:"HH:MM", end:"HH:MM" }]
 *   dateOverrides  [{ date:"YYYY-MM-DD", unavailable?:bool, windows?:[{start,end}] }]
 *   durationMinutes, slotInterval (0 → duration), bufferBefore, bufferAfter (min)
 *   minNoticeHours, dateRangeDays, dailyCap (0 → unlimited), timezone (IANA)
 * @param {Object} ctx { now:Date, existingBookings:[{start,end}] }
 * @returns {Array<{ date, weekday, slots:[{start,end}] }>}  days with ≥1 open slot
 */
const computeOpenSlots = (cfg, { now = new Date(), existingBookings = [] } = {}) => {
  const tz = cfg.timezone || 'UTC';
  const duration = Math.max(5, Number(cfg.durationMinutes) || 30);
  const step = Number(cfg.slotInterval) > 0 ? Number(cfg.slotInterval) : duration;
  const bufBefore = (Number(cfg.bufferBefore) || 0) * MIN;
  const bufAfter = (Number(cfg.bufferAfter) || 0) * MIN;
  const minNoticeMs = (Number(cfg.minNoticeHours) || 0) * HOUR;
  const rangeDays = Math.min(120, Math.max(1, Number(cfg.dateRangeDays) || 30));
  const dailyCap = Number(cfg.dailyCap) || 0;

  const earliest = now.getTime() + minNoticeMs;
  const latest = now.getTime() + rangeDays * DAY;

  // Normalise existing bookings to ms intervals (only confirmed ones matter).
  const booked = (existingBookings || [])
    .map((b) => ({ start: toMs(b.start), end: toMs(b.end) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));

  const overridesByDate = new Map();
  for (const o of cfg.dateOverrides || []) {
    if (o && o.date) overridesByDate.set(o.date, o);
  }

  // Anchor on "today" in the link's timezone, then walk calendar dates forward.
  const startParts = getTzParts(now, tz);
  const out = [];

  for (let offset = 0; offset <= rangeDays; offset += 1) {
    // The calendar date `offset` days after today (UTC component arithmetic is
    // safe for Y-M-D; weekday is unambiguous for a given date).
    const dd = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day + offset));
    const Y = dd.getUTCFullYear();
    const M = dd.getUTCMonth() + 1;
    const D = dd.getUTCDate();
    const weekday = dd.getUTCDay();
    const dateStr = `${Y}-${pad(M)}-${pad(D)}`;

    // Resolve the day's windows.
    let windows;
    const ov = overridesByDate.get(dateStr);
    if (ov) {
      if (ov.unavailable) continue;
      windows = Array.isArray(ov.windows) && ov.windows.length > 0 ? ov.windows : [];
    } else {
      windows = (cfg.weeklyHours || []).filter((w) => Number(w.dayOfWeek) === weekday);
    }
    if (windows.length === 0) continue;

    // Daily cap counts confirmed bookings already on this local date.
    if (dailyCap > 0) {
      const onDay = booked.filter((b) => {
        const p = getTzParts(new Date(b.start), tz);
        return p.year === Y && p.month === M && p.day === D;
      }).length;
      if (onDay >= dailyCap) continue;
    }

    const daySlots = [];
    for (const win of windows) {
      const startMin = toMinutes(win.start);
      const endMin = toMinutes(win.end);
      if (startMin == null || endMin == null || endMin <= startMin) continue;

      for (let m = startMin; m + duration <= endMin; m += step) {
        const slotStart = localToUtcMs(Y, M, D, Math.floor(m / 60), m % 60, 0, tz);
        const slotEnd = slotStart + duration * MIN;
        if (slotStart < earliest || slotStart > latest) continue;

        // Buffer the candidate slot and test against booked intervals.
        const blockStart = slotStart - bufBefore;
        const blockEnd = slotEnd + bufAfter;
        const clash = booked.some((b) => b.start < blockEnd && b.end > blockStart);
        if (clash) continue;

        daySlots.push({ start: new Date(slotStart).toISOString(), end: new Date(slotEnd).toISOString() });
      }
    }

    // Dedup + sort (overlapping windows could repeat a slot).
    if (daySlots.length > 0) {
      const seen = new Set();
      const unique = daySlots
        .filter((s) => (seen.has(s.start) ? false : (seen.add(s.start), true)))
        .sort((a, b) => new Date(a.start) - new Date(b.start));
      out.push({ date: dateStr, weekday, slots: unique });
    }
  }

  return out;
};

/**
 * True when `slotStart` (ISO/Date) is one of the open slots — used at submit
 * time to re-validate the chosen slot against fresh availability + bookings.
 */
const isSlotOpen = (cfg, ctx, slotStartIso) => {
  const target = toMs(slotStartIso);
  if (!Number.isFinite(target)) return false;
  const days = computeOpenSlots(cfg, ctx);
  return days.some((d) => d.slots.some((s) => toMs(s.start) === target));
};

module.exports = { computeOpenSlots, isSlotOpen, toMinutes };
