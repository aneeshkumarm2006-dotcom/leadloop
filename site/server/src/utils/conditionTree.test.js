/**
 * conditionTree.test.js — unit tests for the automation condition-tree
 * evaluator + sanitizer (Phase 1b §1b.3). Pure logic — no DB.
 *
 *     node --test src/utils/conditionTree.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateConditionTree,
  sanitizeConditionTree,
  countTreeConditions,
} = require('./conditionTree');

// A tiny board with a few typed columns.
const board = {
  columns: [
    { _id: 'cBudget', type: 'number' },
    { _id: 'cEmail', type: 'email' },
    { _id: 'cStage', type: 'status', settings: { options: [{ id: 'new' }, { id: 'won' }] } },
    { _id: 'cDone', type: 'checkbox' },
  ],
};

const taskWith = (columnValues) => ({ columnValues });

// ---------------------------------------------------------------------------
// Evaluator — leaf ops
// ---------------------------------------------------------------------------
test('number compares: gt / lte', () => {
  const t = taskWith({ cBudget: 600000 });
  assert.equal(evaluateConditionTree(t, { columnId: 'cBudget', op: 'gt', value: 500000 }, board), true);
  assert.equal(evaluateConditionTree(t, { columnId: 'cBudget', op: 'gt', value: 700000 }, board), false);
  assert.equal(evaluateConditionTree(t, { columnId: 'cBudget', op: 'lte', value: 600000 }, board), true);
});

test('text contains / is_not_empty', () => {
  const t = taskWith({ cEmail: 'Lead@Example.com' });
  assert.equal(evaluateConditionTree(t, { columnId: 'cEmail', op: 'contains', value: 'example' }, board), true);
  assert.equal(evaluateConditionTree(t, { columnId: 'cEmail', op: 'is_not_empty' }, board), true);
  assert.equal(evaluateConditionTree(taskWith({}), { columnId: 'cEmail', op: 'is_not_empty' }, board), false);
});

test('status any_of / none_of', () => {
  const t = taskWith({ cStage: 'won' });
  assert.equal(evaluateConditionTree(t, { columnId: 'cStage', op: 'any_of', value: ['won'] }, board), true);
  assert.equal(evaluateConditionTree(t, { columnId: 'cStage', op: 'any_of', value: ['new'] }, board), false);
  assert.equal(evaluateConditionTree(t, { columnId: 'cStage', op: 'none_of', value: ['new'] }, board), true);
});

test('checkbox is_checked', () => {
  assert.equal(evaluateConditionTree(taskWith({ cDone: true }), { columnId: 'cDone', op: 'is_checked' }, board), true);
  assert.equal(evaluateConditionTree(taskWith({ cDone: false }), { columnId: 'cDone', op: 'is_checked' }, board), false);
});

// ---------------------------------------------------------------------------
// Evaluator — AND / OR nesting
// ---------------------------------------------------------------------------
test('AND group: all leaves must pass', () => {
  const t = taskWith({ cBudget: 600000, cDone: true });
  const tree = {
    conjunction: 'and',
    rules: [
      { columnId: 'cBudget', op: 'gt', value: 500000 },
      { columnId: 'cDone', op: 'is_checked' },
    ],
  };
  assert.equal(evaluateConditionTree(t, tree, board), true);
  assert.equal(evaluateConditionTree(taskWith({ cBudget: 600000, cDone: false }), tree, board), false);
});

test('OR group + nested AND', () => {
  const tree = {
    conjunction: 'or',
    rules: [
      { columnId: 'cStage', op: 'any_of', value: ['won'] },
      {
        conjunction: 'and',
        rules: [
          { columnId: 'cBudget', op: 'gte', value: 1000000 },
          { columnId: 'cDone', op: 'is_checked' },
        ],
      },
    ],
  };
  // matches via stage = won
  assert.equal(evaluateConditionTree(taskWith({ cStage: 'won' }), tree, board), true);
  // matches via the nested AND
  assert.equal(evaluateConditionTree(taskWith({ cBudget: 2000000, cDone: true }), tree, board), true);
  // neither branch
  assert.equal(evaluateConditionTree(taskWith({ cStage: 'new', cBudget: 100, cDone: false }), tree, board), false);
});

test('empty tree matches everything', () => {
  assert.equal(evaluateConditionTree(taskWith({}), { conjunction: 'and', rules: [] }, board), true);
  assert.equal(evaluateConditionTree(taskWith({}), null, board), true);
});

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------
test('sanitize: drops incomplete leaves, keeps valid ones', () => {
  const { tree, error } = sanitizeConditionTree(
    {
      conjunction: 'and',
      rules: [
        { columnId: 'cBudget', op: 'gt', value: 100 },
        { columnId: '', op: 'gt' }, // incomplete → dropped
        { op: 'is_empty' }, // no column → dropped
      ],
    },
    board
  );
  assert.equal(error, undefined);
  assert.equal(countTreeConditions(tree), 1);
});

test('sanitize: rejects an op illegal for the column type', () => {
  const { error } = sanitizeConditionTree(
    { conjunction: 'and', rules: [{ columnId: 'cEmail', op: 'gt', value: 5 }] },
    board
  );
  assert.match(error, /not valid for a email column/);
});

test('sanitize: rejects an unknown column', () => {
  const { error } = sanitizeConditionTree(
    { conjunction: 'and', rules: [{ columnId: 'cGhost', op: 'is_empty' }] },
    board
  );
  assert.match(error, /not on this board/);
});

test('sanitize: empty/no-condition tree normalises to null', () => {
  assert.equal(sanitizeConditionTree({ conjunction: 'and', rules: [] }, board).tree, null);
  assert.equal(sanitizeConditionTree(null, board).tree, null);
});
