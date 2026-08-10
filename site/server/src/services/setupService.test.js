/**
 * setupService.test.js — first-run checklist rules. Pure, no DB. Run from the
 * server directory:
 *     node --test src/services/setupService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildChecklist, STEP_IDS, defaultCurrencyFor } = require('./setupService');

const EMPTY = {
  boardCount: 0,
  leadCount: 0,
  memberCount: 1,
  leadSourceCount: 0,
  hasBookingHours: false,
};
const byId = (result) => Object.fromEntries(result.steps.map((s) => [s.id, s.done]));

test('a brand-new workspace has only "workspace" done', () => {
  const r = buildChecklist(EMPTY, {});
  const done = byId(r);
  assert.equal(done.workspace, true);
  assert.equal(done.pipeline, false);
  assert.equal(done.firstLead, false);
  assert.equal(done.inviteTeam, false);
  assert.equal(done.leadSource, false);
  assert.equal(r.completed, 1);
  assert.equal(r.allDone, false);
});

test('steps derive from real data, not stored flags', () => {
  const r = buildChecklist(
    { boardCount: 2, leadCount: 37, memberCount: 4, leadSourceCount: 1, hasBookingHours: true },
    {}
  );
  const done = byId(r);
  assert.equal(done.pipeline, true);
  assert.equal(done.firstLead, true);
  assert.equal(done.inviteTeam, true);
  assert.equal(done.leadSource, true);
  assert.equal(done.businessHours, true);
});

test('a lone member does NOT count as an invited team', () => {
  assert.equal(byId(buildChecklist({ ...EMPTY, memberCount: 1 }, {})).inviteTeam, false);
  assert.equal(byId(buildChecklist({ ...EMPTY, memberCount: 2 }, {})).inviteTeam, true);
});

test('reality wins: a derivable step ignores a stale manualDone tick', () => {
  // Someone ticked "pipeline" manually but every board was later deleted.
  const r = buildChecklist(EMPTY, { manualDone: ['pipeline'] });
  assert.equal(byId(r).pipeline, false, 'stored tick must not override real state');
});

test('a step can un-complete when the underlying data goes away', () => {
  const withTeam = byId(buildChecklist({ ...EMPTY, memberCount: 3 }, {}));
  const afterLeaving = byId(buildChecklist({ ...EMPTY, memberCount: 1 }, {}));
  assert.equal(withTeam.inviteTeam, true);
  assert.equal(afterLeaving.inviteTeam, false);
});

test('non-derivable steps fall back to manualDone', () => {
  assert.equal(byId(buildChecklist(EMPTY, {})).installApp, false);
  assert.equal(byId(buildChecklist(EMPTY, { manualDone: ['installApp'] })).installApp, true);
});

test('percent + allDone track completion', () => {
  const full = buildChecklist(
    { boardCount: 1, leadCount: 1, memberCount: 2, leadSourceCount: 1, hasBookingHours: true },
    { manualDone: ['installApp'] }
  );
  assert.equal(full.completed, full.total);
  assert.equal(full.percent, 100);
  assert.equal(full.allDone, true);

  const none = buildChecklist(EMPTY, {});
  assert.equal(none.percent, Math.round((1 / none.total) * 100));
});

test('dismissed + wizardCompleted are surfaced from stored setup', () => {
  const r = buildChecklist(EMPTY, {
    checklistDismissed: true,
    wizardCompletedAt: new Date('2026-01-01'),
  });
  assert.equal(r.dismissed, true);
  assert.equal(r.wizardCompleted, true);

  const plain = buildChecklist(EMPTY, {});
  assert.equal(plain.dismissed, false);
  assert.equal(plain.wizardCompleted, false);
});

test('step ids are stable and unique (manualDone references them)', () => {
  assert.deepEqual(STEP_IDS, [
    'workspace',
    'pipeline',
    'firstLead',
    'inviteTeam',
    'leadSource',
    'businessHours',
    'installApp',
  ]);
  assert.equal(new Set(STEP_IDS).size, STEP_IDS.length);
});

test('malformed input degrades instead of throwing', () => {
  assert.equal(buildChecklist(undefined, undefined).completed, 1);
  assert.equal(buildChecklist({}, { manualDone: 'not-an-array' }).total, STEP_IDS.length);
});

test('currency defaults follow the country', () => {
  assert.equal(defaultCurrencyFor('CA'), 'CAD');
  assert.equal(defaultCurrencyFor('US'), 'USD');
  assert.equal(defaultCurrencyFor(null), '');
});
