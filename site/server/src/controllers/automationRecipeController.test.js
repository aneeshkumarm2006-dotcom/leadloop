/**
 * automationRecipeController.test.js — unit tests for the F6 recipe library
 * (F6.1 / F6.2 / F6.3 / F6.6).
 *
 * Pure — no DB. Exercises the seed catalogue shape (AC1) and the clone resolver
 * `buildAutomationFromRecipe` against an in-memory board fixture: column-key →
 * id resolution, status option resolution, the disabled-channel → incomplete
 * rule (AC4), the always-disabled clone (AC2), and overrides.
 *
 * Run from the server directory:
 *     node --test src/controllers/automationRecipeController.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

require('../models');
const { RECIPES } = require('../seeds/automationRecipes');
const { getActionType } = require('../utils/actionTypes');
const {
  buildAutomationFromRecipe,
  summariseRecipeRequirements,
  resolveColumnRef,
  resolveOptionRef,
} = require('./automationRecipeController');

const oid = () => new mongoose.Types.ObjectId();

// --- Board fixture: a real-estate leads board with the keys the seed targets --
const stageCol = oid();
const moveInCol = oid();
const viewingCol = oid();
const ownerCol = oid();
const agentCol = oid();

const board = {
  _id: oid(),
  organisation: oid(),
  statuses: [{ _id: oid(), key: 'not_started', isDefault: true, name: 'New' }],
  columns: [
    {
      _id: stageCol,
      key: 'stage',
      name: 'Stage',
      type: 'status',
      settings: {
        options: [
          { id: 'viewing_scheduled', label: 'Viewing Scheduled' },
          { id: 'qualified', label: 'Qualified' },
          { id: 'closed', label: 'Closed' },
          { id: 'lost', label: 'Lost' },
        ],
      },
    },
    { _id: moveInCol, key: 'move_in_date', name: 'Move-in Date', type: 'date', settings: {} },
    { _id: viewingCol, key: 'viewing_date', name: 'Viewing Date', type: 'date', settings: {} },
    { _id: ownerCol, key: 'owner', name: 'Owner', type: 'person', settings: {} },
    { _id: agentCol, key: 'agent', name: 'Agent', type: 'person', settings: {} },
  ],
};

const userId = oid();
const recipeBySlug = (slug) => RECIPES.find((r) => r.slug === slug);

// ===========================================================================
// Seed catalogue (AC1)
// ===========================================================================
test('seed: ≥8 recipes including the four named ones', () => {
  assert.ok(RECIPES.length >= 8, `expected ≥8 recipes, got ${RECIPES.length}`);
  for (const slug of [
    'new-lead-assign-agent-welcome',
    'viewing-scheduled-calendar-sms',
    'move-in-7-days-notify-owner',
    'stage-closed-post-webhook',
  ]) {
    assert.ok(recipeBySlug(slug), `missing named recipe ${slug}`);
  }
});

test('seed: slugs are unique and every trigger/action type is known', () => {
  const slugs = RECIPES.map((r) => r.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug in seed');
  for (const r of RECIPES) {
    assert.ok(r.name && r.description, `${r.slug} missing name/description`);
    for (const a of r.actions) {
      assert.ok(getActionType(a.type), `${r.slug}: unknown action type ${a.type}`);
    }
  }
});

// ===========================================================================
// resolveColumnRef / resolveOptionRef
// ===========================================================================
test('resolveColumnRef maps a column key to its id, and reports unresolved', () => {
  const ok = resolveColumnRef(board, 'stage');
  assert.equal(ok.resolved, true);
  assert.equal(ok.id, stageCol.toString());

  const byId = resolveColumnRef(board, stageCol.toString());
  assert.equal(byId.resolved, true);

  const missing = resolveColumnRef(board, 'nonexistent_key');
  assert.equal(missing.resolved, false);
  assert.equal(missing.provided, true);
  assert.equal(missing.id, '');
});

test('resolveOptionRef matches option id or label, case-insensitively', () => {
  const stage = board.columns[0];
  assert.equal(resolveOptionRef(stage, 'viewing_scheduled').value, 'viewing_scheduled');
  assert.equal(resolveOptionRef(stage, 'Viewing Scheduled').value, 'viewing_scheduled');
  assert.equal(resolveOptionRef(stage, 'nope').resolved, false);
});

// ===========================================================================
// buildAutomationFromRecipe (AC2 / AC4)
// ===========================================================================
test('clone is always disabled (AC2)', () => {
  for (const r of RECIPES) {
    const { doc } = buildAutomationFromRecipe(r, board, { userId });
    assert.equal(doc.enabled, false, `${r.slug} cloned enabled`);
    assert.equal(doc.board, board._id);
    assert.equal(doc.organisation, board.organisation);
    assert.equal(doc.createdBy, userId);
  }
});

test('STATUS_BECAME clone resolves column + option; channel actions → incomplete (AC4)', () => {
  const { doc, validation, warnings } = buildAutomationFromRecipe(
    recipeBySlug('viewing-scheduled-calendar-sms'),
    board,
    { userId }
  );
  assert.equal(doc.triggerType, 'STATUS_BECAME');
  assert.equal(doc.triggerConfig.columnId, stageCol.toString());
  assert.equal(doc.triggerConfig.toValue, 'viewing_scheduled');
  // CREATE_CALENDAR_EVENT (CALENDAR) + SEND_SMS (F10) are un-shipped → incomplete.
  assert.equal(validation, 'incomplete');
  assert.equal(doc.validation, 'incomplete');
  assert.ok(warnings.some((w) => /SMS/.test(w)));
  assert.ok(warnings.some((w) => /Calendar/.test(w)));
});

test('DATE_ARRIVED clone folds comparison into a signed offset and completes when fully bound', () => {
  const { doc, validation } = buildAutomationFromRecipe(
    recipeBySlug('move-in-7-days-notify-owner'),
    board,
    { userId }
  );
  assert.equal(doc.triggerType, 'DATE_ARRIVED');
  assert.equal(doc.triggerConfig.columnId, moveInCol.toString());
  // recipe says offsetDays:7, comparison:'before' → persisted -7 (sanitizer folds sign).
  assert.equal(doc.triggerConfig.offsetDays, -7);
  assert.equal(doc.triggerConfig.comparison, 'before');
  // NOTIFY_PERSON(owner) resolves + no channel → complete.
  assert.equal(validation, 'complete');
  assert.equal(doc.actions[0].config.userIdOrColumnRef, ownerCol.toString());
});

test('STATUS_BECAME + NOTIFY_PERSON(agent) completes when the agent column exists', () => {
  const { doc, validation } = buildAutomationFromRecipe(
    recipeBySlug('stage-qualified-notify-agent'),
    board,
    { userId }
  );
  assert.equal(doc.triggerConfig.toValue, 'qualified');
  assert.equal(doc.actions[0].config.userIdOrColumnRef, agentCol.toString());
  assert.equal(validation, 'complete');
});

test('ITEM_CREATED + CREATE_SUBITEM clone completes even on a column-less board', () => {
  const bareBoard = { _id: oid(), organisation: oid(), statuses: [], columns: [] };
  const { doc, validation } = buildAutomationFromRecipe(
    recipeBySlug('new-lead-onboarding-checklist'),
    bareBoard,
    { userId }
  );
  assert.equal(validation, 'complete');
  assert.equal(doc.actions.length, 3);
  assert.ok(doc.actions.every((a) => a.type === 'CREATE_SUBITEM'));
});

test('MOVE_TO_GROUP with no bound group → incomplete, action retained for the user', () => {
  const { doc, validation } = buildAutomationFromRecipe(
    recipeBySlug('stage-lost-archive'),
    board,
    { userId }
  );
  assert.equal(validation, 'incomplete');
  assert.equal(doc.actions[0].type, 'MOVE_TO_GROUP');
});

test('unresolvable trigger column → incomplete with no bound columnId', () => {
  const noStageBoard = {
    _id: oid(),
    organisation: oid(),
    statuses: [],
    columns: [{ _id: oid(), key: 'other', name: 'Other', type: 'text', settings: {} }],
  };
  const { doc, validation } = buildAutomationFromRecipe(
    recipeBySlug('stage-closed-post-webhook'),
    noStageBoard,
    { userId }
  );
  assert.equal(validation, 'incomplete');
  assert.equal(doc.triggerConfig.columnId, undefined);
});

test('overrides.name is applied to the cloned automation', () => {
  const { doc } = buildAutomationFromRecipe(recipeBySlug('stage-closed-post-webhook'), board, {
    userId,
    overrides: { name: 'My custom name' },
  });
  assert.equal(doc.name, 'My custom name');
});

// ===========================================================================
// summariseRecipeRequirements
// ===========================================================================
test('summariseRecipeRequirements lists channel chips + dormant trigger flag', () => {
  const viewing = summariseRecipeRequirements(recipeBySlug('viewing-scheduled-calendar-sms'));
  const labels = viewing.requiresSetup.map((x) => x.label);
  assert.ok(labels.includes('SMS'));
  assert.ok(labels.includes('Calendar'));
  assert.equal(viewing.triggerDormant, false);

  const move = summariseRecipeRequirements(recipeBySlug('move-in-7-days-notify-owner'));
  assert.equal(move.requiresSetup.length, 0);

  const form = summariseRecipeRequirements(recipeBySlug('offer-form-submitted-notify'));
  assert.equal(form.triggerDormant, true);
});
