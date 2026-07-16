/**
 * webhookInboundResolver.js — inbound webhook → task (Phase 3, F7.3).
 *
 * Resolves a public `:token` to its enabled inbound `WebhookEndpoint`, applies
 * the endpoint's `mapping` (`{ [columnId]: jsonPath }`) to the request body,
 * creates a board task with the mapped column values, records a `delivered`
 * `WebhookDelivery` audit row, and emits the domain events that wake up
 * automations and (later) the F9 intake policy:
 *
 *   - `item.created`     — so ITEM_CREATED automations treat the lead like any
 *                          new item;
 *   - `webhook.received` — drives WEBHOOK_RECEIVED-trigger automations (matched
 *                          by `endpointId`);
 *   - `lead.intake`      — the F9 lead-intake-policy signal (dormant until F9).
 *
 * AC5: a mapping path that resolves to nothing leaves the column unset, logs a
 * structured warning `{ endpointId, columnId, missingPath }`, and the task is
 * still created with whatever paths resolved.
 */

const Board = require('../models/Board');
const WebhookEndpoint = require('../models/WebhookEndpoint');
const WebhookDelivery = require('../models/WebhookDelivery');
const eventBus = require('./eventBus');
const { getByPath } = require('../utils/getByPath');
const { createTaskWithColumnValues } = require('./taskCreation');

const asId = (v) => (v == null ? '' : v.toString());

class WebhookResolveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Apply `mapping` to `body`, returning `{ columnValues, missing }`. Each entry
 * whose json-path resolves to `undefined` is recorded in `missing` (AC5) and
 * left out of `columnValues` so the column stays unset.
 */
const applyMapping = (mapping, body) => {
  const columnValues = {};
  const missing = [];
  for (const [columnId, jsonPath] of Object.entries(mapping || {})) {
    const value = getByPath(body, jsonPath);
    if (value === undefined) {
      missing.push({ columnId: asId(columnId), missingPath: jsonPath });
      continue;
    }
    columnValues[asId(columnId)] = value;
  }
  return { columnValues, missing };
};

/**
 * Process an inbound webhook delivery.
 *
 * @param {string} token - the `:token` path segment
 * @param {Object} body  - parsed JSON request body
 * @returns {Promise<{ taskId, endpointId, deliveryId, warnings }>}
 * @throws {WebhookResolveError} 404 unknown/disabled token; 422 board missing
 */
const resolveInbound = async (token, body) => {
  if (!token) throw new WebhookResolveError(404, 'Unknown webhook endpoint');

  const endpoint = await WebhookEndpoint.findOne({
    token,
    direction: 'in',
    enabled: true,
  });
  if (!endpoint) throw new WebhookResolveError(404, 'Unknown webhook endpoint');

  const board = await Board.findById(endpoint.boardId).select(
    'statuses columns useFlexibleColumns organisation createdBy'
  );
  if (!board) throw new WebhookResolveError(422, 'Endpoint board no longer exists');

  const { columnValues, missing } = applyMapping(endpoint.mapping, body);

  // AC5: log each unresolved path; the task is still created without it.
  for (const m of missing) {
    console.warn(
      '[webhook/inbound] mapping path resolved to nothing',
      JSON.stringify({ endpointId: asId(endpoint._id), columnId: m.columnId, missingPath: m.missingPath })
    );
  }

  const { task, warnings } = await createTaskWithColumnValues({
    board,
    columnValues,
    createdBy: endpoint.createdBy || board.createdBy,
  });

  // Audit row — the inbound payload is preserved for the delivery log.
  let delivery = null;
  try {
    delivery = await WebhookDelivery.create({
      endpointId: endpoint._id,
      direction: 'in',
      payload: body,
      status: 'delivered',
      attempt: 1,
    });
  } catch (err) {
    // The task is the deliverable — a failed audit write must not 500 the call.
    console.error('[webhook/inbound] failed to write delivery row:', err?.message || err);
  }

  // Fan out domain events. The task is a real external lead (not automation
  // created), so it flows through ITEM_CREATED automations normally.
  const eventPayload = {
    taskId: task._id,
    boardId: board._id,
    endpointId: endpoint._id,
    payload: body,
  };
  eventBus.emit('item.created', {
    taskId: task._id,
    boardId: board._id,
    groupId: task.group,
    statusId: task.status,
    createdByUserId: asId(endpoint.createdBy || board.createdBy),
  });
  eventBus.emit('webhook.received', eventPayload);
  eventBus.emit('lead.intake', eventPayload);

  return {
    taskId: task._id,
    endpointId: endpoint._id,
    deliveryId: delivery ? delivery._id : null,
    warnings: [...missing.map((m) => ({ ...m, reason: 'missing_path' })), ...warnings],
  };
};

module.exports = {
  resolveInbound,
  applyMapping,
  WebhookResolveError,
};
