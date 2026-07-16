const Automation = require('../models/Automation');
const Task = require('../models/Task');
const TaskGroup = require('../models/TaskGroup');
const Board = require('../models/Board');
const eventBus = require('./eventBus');
const { runAutomationOnce } = require('../controllers/automationController');
const { runActions } = require('./automationActionRunner');
const { evaluateConditionTree, treeHasConditions } = require('../utils/conditionTree');

let mounted = false;

/**
 * Read a task's current status id, accounting for the flexible-columns
 * engine (F1). When `board.useFlexibleColumns === true`, walk the board's
 * `columns` to find the `status`-typed column (preferring `key === 'status'`)
 * and return the value from `task.columnValues[colId]`. Otherwise fall back
 * to the legacy `task.status` field.
 *
 * Returns a string (or null). Used by ITEM_IN_STATUS condition evaluation
 * downstream of the create payload so re-evaluating against a refetched task
 * picks up the right value regardless of which storage owns it.
 */
const readCurrentStatusId = (task, board) => {
  if (board && board.useFlexibleColumns && Array.isArray(board.columns) && board.columns.length > 0) {
    const statusCol =
      board.columns.find((c) => c.key === 'status' && c.type === 'status') ||
      board.columns.find((c) => c.type === 'status');
    if (statusCol && task && task.columnValues) {
      const raw =
        typeof task.columnValues.get === 'function'
          ? task.columnValues.get(statusCol._id.toString())
          : task.columnValues[statusCol._id.toString()];
      if (raw != null) return raw.toString();
    }
  }
  return task && task.status ? task.status.toString() : null;
};

/**
 * True if every condition on the automation matches the triggering task.
 * An empty `conditions` array is treated as "match everything" — the
 * automation fires on every item creation for its board.
 */
const evaluateConditions = (automation, payload) => {
  const conds = Array.isArray(automation.conditions) ? automation.conditions : [];
  if (conds.length === 0) return true;
  for (const c of conds) {
    if (!c?.type || !c?.value) return false;
    const target = c.value.toString();
    if (c.type === 'ITEM_IN_GROUP') {
      if (!payload.groupId || payload.groupId.toString() !== target) return false;
    } else if (c.type === 'ITEM_IN_STATUS') {
      if (!payload.statusId || payload.statusId.toString() !== target) return false;
    } else {
      // Unknown condition types are treated as failing matches so we
      // don't accidentally run automations the user can't see.
      return false;
    }
  }
  return true;
};

/**
 * Decide whether a task-scoped automation's conditions pass. Prefers the §1b.3
 * AND/OR condition tree (evaluated against the full task + board columns) when
 * one is set; otherwise falls back to the legacy flat conditions
 * (group/status). One source of truth for the dispatcher + date runner.
 */
const conditionsPass = (automation, { task, board, fallbackPayload }) => {
  const tree = automation && automation.conditionTree;
  if (tree && treeHasConditions(tree)) {
    return evaluateConditionTree(task, tree, board);
  }
  return evaluateConditions(automation, fallbackPayload || {});
};

/**
 * True if every condition on a GROUP_CREATED automation matches the new
 * group. Conditions for this trigger only support GROUP_NAME_MATCHES today
 * (value is a regex string). An empty conditions array matches every group.
 */
const evaluateGroupCreatedConditions = (automation, payload) => {
  const conds = Array.isArray(automation.conditions) ? automation.conditions : [];
  if (conds.length === 0) return true;
  const name = payload.groupName == null ? '' : String(payload.groupName);
  for (const c of conds) {
    if (!c?.type || c.value == null) return false;
    if (c.type === 'GROUP_NAME_MATCHES') {
      let re;
      try {
        re = new RegExp(String(c.value));
      } catch (err) {
        console.error(
          '[automation/dispatcher] invalid GROUP_NAME_MATCHES regex',
          c.value,
          err.message
        );
        return false;
      }
      if (!re.test(name)) return false;
    } else {
      // Unknown condition types — treat as failing matches so the
      // automation can't fire on payloads it wasn't designed for.
      return false;
    }
  }
  return true;
};

const handleGroupCreated = async (payload) => {
  if (!payload || !payload.groupId || !payload.boardId) return;

  let triggeringGroup;
  try {
    triggeringGroup = await TaskGroup.findById(payload.groupId);
  } catch (err) {
    console.error('[automation/dispatcher] failed to load triggering group:', err);
    return;
  }
  if (!triggeringGroup) return;

  let automations;
  try {
    automations = await Automation.find({
      board: payload.boardId,
      enabled: true,
      triggerType: 'GROUP_CREATED',
    });
  } catch (err) {
    console.error('[automation/dispatcher] failed to query automations:', err);
    return;
  }

  for (const automation of automations) {
    if (!evaluateGroupCreatedConditions(automation, payload)) continue;
    try {
      await runAutomationOnce(automation, { triggeringGroup });
      automation.lastRunAt = new Date();
      await automation.save();
    } catch (err) {
      console.error(
        '[automation/dispatcher] failed to run automation',
        automation?._id?.toString(),
        err
      );
    }
  }
};

const handleItemCreated = async (payload) => {
  if (!payload || !payload.taskId || !payload.boardId) return;

  // Fetch the triggering task so action handlers (CREATE_SUBITEM) have the
  // full doc. Skip automation-created tasks outright — the flag is the
  // primary defence against infinite trigger loops.
  let triggeringTask;
  try {
    triggeringTask = await Task.findById(payload.taskId);
  } catch (err) {
    console.error('[automation/dispatcher] failed to load triggering task:', err);
    return;
  }
  if (!triggeringTask) return;
  if (triggeringTask.createdByAutomation) return;
  if (triggeringTask.parent) return; // subitems never trigger

  // F1 shim: on flexible-columns boards the create payload's `statusId`
  // can be stale relative to columnValues. Refresh from the board's
  // status column so ITEM_IN_STATUS conditions evaluate consistently.
  let board = null;
  try {
    board = await Board.findById(payload.boardId).select('useFlexibleColumns columns').lean();
  } catch (err) {
    console.error('[automation/dispatcher] failed to load board for shim:', err);
  }
  if (board && board.useFlexibleColumns) {
    const refreshedStatusId = readCurrentStatusId(triggeringTask, board);
    if (refreshedStatusId) {
      payload = { ...payload, statusId: refreshedStatusId };
    }
  }

  let automations;
  try {
    automations = await Automation.find({
      board: payload.boardId,
      enabled: true,
      triggerType: 'ITEM_CREATED',
    });
  } catch (err) {
    console.error('[automation/dispatcher] failed to query automations:', err);
    return;
  }

  for (const automation of automations) {
    if (!conditionsPass(automation, { task: triggeringTask, board, fallbackPayload: payload })) continue;
    try {
      await runAutomationOnce(automation, { triggeringTask });
      automation.lastRunAt = new Date();
      await automation.save();
    } catch (err) {
      console.error(
        '[automation/dispatcher] failed to run automation',
        automation?._id?.toString(),
        err
      );
    }
  }
};

// ===========================================================================
// F4 — event-driven triggers (COLUMN_VALUE_CHANGED / STATUS_BECAME /
// DATE_ARRIVED-via-runner / PERSON_ASSIGNED / FORM_SUBMITTED / WEBHOOK_RECEIVED)
// ===========================================================================

const asId = (v) => (v == null ? '' : v.toString());

// ----- F5.4 loop guard -----------------------------------------------------
// Cross-automation cascade safeguard (pre-flight decision: depth cap of 5). A
// SET_COLUMN_VALUE write tags its emitted events with an incremented
// `_cascadeDepth`; once the depth reaches the cap the dispatcher drops the event
// so an A→B→A… column chain can't run away.
const MAX_CASCADE_DEPTH = 5;

const cascadeDepthExceeded = (payload, max = MAX_CASCADE_DEPTH) =>
  (Number(payload && payload._cascadeDepth) || 0) >= max;

// Same-automation re-entry guard: skip an event this very automation just
// produced (via its own SET_COLUMN_VALUE write). Cross-automation chains still
// pass — only re-entry into the originating automation is suppressed. This is
// the F5 equivalent of `createdByAutomation` for column writes (that flag stays
// for CREATE_TASK recursion).
const originMatches = (automation, payload) =>
  !!(payload && payload._originAutomationId) &&
  asId(payload._originAutomationId) === asId(automation && automation._id);

/**
 * Per-trigger `triggerConfig` matchers. Each takes the automation's stored
 * config and the event payload and returns true when the trigger's *watched
 * surface* matches (column/value/user/form/endpoint). Conditions are evaluated
 * separately — these only decide relevance.
 */
const TRIGGER_MATCHERS = {
  // { columnId? } — empty means any column.
  COLUMN_VALUE_CHANGED: (cfg, payload) => {
    if (!cfg || !cfg.columnId) return true;
    return asId(cfg.columnId) === asId(payload.columnId);
  },
  // { columnId, fromValue?, toValue } — compares against option ids.
  STATUS_BECAME: (cfg, payload) => {
    if (!cfg || asId(cfg.columnId) !== asId(payload.columnId)) return false;
    if (asId(cfg.toValue) !== asId(payload.toValue)) return false;
    if (cfg.fromValue != null && cfg.fromValue !== '') {
      if (asId(cfg.fromValue) !== asId(payload.fromValue)) return false;
    }
    return true;
  },
  // { columnId } — fires when the watched checkbox column becomes checked
  // (truthy new value). Rides the same task.column_changed event.
  CHECKBOX_CHECKED: (cfg, payload) => {
    if (!cfg || asId(cfg.columnId) !== asId(payload.columnId)) return false;
    const v = payload.toValue;
    return v === true || v === 'true' || v === 1 || v === '1';
  },
  // { columnId, threshold, direction } — fires when the number crosses the
  // threshold: rising through it for 'above', falling through it for 'below'.
  NUMBER_CROSSED: (cfg, payload) => {
    if (!cfg || asId(cfg.columnId) !== asId(payload.columnId)) return false;
    const th = Number(cfg.threshold);
    if (!Number.isFinite(th)) return false;
    const to = Number(payload.toValue);
    if (!Number.isFinite(to)) return false;
    const fromRaw = Number(payload.fromValue);
    const from = Number.isFinite(fromRaw) ? fromRaw : null;
    if (cfg.direction === 'below') {
      // crossed downward: was above (or unset) and is now at/below the threshold
      return (from === null || from > th) && to <= th;
    }
    // 'above' — crossed upward: was below (or unset) and is now at/above
    return (from === null || from < th) && to >= th;
  },
  // { groupId? } — empty means "moved to any group"; set means the destination
  // group must match. Rides the task.moved_to_group event.
  ITEM_MOVED_TO_GROUP: (cfg, payload) => {
    if (!cfg || !cfg.groupId) return true;
    return asId(cfg.groupId) === asId(payload.toGroupId);
  },
  // No config — fires on every update posted to the task. Rides update.posted.
  UPDATE_POSTED: () => true,
  // { columnId, userId? } — userId (if set) must be among the net-added users.
  PERSON_ASSIGNED: (cfg, payload) => {
    if (!cfg || asId(cfg.columnId) !== asId(payload.columnId)) return false;
    if (cfg.userId != null && cfg.userId !== '') {
      const added = Array.isArray(payload.addedUserIds)
        ? payload.addedUserIds.map(asId)
        : [];
      if (!added.includes(asId(cfg.userId))) return false;
    }
    return true;
  },
  // Dormant until F13 emits `form.submitted`. { formId? }.
  FORM_SUBMITTED: (cfg, payload) =>
    !cfg || !cfg.formId || asId(cfg.formId) === asId(payload.formId),
  // Dormant until F7 emits `webhook.received`. { endpointId? }.
  WEBHOOK_RECEIVED: (cfg, payload) =>
    !cfg || !cfg.endpointId || asId(cfg.endpointId) === asId(payload.endpointId),
};

/**
 * Generic handler for the F4 task-scoped triggers. Loads the triggering task
 * (skipping automation-created tasks — the loop guard), then for every enabled
 * automation of `triggerType` on the board:
 *   - drops the whole event when the cross-automation cascade depth cap is hit;
 *   - skips an automation that produced this very event (same-automation guard);
 *   - skips entirely when triggerConfig doesn't match (not relevant, no log);
 *   - logs `matched: false` when the watched surface matched but a condition
 *     rejected the event (so users can debug a non-firing automation);
 *   - otherwise runs the actions through the F5 registry runner and logs
 *     `matched: true` with the per-action outcomes (also written to the
 *     AutomationRunLog audit collection).
 * Mirrors `handleItemCreated`'s structure (load task, skip createdByAutomation).
 */
const handleTaskTriggerEvent = async (triggerType, payload) => {
  if (!payload || !payload.taskId || !payload.boardId) return;
  const matchFn = TRIGGER_MATCHERS[triggerType];
  if (!matchFn) return;

  // F5.4 cascade safeguard: drop events that have already chained too deep.
  if (cascadeDepthExceeded(payload)) {
    console.warn(
      '[automation/dispatcher] cascade depth cap reached — dropping event',
      triggerType
    );
    return;
  }

  let triggeringTask;
  try {
    triggeringTask = await Task.findById(payload.taskId);
  } catch (err) {
    console.error('[automation/dispatcher] failed to load triggering task:', err);
    return;
  }
  if (!triggeringTask) return;
  // Loop guard: never react to a task an automation created (CREATE_TASK). The
  // F5 `_originAutomationId` tag handles the SET_COLUMN_VALUE re-entry case below.
  if (triggeringTask.createdByAutomation) return;

  // Resolve group/status for ITEM_IN_GROUP / ITEM_IN_STATUS condition eval.
  let board = null;
  try {
    board = await Board.findById(payload.boardId)
      .select('useFlexibleColumns columns statuses')
      .lean();
  } catch (err) {
    console.error('[automation/dispatcher] failed to load board:', err);
  }
  const condPayload = {
    groupId: triggeringTask.group,
    statusId: readCurrentStatusId(triggeringTask, board),
  };

  let automations;
  try {
    automations = await Automation.find({
      board: payload.boardId,
      enabled: true,
      triggerType,
    });
  } catch (err) {
    console.error('[automation/dispatcher] failed to query automations:', err);
    return;
  }

  for (const automation of automations) {
    // Same-automation re-entry guard: an automation never reacts to the column
    // write it just made (cross-automation chains still pass — see originMatches).
    if (originMatches(automation, payload)) continue;

    const cfg = automation.triggerConfig || {};
    if (!matchFn(cfg, payload)) continue; // watched surface didn't match

    if (!conditionsPass(automation, { task: triggeringTask, board, fallbackPayload: condPayload })) {
      // Relevant but filtered out by a condition — record for debugging.
      Automation.appendTriggerHistory(automation, {
        taskId: triggeringTask._id,
        matched: false,
        actionsRun: [],
      });
      try {
        await automation.save();
      } catch (err) {
        console.error('[automation/dispatcher] failed to save history:', err);
      }
      continue;
    }

    let actionsRun = [];
    try {
      const result = await runActions(automation, {
        triggeringTask,
        board,
        prior: payload,
        actorId: payload.actorId,
        cascadeDepth: Number(payload._cascadeDepth) || 0,
      });
      actionsRun = result.outcomes;
    } catch (err) {
      console.error(
        '[automation/dispatcher] action run failed for',
        automation?._id?.toString(),
        err
      );
      actionsRun = (Array.isArray(automation.actions) ? automation.actions : []).map(
        (a) => ({ actionType: a.type, status: 'failed', error: err.message })
      );
    }
    Automation.appendTriggerHistory(automation, {
      taskId: triggeringTask._id,
      matched: true,
      actionsRun,
    });
    automation.lastRunAt = new Date();
    try {
      await automation.save();
    } catch (err) {
      console.error(
        '[automation/dispatcher] failed to save automation',
        automation?._id?.toString(),
        err
      );
    }
  }
};

// A single column change drives COLUMN_VALUE_CHANGED plus the specialised
// CHECKBOX_CHECKED / NUMBER_CROSSED triggers (each filtered by its own matcher,
// so only relevant automations run). They ride the same task.column_changed
// event — no extra emit points needed.
const handleColumnChanged = async (payload) => {
  await handleTaskTriggerEvent('COLUMN_VALUE_CHANGED', payload);
  await handleTaskTriggerEvent('CHECKBOX_CHECKED', payload);
  await handleTaskTriggerEvent('NUMBER_CROSSED', payload);
};
const handleStatusBecame = (payload) =>
  handleTaskTriggerEvent('STATUS_BECAME', payload);
const handlePersonAssigned = (payload) =>
  handleTaskTriggerEvent('PERSON_ASSIGNED', payload);
const handleMovedToGroup = (payload) =>
  handleTaskTriggerEvent('ITEM_MOVED_TO_GROUP', payload);
const handleUpdatePosted = (payload) =>
  handleTaskTriggerEvent('UPDATE_POSTED', payload);

// Dormant cross-phase handlers — registered now so the emitters in F7/F13 land
// into live subscribers (exactly how the F1 events were dormant in Phase 1).
// They share the task-trigger machinery; until a real `form.submitted` /
// `webhook.received` payload (carrying a taskId) is emitted, these no-op.
const handleFormSubmitted = (payload) =>
  handleTaskTriggerEvent('FORM_SUBMITTED', payload);
const handleWebhookReceived = (payload) =>
  handleTaskTriggerEvent('WEBHOOK_RECEIVED', payload);

/**
 * F9 lead-intake hook. `lead.intake` is the dedicated signal for the F9
 * lead-intake-policy runner (owner assignment, welcome touch, follow-up) which
 * subscribes here in F9. It is intentionally NOT re-routed into the
 * WEBHOOK_RECEIVED / FORM_SUBMITTED automation matchers: F7 emits
 * `webhook.received` and F13 emits `form.submitted` directly alongside
 * `lead.intake`, and those dedicated emitters already drive their automation
 * families exactly once. Routing `lead.intake` through them too would double-fire
 * every WEBHOOK_RECEIVED / FORM_SUBMITTED automation. Until F9 mounts its runner
 * this is a deliberate no-op.
 */
const handleLeadIntake = async (_payload) => {
  // no-op until F9's lead-intake-policy runner subscribes to `lead.intake`.
};

/**
 * Subscribe the dispatcher to the event bus. Idempotent — safe to call
 * multiple times across hot-reloads.
 */
const mountAutomationEventDispatcher = () => {
  if (mounted) return;
  mounted = true;

  const wrap = (fn) => (payload) =>
    Promise.resolve(fn(payload)).catch((err) =>
      console.error('[automation/dispatcher] unhandled error:', err)
    );

  eventBus.on('item.created', wrap(handleItemCreated));
  eventBus.on('group.created', wrap(handleGroupCreated));
  // F4 — F1 column events.
  eventBus.on('task.column_changed', wrap(handleColumnChanged));
  eventBus.on('task.status_became', wrap(handleStatusBecame));
  eventBus.on('task.person_assigned', wrap(handlePersonAssigned));
  // Phase 1b — new task-scoped triggers with their own emit points.
  eventBus.on('task.moved_to_group', wrap(handleMovedToGroup));
  eventBus.on('update.posted', wrap(handleUpdatePosted));
  // F4 — cross-phase stubs (dormant until F7/F13/F9 emit them).
  eventBus.on('webhook.received', wrap(handleWebhookReceived));
  eventBus.on('form.submitted', wrap(handleFormSubmitted));
  eventBus.on('lead.intake', wrap(handleLeadIntake));

  console.log('automation event dispatcher mounted');
};

module.exports = {
  mountAutomationEventDispatcher,
  evaluateConditions,
  evaluateGroupCreatedConditions,
  readCurrentStatusId,
  // Exported for unit tests.
  TRIGGER_MATCHERS,
  handleTaskTriggerEvent,
  // F5.4 loop-guard helpers (pure — unit-tested).
  MAX_CASCADE_DEPTH,
  cascadeDepthExceeded,
  originMatches,
};
