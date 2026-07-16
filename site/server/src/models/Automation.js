const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema(
  {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      required: true,
    },
    daysOfWeek: [
      {
        type: Number,
        min: 0,
        max: 6,
      },
    ],
    dayOfMonth: {
      type: Number,
      min: 1,
      max: 31,
    },
    useLastDayOfMonth: {
      type: Boolean,
      default: false,
    },
    hour: {
      type: Number,
      min: 0,
      max: 23,
      default: 9,
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
  },
  { _id: false }
);

const taskTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaskGroup',
      required: true,
    },
    priority: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium',
    },
    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    note: {
      type: String,
    },
    dueInDays: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

/**
 * Task template for GROUP_CREATED automations. Mirrors taskTemplateSchema but
 * drops the `group` requirement — the spawned task always lands in the
 * newly-created triggering group, so the group is supplied at run time, not
 * at config time.
 */
const groupCreatedTaskTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    priority: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'medium',
    },
    assignedTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    note: {
      type: String,
    },
    dueInDays: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

/**
 * Condition row evaluated against the trigger payload. `value` is stored as
 * Mixed because the per-type semantics differ:
 *   - ITEM_IN_GROUP      → ObjectId matching task.group        (TaskGroup._id)
 *   - ITEM_IN_STATUS     → ObjectId matching task.status       (Board.statuses._id)
 *   - GROUP_NAME_MATCHES → string regex tested against the new group's name
 */
const conditionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['ITEM_IN_GROUP', 'ITEM_IN_STATUS', 'GROUP_NAME_MATCHES'],
      required: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { _id: false }
);

/**
 * One automation action. The F5 catalogue grows this from 2 → 11 types; the
 * per-type `config` shape is owned and validated by the `actionTypes.js`
 * registry (mirrors how `columnTypes.js` owns column-value validation), so the
 * model stores `config` as Mixed rather than a single fixed sub-schema.
 *
 * Back-compat: legacy CREATE_TASK / CREATE_SUBITEM rows persisted
 * `{ name, group, priority, assignedTo, status, note }` under `config` and load
 * unchanged — Mixed accepts the existing shape.
 *
 * Channel-backed actions (SEND_EMAIL / SEND_SMS / SEND_WHATSAPP / POST_WEBHOOK /
 * ASSIGN_LEAD_AGENT / CREATE_CALENDAR_EVENT) are persistable now but execute as
 * `skipped` until Phase 3/4 ships their channel (the registry marks them
 * `disabled`).
 */
const actionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        'CREATE_TASK',
        'CREATE_SUBITEM',
        'SET_COLUMN_VALUE',
        'MOVE_TO_GROUP',
        'NOTIFY_PERSON',
        'SEND_EMAIL',
        'SEND_SMS',
        'SEND_WHATSAPP',
        'CREATE_CALENDAR_EVENT',
        'POST_WEBHOOK',
        'ASSIGN_LEAD_AGENT',
      ],
      required: true,
    },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Loop-guard provenance (F5.4): which automation a cascaded/cloned action
    // originated from. The live same-automation re-entry guard reads the emitted
    // event's `_originAutomationId`; this persisted field records provenance for
    // recipes (F6) and audit.
    _originAutomationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Automation',
    },
  },
  { _id: false }
);

/**
 * One per-action outcome inside a triggerHistory entry. `status` mirrors the
 * F5 AutomationRunLog vocabulary so the run-log drawer and the (future) audit
 * table speak the same language. `error` is only set when status is 'failed'.
 */
const triggerHistoryActionSchema = new mongoose.Schema(
  {
    actionType: { type: String, required: true },
    status: {
      type: String,
      enum: ['ok', 'failed', 'skipped'],
      required: true,
    },
    error: { type: String },
  },
  { _id: false }
);

/**
 * One firing record. `matched` is true when triggerConfig + conditions both
 * passed and the actions ran; false when the trigger watched the right surface
 * (e.g. the configured column changed) but a condition rejected the event —
 * kept so users can debug "why didn't my automation fire?".
 *
 * `idempotencyKey` is written by the DATE_ARRIVED runner so a single computed
 * date instant never fires twice across hourly ticks (F4.5). Event-driven
 * firings leave it null.
 */
const triggerHistorySchema = new mongoose.Schema(
  {
    firedAt: { type: Date, default: Date.now },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    matched: { type: Boolean, default: true },
    idempotencyKey: { type: String, default: null },
    actionsRun: { type: [triggerHistoryActionSchema], default: [] },
  },
  { _id: false }
);

// Cap triggerHistory at the last 20 firings (FIFO — oldest dropped on append).
const TRIGGER_HISTORY_CAP = 20;

const automationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    board: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
      index: true,
    },
    organisation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      index: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    // Completeness of the automation's configuration (F6.3). 'complete' means
    // every binding resolved and no required channel is missing; 'incomplete' is
    // set when an automation is cloned from a recipe (`createFromRecipe`) that
    // references a not-yet-connected channel (SMS/email/webhook/…) or a binding
    // the target board can't satisfy yet (an unmapped column or group). Cloned
    // automations are always created `enabled: false`, so an 'incomplete' one
    // never fires — the user finishes binding it in the chain editor, at which
    // point a normal `updateAutomation` re-validates and the UI flips it back to
    // 'complete'. Default 'complete' for hand-built automations.
    validation: {
      type: String,
      enum: ['complete', 'incomplete'],
      default: 'complete',
    },
    // What fires this automation. SCHEDULE is the legacy cron-style trigger;
    // ITEM_CREATED runs in response to a task being created on the board;
    // GROUP_CREATED runs in response to a new group being created on the board.
    //
    // F4 (Phase 2) adds six event-driven triggers:
    //   - COLUMN_VALUE_CHANGED : any/the configured column on a task changes
    //   - STATUS_BECAME        : a status column transitions to a value
    //   - DATE_ARRIVED         : a date column ± offsetDays crosses "now"
    //   - PERSON_ASSIGNED      : a person column gains a user
    //   - FORM_SUBMITTED       : a public form (F13) creates a task here
    //   - WEBHOOK_RECEIVED     : an inbound webhook (F7) writes to this board
    // FORM_SUBMITTED / WEBHOOK_RECEIVED are persistable now but dormant until
    // their emitters land in Phase 3/4 (see automationController docs).
    triggerType: {
      type: String,
      enum: [
        'SCHEDULE',
        'ITEM_CREATED',
        'GROUP_CREATED',
        'COLUMN_VALUE_CHANGED',
        'STATUS_BECAME',
        'CHECKBOX_CHECKED',
        'NUMBER_CROSSED',
        'ITEM_MOVED_TO_GROUP',
        'UPDATE_POSTED',
        'DATE_ARRIVED',
        'PERSON_ASSIGNED',
        'FORM_SUBMITTED',
        'WEBHOOK_RECEIVED',
      ],
      default: 'SCHEDULE',
      index: true,
    },
    // Per-trigger configuration for the F4 event-driven triggers. Shape is
    // type-specific and validated by `sanitizeTriggerConfig` in the controller
    // (e.g. { columnId, toValue } for STATUS_BECAME). Stored as Mixed because
    // each trigger carries a different shape.
    triggerConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Legacy schedule/template: required only for SCHEDULE triggers, kept
    // optional in the schema so ITEM_CREATED automations can save without
    // them.
    schedule: {
      type: scheduleSchema,
    },
    taskTemplate: {
      type: taskTemplateSchema,
    },
    // New event-driven shape: only used when actions[] is non-empty. If set,
    // runAutomationOnce runs every action in order and ignores taskTemplate.
    conditions: {
      type: [conditionSchema],
      default: [],
    },
    // Phase 1b §1b.3 — richer conditions as an AND/OR tree of column compares
    // ({ conjunction, rules:[ leaf | group ] }). When set (non-empty), it takes
    // precedence over the flat `conditions[]` above. Stored as Mixed since the
    // shape is recursive. Validated by sanitizeConditionTree in the controller.
    conditionTree: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    actions: {
      type: [actionSchema],
      default: [],
    },
    // Task templates spawned when a GROUP_CREATED trigger fires. Each
    // template seeds a top-level task in the newly-created group.
    groupCreatedTaskTemplates: {
      type: [groupCreatedTaskTemplateSchema],
      default: [],
    },
    // Capped run log (last 20 firings) powering the F4 run-log drawer. Appended
    // by the dispatcher (event triggers) and the date runner (DATE_ARRIVED) via
    // the `appendTriggerHistory` static so both share one capping path.
    triggerHistory: {
      type: [triggerHistorySchema],
      default: [],
    },
    lastRunAt: {
      type: Date,
      default: null,
    },
    // High-water mark for the hourly DATE_ARRIVED runner. Each sweep fires only
    // for date instants in the window (lastDateTickAt, now] — i.e. instants
    // crossed *since the previous tick* — then advances this mark. This gives
    // edge-crossing semantics (no back-fire on enable for long-past dates) and
    // makes exactly-once independent of the 20-entry triggerHistory cap: a given
    // instant falls inside exactly one tick window, so it can't re-fire even if
    // its idempotency key is later evicted from triggerHistory.
    lastDateTickAt: {
      type: Date,
      default: null,
    },
    nextRunAt: {
      type: Date,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

/**
 * Push one firing record onto `automation.triggerHistory` and trim to the last
 * TRIGGER_HISTORY_CAP entries (FIFO — oldest dropped). Mutates the in-memory
 * doc but does NOT save — the caller persists (the dispatcher already saves the
 * automation to bump `lastRunAt`, and the date runner saves once per fire).
 *
 * Shared by the event dispatcher (F4.3) and the date runner (F4.5) so the
 * 20-entry cap lives in exactly one place.
 */
const appendTriggerHistory = (automation, entry) => {
  if (!automation) return;
  if (!Array.isArray(automation.triggerHistory)) {
    automation.triggerHistory = [];
  }
  automation.triggerHistory.push({
    firedAt: entry.firedAt || new Date(),
    taskId: entry.taskId || null,
    matched: entry.matched !== false,
    idempotencyKey: entry.idempotencyKey || null,
    actionsRun: Array.isArray(entry.actionsRun) ? entry.actionsRun : [],
  });
  const overflow = automation.triggerHistory.length - TRIGGER_HISTORY_CAP;
  if (overflow > 0) {
    automation.triggerHistory.splice(0, overflow);
  }
};

const Automation = mongoose.model('Automation', automationSchema);

Automation.appendTriggerHistory = appendTriggerHistory;
Automation.TRIGGER_HISTORY_CAP = TRIGGER_HISTORY_CAP;

module.exports = Automation;
