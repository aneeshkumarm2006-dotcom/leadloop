/**
 * automationActionRunner.js — executes an automation's actions through the
 * `actionTypes.js` registry (Phase 2, F5.4).
 *
 * This is the single execution path that replaced the legacy if/else action
 * loop. For each action it:
 *   1. looks up the registry entry and calls `execute(context)`;
 *   2. writes one `AutomationRunLog` row per attempt (`ok` / `failed` /
 *      `skipped`) with a redacted `payloadSummary`;
 *   3. emits one `automation.run` activity event per row (rolled up by `runId`);
 *   4. returns the per-action outcomes (same shape as `triggerHistory.actionsRun`
 *      so the run-log drawer and the audit table agree) and the last task touched.
 *
 * Callers:
 *   - the event dispatcher (F4 task triggers) — uses `outcomes` for triggerHistory;
 *   - the hourly date runner (DATE_ARRIVED);
 *   - the controller's `runAutomationOnce` (ITEM_CREATED dispatch + "Run now").
 *
 * Loop-guard context (`originAutomationId`, `cascadeDepth`) is threaded into each
 * `execute` so a SET_COLUMN_VALUE write tags its downstream events correctly.
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
const AutomationRunLog = require('../models/AutomationRunLog');
const { getActionType } = require('../utils/actionTypes');
const { logAutomationRun } = require('./activityService');

const asId = (v) => (v == null ? '' : v.toString());

/**
 * Run every action on `automation` in order.
 *
 * @param {Object} automation - the Automation doc (reads `actions[]`)
 * @param {Object} [ctx]
 * @param {Object} [ctx.triggeringTask] - task that fired the automation
 * @param {Object} [ctx.board]          - pre-loaded board (statuses+columns); loaded if absent
 * @param {Object} [ctx.prior]          - prior event payload (fromValue/toValue/…)
 * @param {string|ObjectId} [ctx.actorId]
 * @param {number} [ctx.cascadeDepth]   - incoming cross-automation cascade depth
 * @returns {Promise<{ outcomes: Array, lastTask: Object|null }>}
 */
const runActions = async (automation, ctx = {}) => {
  const actions = Array.isArray(automation.actions) ? automation.actions : [];
  const outcomes = [];
  let lastTask = null;
  if (actions.length === 0) return { outcomes, lastTask };

  const board =
    ctx.board ||
    (await Board.findById(automation.board).select('statuses columns useFlexibleColumns'));

  const triggeringTask = ctx.triggeringTask || null;
  const runId = new mongoose.Types.ObjectId();

  for (const action of actions) {
    const entry = getActionType(action.type);
    let outcome;
    let actedTaskId = triggeringTask ? triggeringTask._id : null;
    let payloadSummary = null;

    if (!entry) {
      outcome = {
        actionType: action.type,
        status: 'failed',
        error: `Unknown action type "${action.type}"`,
      };
    } else {
      try {
        const result =
          (await entry.execute({
            task: triggeringTask,
            board,
            automation,
            action,
            config: action.config || {},
            prior: ctx.prior || null,
            actorId: ctx.actorId || null,
            originAutomationId: automation._id,
            cascadeDepth: Number(ctx.cascadeDepth) || 0,
          })) || {};
        const status = result.status || 'ok';
        if (result.task) {
          lastTask = result.task;
          actedTaskId = result.task._id;
        }
        payloadSummary = result.payloadSummary || null;
        outcome = {
          actionType: action.type,
          status,
          ...(result.error ? { error: result.error } : {}),
        };
      } catch (err) {
        outcome = { actionType: action.type, status: 'failed', error: err.message };
      }
    }

    // Durable audit row — best-effort: a logging failure must not abort the run.
    try {
      await AutomationRunLog.create({
        automationId: automation._id,
        taskId: actedTaskId || null,
        runId,
        actionType: outcome.actionType,
        status: outcome.status,
        error: outcome.error || null,
        payloadSummary,
      });
    } catch (err) {
      console.error('[automation/runActions] failed to write run-log row:', err?.message || err);
    }

    // Activity event (fire-and-forget; swallows its own errors).
    logAutomationRun({
      task: lastTask || triggeringTask,
      actor: automation.createdBy,
      automationId: automation._id,
      actionType: outcome.actionType,
      status: outcome.status,
      runId,
      error: outcome.error || null,
    });

    outcomes.push(outcome);
  }

  return { outcomes, lastTask };
};

module.exports = {
  runActions,
  asId,
};
