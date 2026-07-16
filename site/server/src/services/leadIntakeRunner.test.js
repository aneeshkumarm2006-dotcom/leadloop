/**
 * leadIntakeRunner.test.js — unit tests for the F9 Automated Lead Agent's pure
 * owner-resolution logic (F9.6 AC2 / AC4). DB-free: exercises the round-robin
 * slot math, the geoMap union/lookup helpers, the `fixed`/`geo-direct`
 * resolution paths (which never touch Mongo), and the overall-status roll-up.
 *
 * Run from the server directory:
 *     node --test src/services/leadIntakeRunner.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  roundRobinSlot,
  geoMapUserUnion,
  geoLookup,
  resolveOwner,
  overallStatus,
} = require('./leadIntakeRunner');

// ---------------------------------------------------------------------------
// AC2 — round-robin cycles deterministically over six consecutive leads.
// ---------------------------------------------------------------------------
test('roundRobinSlot: three users cycle deterministically over six leads', () => {
  // The runner advances the cursor 0,1,2,3,4,5 across six leads.
  const slots = [0, 1, 2, 3, 4, 5].map((cursor) => roundRobinSlot(cursor, 3));
  assert.deepEqual(slots, [0, 1, 2, 0, 1, 2]);
});

test('roundRobinSlot: handles a negative/garbage cursor without going out of range', () => {
  assert.equal(roundRobinSlot(-1, 3), 2); // ((-1 % 3) + 3) % 3
  assert.equal(roundRobinSlot(7, 3), 1);
  assert.equal(roundRobinSlot(0, 0), -1); // empty pool
  assert.equal(roundRobinSlot(5, 1), 0); // single-user pool always slot 0
});

// ---------------------------------------------------------------------------
// geoMap helpers
// ---------------------------------------------------------------------------
test('geoLookup: matches city case/whitespace-insensitively', () => {
  const map = new Map([
    ['Edmonton', 'u1'],
    ['Saskatoon', 'u2'],
  ]);
  assert.equal(geoLookup(map, 'Edmonton'), 'u1');
  assert.equal(geoLookup(map, '  edmonton '), 'u1');
  assert.equal(geoLookup(map, 'SASKATOON'), 'u2');
  assert.equal(geoLookup(map, 'Regina'), null);
  assert.equal(geoLookup(map, ''), null);
  assert.equal(geoLookup(map, null), null);
});

test('geoMapUserUnion: distinct, insertion-ordered targets', () => {
  const map = new Map([
    ['Edmonton', 'u1'],
    ['Saskatoon', 'u2'],
    ['Regina', 'u2'], // dup target
    ['Montreal', 'u3'],
  ]);
  assert.deepEqual(geoMapUserUnion(map), ['u1', 'u2', 'u3']);
  assert.deepEqual(geoMapUserUnion(new Map()), []);
});

// ---------------------------------------------------------------------------
// resolveOwner — DB-free strategies
// ---------------------------------------------------------------------------
test('resolveOwner: fixed strategy returns the fixed owner (no DB)', async () => {
  const r = await resolveOwner({ ownerStrategy: 'fixed', fixedOwnerId: 'agentX' }, {}, {});
  assert.equal(r.ownerId, 'agentX');
  assert.equal(r.fallback, false);
});

test('resolveOwner: fixed strategy with no owner → reason no_fixed_owner', async () => {
  const r = await resolveOwner({ ownerStrategy: 'fixed', fixedOwnerId: null }, {}, {});
  assert.equal(r.ownerId, null);
  assert.equal(r.reason, 'no_fixed_owner');
});

test('resolveOwner: geo direct hit assigns the city agent (no fallback, no DB)', async () => {
  const policy = {
    ownerStrategy: 'geo',
    geoColumnId: 'cityCol',
    geoMap: new Map([['Edmonton', 'edmAgent']]),
  };
  const task = { columnValues: new Map([['cityCol', 'Edmonton']]) };
  const r = await resolveOwner(policy, task, {});
  assert.equal(r.ownerId, 'edmAgent');
  assert.equal(r.fallback, false);
});

// ---------------------------------------------------------------------------
// overall status roll-up
// ---------------------------------------------------------------------------
test('overallStatus: failed dominates, all-skipped → skipped, else ok', () => {
  assert.equal(overallStatus({ a: { status: 'ok' }, b: { status: 'failed' } }), 'failed');
  assert.equal(overallStatus({ a: { status: 'skipped' }, b: { status: 'skipped' } }), 'skipped');
  assert.equal(overallStatus({ a: { status: 'ok' }, b: { status: 'skipped' } }), 'ok');
});
