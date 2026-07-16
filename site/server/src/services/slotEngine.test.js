/**
 * slotEngine.test.js — unit tests for booking open-slot computation (Phase 4b).
 *     node --test src/services/slotEngine.test.js
 *
 * Uses UTC as the link timezone so wall-clock == UTC and the assertions are
 * deterministic regardless of the machine's tz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeOpenSlots, isSlotOpen } = require('./slotEngine');

// Mon–Fri 09:00–11:00, UTC. now = Mon 2026-06-08 00:00 UTC (a Monday).
const baseCfg = {
  timezone: 'UTC',
  durationMinutes: 30,
  slotInterval: 0,
  bufferBefore: 0,
  bufferAfter: 0,
  minNoticeHours: 0,
  dateRangeDays: 7,
  dailyCap: 0,
  weeklyHours: [
    { dayOfWeek: 1, start: '09:00', end: '11:00' },
    { dayOfWeek: 2, start: '09:00', end: '11:00' },
    { dayOfWeek: 3, start: '09:00', end: '11:00' },
    { dayOfWeek: 4, start: '09:00', end: '11:00' },
    { dayOfWeek: 5, start: '09:00', end: '11:00' },
  ],
};
const NOW = new Date('2026-06-08T00:00:00.000Z'); // Monday

test('generates 30-min slots within weekly hours (4 per 2h window)', () => {
  const days = computeOpenSlots(baseCfg, { now: NOW, existingBookings: [] });
  const monday = days.find((d) => d.date === '2026-06-08');
  assert.ok(monday, 'Monday present');
  assert.equal(monday.slots.length, 4); // 9:00, 9:30, 10:00, 10:30
  assert.equal(monday.slots[0].start, '2026-06-08T09:00:00.000Z');
  assert.equal(monday.slots[3].start, '2026-06-08T10:30:00.000Z');
  assert.equal(monday.slots[3].end, '2026-06-08T11:00:00.000Z');
});

test('weekend (no weekly hours) yields no day', () => {
  const days = computeOpenSlots(baseCfg, { now: NOW, existingBookings: [] });
  assert.equal(days.find((d) => d.date === '2026-06-13'), undefined); // Saturday
  assert.equal(days.find((d) => d.date === '2026-06-14'), undefined); // Sunday
});

test('a booking removes its slot (and buffers block neighbours)', () => {
  const cfg = { ...baseCfg, bufferBefore: 15, bufferAfter: 15 };
  const booking = { start: '2026-06-08T09:30:00.000Z', end: '2026-06-08T10:00:00.000Z' };
  const days = computeOpenSlots(cfg, { now: NOW, existingBookings: [booking] });
  const monday = days.find((d) => d.date === '2026-06-08');
  const starts = monday.slots.map((s) => s.start);
  // 9:30 booked; with 15m buffers, 9:00 (ends 9:30, buffer overlaps) and 10:00
  // (starts right after, buffer overlaps) are blocked → only 10:30 remains.
  assert.deepEqual(starts, ['2026-06-08T10:30:00.000Z']);
});

test('minNotice hides slots too soon', () => {
  const cfg = { ...baseCfg, minNoticeHours: 10 }; // now=00:00 → earliest 10:00
  const days = computeOpenSlots(cfg, { now: NOW, existingBookings: [] });
  const monday = days.find((d) => d.date === '2026-06-08');
  assert.deepEqual(monday.slots.map((s) => s.start), ['2026-06-08T10:00:00.000Z', '2026-06-08T10:30:00.000Z']);
});

test('dateRangeDays bounds the window', () => {
  const cfg = { ...baseCfg, dateRangeDays: 2 }; // Mon + Tue + Wed(offset2)
  const days = computeOpenSlots(cfg, { now: NOW, existingBookings: [] });
  assert.ok(days.every((d) => d.date <= '2026-06-10'));
});

test('dailyCap suppresses a fully-booked day', () => {
  const cfg = { ...baseCfg, dailyCap: 1 };
  const booking = { start: '2026-06-08T09:00:00.000Z', end: '2026-06-08T09:30:00.000Z' };
  const days = computeOpenSlots(cfg, { now: NOW, existingBookings: [booking] });
  assert.equal(days.find((d) => d.date === '2026-06-08'), undefined);
});

test('date override: unavailable day is skipped, custom window is honoured', () => {
  const cfg = {
    ...baseCfg,
    dateOverrides: [
      { date: '2026-06-09', unavailable: true }, // Tue off
      { date: '2026-06-10', windows: [{ start: '14:00', end: '15:00' }] }, // Wed custom
    ],
  };
  const days = computeOpenSlots(cfg, { now: NOW, existingBookings: [] });
  assert.equal(days.find((d) => d.date === '2026-06-09'), undefined);
  const wed = days.find((d) => d.date === '2026-06-10');
  assert.deepEqual(wed.slots.map((s) => s.start), ['2026-06-10T14:00:00.000Z', '2026-06-10T14:30:00.000Z']);
});

test('isSlotOpen validates a chosen slot', () => {
  const ctx = { now: NOW, existingBookings: [] };
  assert.equal(isSlotOpen(baseCfg, ctx, '2026-06-08T09:30:00.000Z'), true);
  assert.equal(isSlotOpen(baseCfg, ctx, '2026-06-08T12:00:00.000Z'), false); // outside hours
});

test('non-UTC timezone: 9am America/Toronto (EDT) → 13:00 UTC', () => {
  const cfg = { ...baseCfg, timezone: 'America/Toronto', weeklyHours: [{ dayOfWeek: 1, start: '09:00', end: '09:30' }] };
  const days = computeOpenSlots(cfg, { now: NOW, existingBookings: [] });
  const monday = days.find((d) => d.date === '2026-06-08');
  // June → EDT (UTC-4) → 09:00 local == 13:00 UTC
  assert.equal(monday.slots[0].start, '2026-06-08T13:00:00.000Z');
});
