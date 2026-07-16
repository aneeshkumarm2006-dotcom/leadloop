/**
 * actionTypes.test.js — unit tests for the F5 action registry (F5.1 / F5.8).
 *
 * Covers every action's validate happy + sad path, SET_COLUMN_VALUE.execute
 * write-through + loop-guard event tagging (AC1 / AC5), and the disabled-channel
 * contracts logging a `skipped` outcome with a composed message (AC2 / AC4).
 *
 * Pure — no DB. Side-effecting execute paths are exercised with a fake task
 * (Map-backed columnValues + stubbed save) and the real eventBus to capture
 * emitted events.
 *
 * Run from the server directory:
 *     node --test src/utils/actionTypes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

require('../models');
const eventBus = require('../services/eventBus');
const {
  actionTypes,
  getActionType,
  validateActionConfig,
  buildActionCatalog,
  DISABLED_REASON,
} = require('./actionTypes');

const oid = () => new mongoose.Types.ObjectId();

// --- Board / group fixtures -------------------------------------------------
const stageCol = oid();
const ownerCol = oid();
const dateCol = oid();
const nameCol = oid();
const phoneCol = oid();
const groupA = oid();

const board = {
  statuses: [{ _id: oid(), key: 'not_started', isDefault: true, name: 'New' }],
  columns: [
    { _id: nameCol, name: 'Lead Name', type: 'text', settings: {} },
    {
      _id: stageCol,
      name: 'Stage',
      type: 'status',
      settings: { options: [{ id: 'contacted', label: 'Contacted' }, { id: 'qualified', label: 'Qualified' }] },
    },
    { _id: ownerCol, name: 'Owner', type: 'person', settings: {} },
    { _id: dateCol, name: 'Move-in Date', type: 'date', settings: {} },
    { _id: phoneCol, name: 'Phone', type: 'phone', settings: {} },
  ],
};
const groups = [{ _id: groupA, name: 'Leads' }];
const ctx = { board, groups, memberIds: null };

const fakeTask = (entries = {}) => ({
  _id: oid(),
  group: groupA,
  columnValues: new Map(Object.entries(entries)),
  _saved: 0,
  async save() {
    this._saved += 1;
  },
});

// ===========================================================================
// Catalog / disabled wiring
// ===========================================================================
test('catalog: 15 actions; unshipped channel contracts disabled, shipped actions enabled', () => {
  const catalog = buildActionCatalog();
  assert.equal(catalog.length, 15);
  const byType = Object.fromEntries(catalog.map((c) => [c.type, c]));
  // Phase 4 — email sequence enrollment is always enabled (no channel gate).
  assert.equal(byType.ENROLL_IN_SEQUENCE.disabled, false);
  assert.equal(byType.ENROLL_IN_SEQUENCE.requires, null);
  assert.equal(byType.CREATE_TASK.disabled, false);
  assert.equal(byType.SET_COLUMN_VALUE.disabled, false);
  assert.equal(byType.NOTIFY_PERSON.disabled, false);
  // Phase 1b item-management actions — always enabled (no channel dependency).
  assert.equal(byType.CLEAR_COLUMN.disabled, false);
  assert.equal(byType.DUPLICATE_ITEM.disabled, false);
  assert.equal(byType.DELETE_ITEM.disabled, false);
  // F7 + F8 + F9 + F10 + F11 have shipped → those actions enabled.
  assert.equal(byType.POST_WEBHOOK.disabled, false);
  assert.equal(byType.SEND_EMAIL.disabled, false);
  assert.equal(byType.SEND_EMAIL.requires, 'F8');
  assert.equal(byType.ASSIGN_LEAD_AGENT.disabled, false);
  assert.equal(byType.SEND_SMS.disabled, false);
  assert.equal(byType.SEND_SMS.requires, 'F10');
  // F11 has shipped → SEND_WHATSAPP enabled.
  assert.equal(byType.SEND_WHATSAPP.disabled, false);
  assert.equal(byType.SEND_WHATSAPP.requires, 'F11');
  assert.ok(Array.isArray(byType.SET_COLUMN_VALUE.configSchema.fields));
  // F5.3 catalog contract: each entry carries a static `describe` label.
  assert.equal(byType.SET_COLUMN_VALUE.describe, 'Set a column value');
  catalog.forEach((c) => assert.equal(typeof c.describe, 'string'));
});

// ===========================================================================
// SET_COLUMN_VALUE — AC1 + AC5
// ===========================================================================
test('SET_COLUMN_VALUE.validate: accepts a valid status option, rejects unknowns', () => {
  const ok = actionTypes.SET_COLUMN_VALUE.validate({ columnId: stageCol, value: 'qualified' }, ctx);
  assert.equal(ok.columnId, stageCol.toString());
  assert.equal(ok.value, 'qualified');

  assert.throws(() => actionTypes.SET_COLUMN_VALUE.validate({ columnId: oid(), value: 'x' }, ctx));
  assert.throws(() => actionTypes.SET_COLUMN_VALUE.validate({ columnId: stageCol, value: 'nope' }, ctx));
});

test('SET_COLUMN_VALUE.execute: writes through + tags downstream events (origin + cascade depth)', async () => {
  const task = fakeTask({ [stageCol.toString()]: 'contacted' });
  const automation = { _id: oid(), board: oid() };

  const captured = [];
  const onCol = (p) => captured.push(['col', p]);
  const onStatus = (p) => captured.push(['status', p]);
  eventBus.on('task.column_changed', onCol);
  eventBus.on('task.status_became', onStatus);

  try {
    const result = await actionTypes.SET_COLUMN_VALUE.execute({
      task,
      board,
      automation,
      config: { columnId: stageCol, value: 'qualified' },
      cascadeDepth: 2,
    });
    assert.equal(result.status, 'ok');
    assert.equal(task.columnValues.get(stageCol.toString()), 'qualified'); // persisted on the task
    assert.equal(task._saved, 1);

    const colEvent = captured.find(([k]) => k === 'col');
    const statusEvent = captured.find(([k]) => k === 'status');
    assert.ok(colEvent, 'emits task.column_changed');
    assert.ok(statusEvent, 'emits task.status_became for a status column');
    // AC5 loop guard: origin tag = the writing automation; cascade depth bumped.
    assert.equal(colEvent[1]._originAutomationId.toString(), automation._id.toString());
    assert.equal(colEvent[1]._cascadeDepth, 3);
  } finally {
    eventBus.off('task.column_changed', onCol);
    eventBus.off('task.status_became', onStatus);
  }
});

test('SET_COLUMN_VALUE.execute: no event when the value is unchanged', async () => {
  const task = fakeTask({ [stageCol.toString()]: 'qualified' });
  const automation = { _id: oid(), board: oid() };
  let emitted = 0;
  const onCol = () => { emitted += 1; };
  eventBus.on('task.column_changed', onCol);
  try {
    const result = await actionTypes.SET_COLUMN_VALUE.execute({
      task,
      board,
      automation,
      config: { columnId: stageCol, value: 'qualified' },
      cascadeDepth: 0,
    });
    assert.equal(result.status, 'ok');
    assert.equal(emitted, 0, 'unchanged write does not chain');
  } finally {
    eventBus.off('task.column_changed', onCol);
  }
});

test('SET_COLUMN_VALUE.describe: renders the option label', () => {
  const d = actionTypes.SET_COLUMN_VALUE.describe({ columnId: stageCol, value: 'qualified' }, ctx);
  assert.equal(d, 'Set Stage to "Qualified"');
});

// ===========================================================================
// MOVE_TO_GROUP
// ===========================================================================
test('MOVE_TO_GROUP.validate: requires a group on the board', () => {
  assert.equal(actionTypes.MOVE_TO_GROUP.validate({ groupId: groupA }, ctx).groupId, groupA.toString());
  assert.throws(() => actionTypes.MOVE_TO_GROUP.validate({ groupId: 'nope' }, ctx));
  assert.throws(() => actionTypes.MOVE_TO_GROUP.validate({ groupId: oid() }, ctx)); // valid id, not on board
});

test('MOVE_TO_GROUP.execute: relocates the task', async () => {
  const task = fakeTask();
  const dest = groupA.toString();
  const result = await actionTypes.MOVE_TO_GROUP.execute({ task, config: { groupId: dest } });
  assert.equal(result.status, 'ok');
  assert.equal(task.group, dest);
  assert.equal(task._saved, 1);
});

// ===========================================================================
// NOTIFY_PERSON
// ===========================================================================
test('NOTIFY_PERSON.validate: needs a target + message; accepts a person column', () => {
  const ok = actionTypes.NOTIFY_PERSON.validate(
    { userIdOrColumnRef: ownerCol, message: 'Hi {{Lead Name}}', sendEmailDigest: true },
    ctx
  );
  assert.equal(ok.userIdOrColumnRef, ownerCol.toString());
  assert.equal(ok.sendEmailDigest, true);
  // direct user id is also a valid ref
  assert.ok(actionTypes.NOTIFY_PERSON.validate({ userIdOrColumnRef: oid(), message: 'x' }, ctx));
  assert.throws(() => actionTypes.NOTIFY_PERSON.validate({ userIdOrColumnRef: ownerCol, message: '' }, ctx));
  assert.throws(() => actionTypes.NOTIFY_PERSON.validate({ userIdOrColumnRef: 'not-a-ref', message: 'x' }, ctx));
});

// ===========================================================================
// CREATE_TASK / CREATE_SUBITEM
// ===========================================================================
test('CREATE_TASK.validate: requires name + a board group', () => {
  const ok = actionTypes.CREATE_TASK.validate({ name: 'Follow up', group: groupA, priority: 'high' }, ctx);
  assert.equal(ok.name, 'Follow up');
  assert.equal(ok.group, groupA.toString());
  assert.equal(ok.priority, 'high');
  assert.throws(() => actionTypes.CREATE_TASK.validate({ name: 'x' }, ctx)); // no group
  assert.throws(() => actionTypes.CREATE_TASK.validate({ group: groupA }, ctx)); // no name
  assert.throws(() => actionTypes.CREATE_TASK.validate({ name: 'x', group: oid() }, ctx)); // group not on board
});

test('CREATE_SUBITEM.validate: name only (group inherited)', () => {
  const ok = actionTypes.CREATE_SUBITEM.validate({ name: 'Sub', assignedTo: [] }, ctx);
  assert.equal(ok.name, 'Sub');
  assert.equal(ok.group, undefined);
  assert.throws(() => actionTypes.CREATE_SUBITEM.validate({ name: '   ' }, ctx));
});

test('CREATE_SUBITEM.execute: skipped without a triggering task', async () => {
  const out = await actionTypes.CREATE_SUBITEM.execute({ task: null, config: { name: 'Sub' }, automation: {}, board });
  assert.equal(out.status, 'skipped');
});

// ===========================================================================
// Disabled channel contracts — AC2 (compose) + AC4 (skipped reason)
// ===========================================================================
test('SEND_EMAIL.validate: requires "to" + (body | template)', () => {
  const ok = actionTypes.SEND_EMAIL.validate({ to: oid(), subject: 'Hi', body: 'Hello {{Lead Name}}' }, ctx);
  assert.ok(ok.to);
  assert.throws(() => actionTypes.SEND_EMAIL.validate({ subject: 'x', body: 'y' }, ctx)); // no to
  assert.throws(() => actionTypes.SEND_EMAIL.validate({ to: oid() }, ctx)); // no body/template
});

test('SEND_EMAIL.execute (F8 live): skips cleanly when no recipient resolves', async () => {
  // F8 ships SEND_EMAIL; with an unresolvable `to` (not a column / user id /
  // address) it returns a skip WITHOUT touching the DB or sending — the happy
  // path (recipient + mailbox) is covered by the F8.8 acceptance run.
  const task = fakeTask({ [nameCol.toString()]: 'Jane Doe' });
  const out = await actionTypes.SEND_EMAIL.execute({
    task,
    board,
    automation: { organisation: oid(), createdBy: oid() },
    config: { to: 'not-a-resolvable-ref', subject: 'Viewing', body: 'Hi {{Lead Name}}' },
  });
  assert.equal(out.status, 'skipped');
  assert.equal(out.payloadSummary.reason, 'No email recipient resolved');
});

test('ASSIGN_LEAD_AGENT: registered (F9 shipped), validates empty config, skips without a task', async () => {
  assert.ok(getActionType('ASSIGN_LEAD_AGENT'));
  assert.equal(actionTypes.ASSIGN_LEAD_AGENT.disabled, false);
  assert.deepEqual(actionTypes.ASSIGN_LEAD_AGENT.validate({}), {});
  // No triggering task → a clean skip (the policy path needs a lead task).
  const out = await actionTypes.ASSIGN_LEAD_AGENT.execute({});
  assert.equal(out.status, 'skipped');
});

test('SEND_SMS.execute (F10 live): skips cleanly when no phone resolves', async () => {
  // The fixture board has no phone column → the lead's number can't be resolved,
  // so the action skips WITHOUT touching the DB or the provider. The send path
  // (config + opt-out gate + footer) is covered by smsService.test.js + the
  // F10.7 acceptance run.
  const task = fakeTask({ [nameCol.toString()]: 'Jane Doe' }); // phone column unset
  const out = await actionTypes.SEND_SMS.execute({
    task,
    board,
    automation: { organisation: oid() },
    config: { to: phoneCol, template: 'Hi {{Lead Name}}' },
  });
  assert.equal(out.status, 'skipped');
  assert.equal(out.payloadSummary.reason, 'No phone recipient resolved');
});

test('POST_WEBHOOK / SEND_SMS / SEND_WHATSAPP / CREATE_CALENDAR_EVENT validate their shape', () => {
  assert.throws(() => actionTypes.POST_WEBHOOK.validate({}, ctx));
  assert.equal(actionTypes.POST_WEBHOOK.validate({ endpointId: 'ep_1' }, ctx).endpointId, 'ep_1');

  assert.throws(() => actionTypes.SEND_SMS.validate({ to: phoneCol }, ctx)); // no message
  assert.ok(actionTypes.SEND_SMS.validate({ to: phoneCol, template: 'hi' }, ctx));
  assert.throws(() => actionTypes.SEND_SMS.validate({ to: ownerCol, template: 'hi' }, ctx)); // person col, not phone
  assert.throws(() => actionTypes.SEND_SMS.validate({ to: oid(), template: 'hi' }, ctx)); // not a board column

  assert.throws(() => actionTypes.SEND_WHATSAPP.validate({ to: phoneCol }, ctx)); // no templateId
  assert.ok(actionTypes.SEND_WHATSAPP.validate({ to: phoneCol, templateId: 't1' }, ctx));
  assert.throws(() => actionTypes.SEND_WHATSAPP.validate({ to: ownerCol, templateId: 't1' }, ctx)); // person col, not phone
  assert.throws(() => actionTypes.SEND_WHATSAPP.validate({ to: oid(), templateId: 't1' }, ctx)); // not a board column

  assert.throws(() => actionTypes.CREATE_CALENDAR_EVENT.validate({}, ctx)); // no title
  const cal = actionTypes.CREATE_CALENDAR_EVENT.validate({ title: 'Viewing', startsAtColumnRef: dateCol }, ctx);
  assert.equal(cal.calendarRef, 'internal');
  assert.equal(cal.startsAtColumnRef, dateCol.toString());
  assert.throws(() => actionTypes.CREATE_CALENDAR_EVENT.validate({ title: 'x', startsAtColumnRef: stageCol }, ctx)); // not a date col
});

// ===========================================================================
// validateActionConfig wrapper
// ===========================================================================
test('validateActionConfig: { ok, config } on success, { ok:false, error } on bad type/shape', () => {
  const good = validateActionConfig('SET_COLUMN_VALUE', { columnId: stageCol, value: 'qualified' }, ctx);
  assert.equal(good.ok, true);
  assert.equal(good.config.value, 'qualified');

  const badType = validateActionConfig('NOPE', {}, ctx);
  assert.equal(badType.ok, false);
  assert.match(badType.error, /Invalid action type/);

  const badShape = validateActionConfig('CREATE_TASK', { name: 'x' }, ctx);
  assert.equal(badShape.ok, false);
});
