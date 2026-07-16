/**
 * getByPath.test.js — unit tests for the F7.3 JSON-path resolver.
 * Run: node --test src/utils/getByPath.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { getByPath, toSegments } = require('./getByPath');

test('resolves nested dot paths', () => {
  assert.equal(getByPath({ contact: { email: 'a@b.c' } }, 'contact.email'), 'a@b.c');
});

test('resolves array index with bracket syntax', () => {
  assert.equal(getByPath({ items: [{ id: 7 }, { id: 8 }] }, 'items[1].id'), 8);
});

test('mixed dot + bracket', () => {
  const body = { data: { tags: ['vip', 'new'] } };
  assert.equal(getByPath(body, 'data.tags[0]'), 'vip');
});

test('missing path → undefined (AC5: leaves column unset)', () => {
  assert.equal(getByPath({ a: 1 }, 'a.b.c'), undefined);
  assert.equal(getByPath({}, 'nope'), undefined);
  assert.equal(getByPath(null, 'a'), undefined);
});

test('quoted bracket key handles dotted keys', () => {
  assert.equal(getByPath({ 'odd.key': 42 }, '["odd.key"]'), 42);
});

test('array path form bypasses parsing', () => {
  assert.equal(getByPath({ 'a.b': { c: 9 } }, ['a.b', 'c']), 9);
});

test('falsy-but-present values are returned, not skipped', () => {
  assert.equal(getByPath({ n: 0 }, 'n'), 0);
  assert.equal(getByPath({ b: false }, 'b'), false);
  assert.equal(getByPath({ s: '' }, 's'), '');
});

test('toSegments parses common shapes', () => {
  assert.deepEqual(toSegments('a.b[0].c'), ['a', 'b', '0', 'c']);
  assert.deepEqual(toSegments(''), []);
});
