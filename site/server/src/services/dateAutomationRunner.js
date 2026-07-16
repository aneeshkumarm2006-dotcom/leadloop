const cron = require('node-cron');
const Automation = require('../models/Automation');
const Board = require('../models/Board');
const Task = require('../models/Task');
const Organisation = require('../models/Organisation');
const { runActions } = require('./automationActionRunner');
const { evaluateConditionTree, treeHasConditions } = require('../utils/conditionTree');

let started = false;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = 'America/Edmonton';

/**
 * Map a Workspace/Organisation `region` (F3) to an IANA timezone. Saskatoon and
 * Regina are both in Saskatchewan (no DST → America/Regina); Montreal is
 * Eastern (America/Toronto). Anything unknown falls back to Edmonton.
 */
const REGION_TIMEZONES = {
  Edmonton: 'America/Edmonton',
  Saskatoon: 'America/Regina',
  Regina: 'America/Regina',
  Montreal: 'America/Toronto',
  Other: DEFAULT_TIMEZONE,
};

const timezoneForRegion = (region) =>
  (region && REGION_TIMEZONES[region]) || DEFAULT_TIMEZONE;

/**
 * Milliseconds that `tz` is ahead of UTC at the given instant. Uses
 * Intl.DateTimeFormat so no tz library (moment/luxon) is needed.
 */
const getTzOffsetMs = (tz, date) => {
  let dtf;
  try {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return 0; // unknown tz → treat as UTC
  }
  const map = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUTC - date.getTime();
};

/**
 * UTC ms for a wall-clock time in `tz`. Single-correction pass — accurate
 * except for the rare wall-clock hour that doesn't exist / repeats across a DST
 * transition, which midnight almost never is.
 */
const zonedWallTimeToUtcMs = (y, mZero, day, hour, minute, tz) => {
  const guess = Date.UTC(y, mZero, day, hour, minute, 0);
  const offset = getTzOffsetMs(tz, new Date(guess));
  return guess - offset;
};

/**
 * Compute the UTC instant a DATE_ARRIVED automation should fire for a task,
 * given the task's stored date value, the offset, and the workspace timezone.
 *
 * The date column serialises a date to midnight-UTC of that calendar day
 * (`new Date('2026-06-15').toISOString()`), so we read the calendar date from
 * UTC components, shift by `offsetDays`, then resolve midnight *local* (tz) of
 * the resulting day. `offsetDays` carries the direction; `comparison` is a
 * descriptive label (before/on/after) that does not change the fire instant.
 *
 * Returns a Date, or null when the task has no value in that column.
 */
const computeFireInstant = (isoValue, offsetDays, tz) => {
  if (isoValue == null || isoValue === '') return null;
  const base = new Date(isoValue);
  if (Number.isNaN(base.getTime())) return null;
  const shifted = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + Number(offsetDays || 0)
    )
  );
  const ms = zonedWallTimeToUtcMs(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    0,
    0,
    tz
  );
  return new Date(ms);
};

const readTaskColumnValue = (task, columnId) => {
  if (!task || !task.columnValues || !columnId) return null;
  const key = columnId.toString();
  const cv = task.columnValues;
  const raw = typeof cv.get === 'function' ? cv.get(key) : cv[key];
  return raw == null ? null : raw;
};

const summarizeRun = async (automation, ctx) => {
  try {
    // F5.4: actions execute through the registry runner, which writes the
    // per-action AutomationRunLog audit rows and returns the outcomes we fold
    // into this firing's triggerHistory entry.
    const { outcomes } = await runActions(automation, ctx);
    return outcomes;
  } catch (err) {
    console.error(
      '[dateAutomation] action run failed for',
      automation?._id?.toString(),
      err
    );
    return (Array.isArray(automation.actions) ? automation.actions : []).map((a) => ({
      actionType: a.type,
      status: 'failed',
      error: err.message,
    }));
  }
};

/**
 * Decide whether a computed fire `instant` falls in this tick's window, i.e. it
 * was crossed *since the previous tick*: `prevTickMs < instant <= now`. This is
 * the edge-crossing semantics the spec calls for (F4.5): an instant lands in
 * exactly one tick window, so a single date fires once and only once — and that
 * guarantee no longer depends on the 20-entry triggerHistory idempotency cap.
 * The lower bound also stops a freshly-enabled automation from back-firing on
 * every historical past-dated task on the board.
 */
const instantInTickWindow = (instantMs, prevTickMs, nowMs) =>
  instantMs > prevTickMs && instantMs <= nowMs;

/**
 * Process one DATE_ARRIVED automation: walk the board's tasks and fire for any
 * whose computed fire instant was crossed during this tick window
 * (lastDateTickAt, now]. Advances `lastDateTickAt` afterwards so the window
 * marches forward and never re-fires a past instant.
 */
const runDateAutomation = async (automation, now) => {
  const cfg = automation.triggerConfig || {};
  const columnId = cfg.columnId;
  // Advance the high-water mark even for misconfigured automations so a later
  // valid config doesn't suddenly back-fire on old dates.
  const nowMs = now.getTime();
  const prevTickMs = automation.lastDateTickAt
    ? automation.lastDateTickAt.getTime()
    : nowMs; // first ever sweep: empty window → no historical back-fire
  if (!columnId) {
    automation.lastDateTickAt = now;
    try {
      await automation.save();
    } catch (err) {
      console.error('[dateAutomation] failed to advance tick mark', automation?._id?.toString(), err);
    }
    return;
  }

  const offsetDays = Number(cfg.offsetDays || 0);

  const org = await Organisation.findById(automation.organisation)
    .select('region')
    .lean();
  const tz = timezoneForRegion(org && org.region);

  const tasks = await Task.find({
    board: automation.board,
    isPersonal: { $ne: true },
  }).select('columnValues group createdByAutomation');

  // §1b.3 — honour an AND/OR condition tree (only fire for matching tasks).
  const hasTree = treeHasConditions(automation.conditionTree);
  const boardForConditions = hasTree
    ? await Board.findById(automation.board).select('columns').lean()
    : null;

  // Secondary idempotency guard (covers overlapping windows after a clock skew /
  // restart): a single computed instant fires at most once. Keys are stored on
  // each triggerHistory entry the runner appends. The tick window above is the
  // primary guarantee; this backstop survives even if the window is replayed.
  const seenKeys = new Set(
    (automation.triggerHistory || [])
      .map((h) => h && h.idempotencyKey)
      .filter(Boolean)
  );

  let fired = false;

  for (const task of tasks) {
    if (task.createdByAutomation) continue; // loop guard parity
    if (hasTree && !evaluateConditionTree(task, automation.conditionTree, boardForConditions)) continue;
    const value = readTaskColumnValue(task, columnId);
    const instant = computeFireInstant(value, offsetDays, tz);
    if (!instant) continue;
    // Fire only for instants crossed during this tick window (since last tick).
    if (!instantInTickWindow(instant.getTime(), prevTickMs, nowMs)) continue;

    const key = `${automation._id.toString()}:${task._id.toString()}:${instant.toISOString()}`;
    if (seenKeys.has(key)) continue; // already fired for this instant
    seenKeys.add(key);

    const actionsRun = await summarizeRun(automation, { triggeringTask: task });
    Automation.appendTriggerHistory(automation, {
      firedAt: now,
      taskId: task._id,
      matched: true,
      idempotencyKey: key,
      actionsRun,
    });
    fired = true;
  }

  // Always advance the tick mark so the window marches forward, even when
  // nothing fired this sweep.
  automation.lastDateTickAt = now;
  if (fired) automation.lastRunAt = now;
  try {
    await automation.save();
  } catch (err) {
    console.error(
      '[dateAutomation] failed to save automation',
      automation?._id?.toString(),
      err
    );
  }
};

const tick = async () => {
  const now = new Date();
  let automations;
  try {
    automations = await Automation.find({
      enabled: true,
      triggerType: 'DATE_ARRIVED',
    });
  } catch (err) {
    console.error('[dateAutomation] failed to query DATE_ARRIVED automations:', err);
    return;
  }

  for (const automation of automations) {
    try {
      await runDateAutomation(automation, now);
    } catch (err) {
      console.error(
        '[dateAutomation] run failed for',
        automation?._id?.toString(),
        err
      );
    }
  }
};

/**
 * Start the hourly DATE_ARRIVED runner. Idempotent — safe to call once on boot.
 */
const startDateAutomationRunner = () => {
  if (started) return;
  started = true;
  cron.schedule('0 * * * *', () => {
    tick().catch((err) => console.error('[dateAutomation] tick error:', err));
  });
  console.log('date automation runner started');
};

module.exports = {
  startDateAutomationRunner,
  // Exported for unit tests.
  computeFireInstant,
  timezoneForRegion,
  zonedWallTimeToUtcMs,
  instantInTickWindow,
};
