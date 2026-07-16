/**
 * leadIntakeRunner.js — the F9 Automated Lead Agent (F9.2).
 *
 * Subscribes to `lead.intake` (emitted by the F7 inbound webhook resolver and,
 * later, F13 forms). For each new lead it resolves the board's `LeadIntakePolicy`
 * and runs four atomic steps against the task, emitting ONE consolidated
 * `automation.run` for audit clarity (F16):
 *
 *   1. owner assignment   — round_robin / geo / fixed → the board person column
 *   2. initial stage       — set the policy's status column to its option value
 *   3. welcome touch       — send the templated email (F8) from the agent's box
 *   4. follow-up           — create a "Call lead" subitem due `followupOffsetHours`
 *
 * Each step is best-effort and independently logged (one child `AutomationRunLog`
 * row per step + one parent policy-run row). A step that can't proceed records a
 * `skipped`/`failed` outcome with a reason and the remaining steps still run.
 *
 * `resolveOwner(policy, task, board)` is the single owner-resolution path shared
 * with the `ASSIGN_LEAD_AGENT` automation action (F9.3) — it owns the atomic
 * round-robin cursor advance so concurrent intakes never collide.
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const Task = require('../models/Task');
const LeadIntakePolicy = require('../models/LeadIntakePolicy');
const EmailTemplate = require('../models/EmailTemplate');
const AutomationRunLog = require('../models/AutomationRunLog');
const eventBus = require('./eventBus');
const { getColumnType } = require('../utils/columnTypes');
const { interpolate } = require('../utils/templateInterpolate');
const { logAutomationRun } = require('./activityService');

const asId = (v) => (v == null ? '' : v.toString());
const HOUR_MS = 60 * 60 * 1000;

let mounted = false;

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the board person column the owner is written into. Honours the
 * policy's explicit `ownerColumnId`; otherwise prefers the well-known
 * `assignees` column (which the Task pre-save hook mirrors into `assignedTo`),
 * then the first `person`-typed column.
 */
const resolveOwnerColumn = (board, policy) => {
  const cols = board && Array.isArray(board.columns) ? board.columns : [];
  if (policy && policy.ownerColumnId) {
    const explicit = cols.find((c) => asId(c._id) === asId(policy.ownerColumnId));
    if (explicit) return explicit;
  }
  return (
    cols.find((c) => c.key === 'assignees' && c.type === 'person') ||
    cols.find((c) => c.type === 'person') ||
    null
  );
};

const readColumnValue = (task, columnId) => {
  if (!task || !task.columnValues || !columnId) return undefined;
  const key = asId(columnId);
  const cv = task.columnValues;
  return typeof cv.get === 'function' ? cv.get(key) : cv[key];
};

/** Ensure `task.columnValues` is a Map so `.set` works after a lean-ish load. */
const ensureColumnValueMap = (task) => {
  if (!task.columnValues || typeof task.columnValues.get !== 'function') {
    task.columnValues = new Map(Object.entries(task.columnValues || {}));
  }
  return task.columnValues;
};

// ---------------------------------------------------------------------------
// Owner resolution (shared with the ASSIGN_LEAD_AGENT action)
// ---------------------------------------------------------------------------

/**
 * Pure round-robin slot math: which pool index the given (already-advanced)
 * cursor maps to. Exported for unit tests — the determinism guarantee (AC2)
 * lives here. Returns -1 for an empty pool.
 */
const roundRobinSlot = (cursor, poolLength) => {
  if (!poolLength || poolLength <= 0) return -1;
  const n = Number(poolLength);
  const i = Number(cursor);
  return ((i % n) + n) % n;
};

/** Distinct, insertion-ordered user ids that appear as geoMap targets. */
const geoMapUserUnion = (geoMap) => {
  const out = [];
  const seen = new Set();
  if (!geoMap) return out;
  const entries =
    typeof geoMap.entries === 'function' ? geoMap.entries() : Object.entries(geoMap);
  for (const [, userId] of entries) {
    const id = asId(userId);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
};

/** Look up a city in `geoMap`, case/whitespace-insensitively. */
const geoLookup = (geoMap, city) => {
  if (!geoMap || city == null) return null;
  const target = String(city).trim().toLowerCase();
  if (!target) return null;
  const entries =
    typeof geoMap.entries === 'function' ? geoMap.entries() : Object.entries(geoMap);
  for (const [key, userId] of entries) {
    if (String(key).trim().toLowerCase() === target) return asId(userId) || null;
  }
  return null;
};

/**
 * Atomically advance the policy's round-robin cursor and return the slot index
 * just consumed. Uses `$inc` so two concurrent intakes get distinct slots.
 */
const advanceRoundRobinCursor = async (policyId) => {
  const updated = await LeadIntakePolicy.findOneAndUpdate(
    { _id: policyId },
    { $inc: { lastAssignedIndex: 1 } },
    { new: true }
  );
  return updated ? Number(updated.lastAssignedIndex) : 0;
};

/**
 * Resolve the owner for a lead under `policy`. Returns
 * `{ ownerId, strategy, fallback, reason }`. `ownerId` is null when no owner
 * can be resolved (empty pool / no fixed owner), with `reason` set.
 *
 * round_robin / geo-fallback advance the atomic cursor as a side effect, so this
 * must be called exactly once per assignment.
 */
const resolveOwner = async (policy, task, board) => {
  const strategy = policy.ownerStrategy || 'round_robin';

  if (strategy === 'fixed') {
    const ownerId = asId(policy.fixedOwnerId) || null;
    return {
      ownerId,
      strategy,
      fallback: false,
      reason: ownerId ? null : 'no_fixed_owner',
    };
  }

  if (strategy === 'geo') {
    const city = readColumnValue(task, policy.geoColumnId);
    const direct = geoLookup(policy.geoMap, city);
    if (direct) {
      return { ownerId: direct, strategy, fallback: false, reason: null, city: city == null ? null : String(city) };
    }
    // AC4 — city not in geoMap: fall back to round-robin across the geoMap union.
    const union = geoMapUserUnion(policy.geoMap);
    if (union.length === 0) {
      return { ownerId: null, strategy, fallback: true, reason: 'geo_unmatched_empty_union', city: city == null ? null : String(city) };
    }
    const cursor = await advanceRoundRobinCursor(policy._id);
    const slot = roundRobinSlot(cursor, union.length);
    return {
      ownerId: union[slot],
      strategy,
      fallback: true,
      reason: city ? 'geo_unmatched_fallback_round_robin' : 'geo_no_city_fallback_round_robin',
      city: city == null ? null : String(city),
    };
  }

  // round_robin
  const pool = (Array.isArray(policy.ownerPool) ? policy.ownerPool : []).map(asId).filter(Boolean);
  if (pool.length === 0) {
    return { ownerId: null, strategy, fallback: false, reason: 'empty_owner_pool' };
  }
  const cursor = await advanceRoundRobinCursor(policy._id);
  const slot = roundRobinSlot(cursor, pool.length);
  return { ownerId: pool[slot], strategy, fallback: false, reason: null };
};

/**
 * Step 1 — write the resolved owner into the board person column. Returns a
 * step outcome `{ status, reason?, ownerId?, columnId? }`.
 */
const assignOwner = async (policy, task, board) => {
  const resolution = await resolveOwner(policy, task, board);
  if (!resolution.ownerId) {
    return { status: 'skipped', reason: resolution.reason || 'no_owner_resolved', ...resolution };
  }
  const col = resolveOwnerColumn(board, policy);
  if (!col) {
    return { status: 'failed', reason: 'no_person_column', ownerId: resolution.ownerId };
  }
  const entry = getColumnType(col.type);
  const value = entry && entry.serialize ? entry.serialize([resolution.ownerId]) : [resolution.ownerId];

  const map = ensureColumnValueMap(task);
  map.set(asId(col._id), value);
  await task.save();

  return {
    status: 'ok',
    ownerId: resolution.ownerId,
    columnId: asId(col._id),
    strategy: resolution.strategy,
    fallback: resolution.fallback,
    reason: resolution.reason,
    city: resolution.city,
  };
};

/** Step 2 — set the policy's initial stage on the lead's status column. */
const setInitialStage = async (policy, task, board) => {
  if (!policy.initialStageColumnId || policy.initialStageValue == null || policy.initialStageValue === '') {
    return { status: 'skipped', reason: 'no_initial_stage_configured' };
  }
  const cols = board && Array.isArray(board.columns) ? board.columns : [];
  const col = cols.find((c) => asId(c._id) === asId(policy.initialStageColumnId));
  if (!col) return { status: 'failed', reason: 'stage_column_missing' };

  const entry = getColumnType(col.type);
  if (entry) {
    try {
      entry.validate(policy.initialStageValue, col.settings || {});
    } catch (err) {
      return { status: 'failed', reason: 'invalid_stage_value', error: err.message };
    }
  }
  const value = entry && entry.serialize ? entry.serialize(policy.initialStageValue) : policy.initialStageValue;
  const map = ensureColumnValueMap(task);
  map.set(asId(col._id), value);
  await task.save();
  return { status: 'ok', columnId: asId(col._id), value };
};

/** Resolve the welcome-email subject/body — inline policy copy wins, else the template. */
const resolveWelcomeCopy = async (policy) => {
  if (policy.welcomeEmailBody && String(policy.welcomeEmailBody).trim()) {
    return { subject: policy.welcomeEmailSubject || '', body: policy.welcomeEmailBody };
  }
  if (policy.welcomeEmailTemplateId) {
    const tpl = await EmailTemplate.findById(policy.welcomeEmailTemplateId).lean().catch(() => null);
    if (tpl && (tpl.body || tpl.subject)) {
      return { subject: tpl.subject || '', body: tpl.body || '' };
    }
  }
  return null;
};

/** Find the board's email column and read the lead's address off the task. */
const resolveLeadEmail = (task, board) => {
  const cols = board && Array.isArray(board.columns) ? board.columns : [];
  const emailCol = cols.find((c) => c.type === 'email');
  if (!emailCol) return null;
  const raw = readColumnValue(task, emailCol._id);
  const val = raw && typeof raw === 'object' ? raw.email || raw.value : raw;
  return val && String(val).trim() ? String(val).trim() : null;
};

/**
 * Step 3 — welcome touch. Sends the templated email FROM the assigned agent's
 * connected mailbox TO the lead's email. Per AC/F9.2: if the agent has no
 * connected mailbox, log `skipped` reason `no_mailbox` and continue (no Resend
 * fallback here — the welcome touch is the agent's voice or nothing).
 */
const sendWelcome = async (policy, task, board, ownerId) => {
  const copy = await resolveWelcomeCopy(policy);
  if (!copy) return { status: 'skipped', reason: 'no_template' };

  const to = resolveLeadEmail(task, board);
  if (!to) return { status: 'skipped', reason: 'no_lead_email' };

  // Lazy require keeps the module graph cycle-free at load.
  const { sendEmailForTask, resolveSenderAccount } = require('./taskEmail');
  const account = await resolveSenderAccount({
    workspaceId: board.organisation,
    candidateUserIds: [ownerId, board.createdBy].filter(Boolean),
  });
  if (!account) return { status: 'skipped', reason: 'no_mailbox' };

  const subject = interpolate(copy.subject || '', { task, board });
  const body = interpolate(copy.body || '', { task, board });

  const message = await sendEmailForTask({
    taskId: task._id,
    to,
    subject,
    body,
    account,
    sentBy: ownerId || board.createdBy,
  });

  if (message.status === 'failed') {
    return {
      status: 'failed',
      reason: 'send_failed',
      error: message.sendError || 'Email send failed',
      messageId: asId(message._id),
      via: message.provider,
    };
  }
  return { status: 'ok', to, messageId: asId(message._id), via: message.provider };
};

/**
 * Step 4 — create the "Call lead" follow-up subitem due `followupOffsetHours`
 * from now (default 24h), assigned to the lead's owner.
 */
const createFollowup = async (policy, task, board, ownerId) => {
  const offsetHours = Number.isFinite(policy.followupOffsetHours) ? Number(policy.followupOffsetHours) : 24;
  const due = new Date(Date.now() + offsetHours * HOUR_MS);
  const leadName = task.name || 'lead';

  const subitem = await Task.create({
    name: `Call lead — ${leadName}`,
    board: board._id,
    group: task.group,
    parent: task._id,
    priority: 'high',
    status: 'not_started',
    assignedTo: ownerId ? [ownerId] : [],
    dueDate: due,
    isPersonal: false,
    createdBy: ownerId || board.createdBy,
    createdByAutomation: true,
  });

  return { status: 'ok', subitemId: asId(subitem._id), dueDate: due.toISOString() };
};

// ---------------------------------------------------------------------------
// Orchestration + audit
// ---------------------------------------------------------------------------

const stepStatus = (outcome) => (outcome && outcome.status) || 'skipped';

/** Roll the four step outcomes up into one overall status for the parent row. */
const overallStatus = (steps) => {
  const statuses = Object.values(steps).map(stepStatus);
  if (statuses.includes('failed')) return 'failed';
  if (statuses.every((s) => s === 'skipped')) return 'skipped';
  return 'ok';
};

/**
 * Run the full intake policy for one lead. Writes a child `AutomationRunLog`
 * row per step plus a parent policy-run row (all sharing one `runId`) and emits
 * a single `automation.run` activity event.
 *
 * @returns {Promise<{ ran: boolean, reason?: string, steps?: object, runId?: string }>}
 */
const runIntakePolicy = async ({ taskId, boardId }) => {
  if (!taskId || !boardId) return { ran: false, reason: 'missing_payload' };

  const policy = await LeadIntakePolicy.findOne({ boardId });
  if (!policy || !policy.enabled) return { ran: false, reason: policy ? 'disabled' : 'no_policy' };

  const board = await Board.findById(boardId).select(
    'statuses columns useFlexibleColumns organisation createdBy name'
  );
  if (!board) return { ran: false, reason: 'board_missing' };

  const task = await Task.findById(taskId);
  if (!task) return { ran: false, reason: 'task_missing' };
  // Never react to a task an automation/intake created (loop guard parity).
  if (task.createdByAutomation) return { ran: false, reason: 'created_by_automation' };

  const runId = new mongoose.Types.ObjectId();
  const steps = {};

  // Step 1 — owner assignment (also yields the owner for steps 3 & 4).
  try {
    steps.assignOwner = await assignOwner(policy, task, board);
  } catch (err) {
    steps.assignOwner = { status: 'failed', reason: 'exception', error: err.message };
  }
  const ownerId = steps.assignOwner && steps.assignOwner.ownerId ? steps.assignOwner.ownerId : null;

  // Step 2 — initial stage.
  try {
    steps.initialStage = await setInitialStage(policy, task, board);
  } catch (err) {
    steps.initialStage = { status: 'failed', reason: 'exception', error: err.message };
  }

  // Step 3 — welcome touch.
  try {
    steps.welcome = await sendWelcome(policy, task, board, ownerId);
  } catch (err) {
    steps.welcome = { status: 'failed', reason: 'exception', error: err.message };
  }

  // Step 4 — follow-up subitem.
  try {
    steps.followup = await createFollowup(policy, task, board, ownerId);
  } catch (err) {
    steps.followup = { status: 'failed', reason: 'exception', error: err.message };
  }

  await writeRunLog({ policy, task, runId, steps, ownerId });

  // One consolidated activity event for the F16 audit trail.
  logAutomationRun({
    task,
    actor: ownerId || board.createdBy,
    automationId: policy._id,
    actionType: 'LEAD_INTAKE_POLICY',
    status: overallStatus(steps),
    runId,
  });

  return { ran: true, steps, runId: asId(runId) };
};

/** Persist the per-step child rows + a parent summary row (best-effort). */
const writeRunLog = async ({ policy, task, runId, steps, ownerId }) => {
  const childRows = [
    { actionType: 'ASSIGN_LEAD_AGENT', outcome: steps.assignOwner },
    { actionType: 'SET_INITIAL_STAGE', outcome: steps.initialStage },
    { actionType: 'SEND_WELCOME_EMAIL', outcome: steps.welcome },
    { actionType: 'CREATE_FOLLOWUP', outcome: steps.followup },
  ];

  try {
    await AutomationRunLog.insertMany([
      {
        policyId: policy._id,
        source: 'lead_intake',
        taskId: task._id,
        runId,
        actionType: 'LEAD_INTAKE_POLICY',
        status: overallStatus(steps),
        payloadSummary: {
          ownerId: ownerId || null,
          strategy: steps.assignOwner && steps.assignOwner.strategy,
          fallback: !!(steps.assignOwner && steps.assignOwner.fallback),
          city: steps.assignOwner && steps.assignOwner.city,
          stageSet: steps.initialStage && steps.initialStage.status === 'ok',
          welcomeStatus: stepStatus(steps.welcome),
          emailMessageId: steps.welcome && steps.welcome.messageId,
          followupTaskId: steps.followup && steps.followup.subitemId,
        },
      },
      ...childRows.map(({ actionType, outcome }) => ({
        policyId: policy._id,
        source: 'lead_intake',
        taskId: task._id,
        runId,
        actionType,
        status: stepStatus(outcome),
        error: outcome && (outcome.error || outcome.reason) ? outcome.error || outcome.reason : null,
        payloadSummary: outcome || null,
      })),
    ]);
  } catch (err) {
    console.error('[leadIntake] failed to write run-log rows:', err?.message || err);
  }
};

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

const handleLeadIntake = async (payload) => {
  if (!payload || !payload.taskId || !payload.boardId) return;
  try {
    await runIntakePolicy({ taskId: payload.taskId, boardId: payload.boardId });
  } catch (err) {
    console.error('[leadIntake] runIntakePolicy failed:', err?.message || err);
  }
};

/**
 * Subscribe the lead-intake runner to `lead.intake`. Idempotent — safe to call
 * once on boot. Registered in server.js alongside the other runners.
 */
const mountLeadIntakeRunner = () => {
  if (mounted) return;
  mounted = true;
  eventBus.on('lead.intake', (payload) =>
    Promise.resolve(handleLeadIntake(payload)).catch((err) =>
      console.error('[leadIntake] unhandled error:', err)
    )
  );
  console.log('lead intake runner mounted');
};

module.exports = {
  mountLeadIntakeRunner,
  runIntakePolicy,
  // Shared with the ASSIGN_LEAD_AGENT action + exported for unit tests.
  resolveOwner,
  assignOwner,
  resolveOwnerColumn,
  roundRobinSlot,
  geoMapUserUnion,
  geoLookup,
  overallStatus,
};
