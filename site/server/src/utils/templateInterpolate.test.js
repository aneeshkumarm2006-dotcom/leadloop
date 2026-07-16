/**
 * templateInterpolate.test.js — unit tests for the F5.5 variable substitution
 * engine: `{{Column Name}}` + `{{user.displayName}}` resolution, value rendering
 * (status label, date), and the missing-variable fallback.
 *
 * Run from the server directory:
 *     node --test src/utils/templateInterpolate.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { interpolate, findVariables } = require('./templateInterpolate');

const oid = () => new mongoose.Types.ObjectId();
const nameCol = oid();
const stageCol = oid();
const dateCol = oid();

const board = {
  columns: [
    { _id: nameCol, name: 'Lead Name', type: 'text', settings: {} },
    {
      _id: stageCol,
      name: 'Stage',
      type: 'status',
      settings: { options: [{ id: 'qualified', label: 'Qualified' }] },
    },
    { _id: dateCol, name: 'Move-in Date', type: 'date', settings: {} },
  ],
};

const task = {
  columnValues: new Map([
    [nameCol.toString(), 'Jane Doe'],
    [stageCol.toString(), 'qualified'],
    [dateCol.toString(), '2026-06-15T00:00:00.000Z'],
  ]),
};

test('interpolate: substitutes column names (case-insensitive) and renders values', () => {
  const out = interpolate('Hi {{Lead Name}}, viewing scheduled for {{Move-in Date}}', { task, board });
  assert.equal(out, 'Hi Jane Doe, viewing scheduled for Jun 15, 2026');
});

test('interpolate: status columns render the option label, not the raw id', () => {
  assert.equal(interpolate('Stage is {{Stage}}', { task, board }), 'Stage is Qualified');
  // case-insensitive column match
  assert.equal(interpolate('{{stage}}', { task, board }), 'Qualified');
});

test('interpolate: {{user.displayName}} resolves to the user name', () => {
  assert.equal(interpolate('Hello {{user.displayName}}', { user: { name: 'Agent Smith' } }), 'Hello Agent Smith');
  assert.equal(interpolate('{{user.email}}', { user: { email: 'a@b.com' } }), 'a@b.com');
});

test('interpolate: unknown variables fall back to empty string by default', () => {
  assert.equal(interpolate('X {{Nonexistent}} Y', { task, board }), 'X  Y');
  // a column whose cell is empty also yields empty
  const emptyTask = { columnValues: new Map() };
  assert.equal(interpolate('[{{Lead Name}}]', { task: emptyTask, board }), '[]');
});

test('interpolate: onMissing override can preserve the token', () => {
  const out = interpolate('Hi {{Nope}}', { task, board }, { onMissing: (t) => `{{${t}}}` });
  assert.equal(out, 'Hi {{Nope}}');
});

test('interpolate: returns the input unchanged when there are no tokens', () => {
  assert.equal(interpolate('plain text', { task, board }), 'plain text');
  assert.equal(interpolate('', {}), '');
  assert.equal(interpolate(undefined, {}), '');
});

test('findVariables: lists distinct tokens', () => {
  assert.deepEqual(
    findVariables('{{Lead Name}} {{Move-in Date}} {{Lead Name}} {{user.displayName}}'),
    ['Lead Name', 'Move-in Date', 'user.displayName']
  );
});
