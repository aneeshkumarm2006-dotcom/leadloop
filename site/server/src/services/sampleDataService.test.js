/**
 * sampleDataService.test.js — column-matching rules for demo leads. Pure, no DB.
 *     node --test src/services/sampleDataService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { pickColumn, SAMPLE_LEADS } = require('./sampleDataService');

const col = (key, name, type, extra = {}) => ({ _id: `id_${key}`, key, name, type, ...extra });

test('matches a column by key first', () => {
  const columns = [col('email', 'Email', 'email'), col('phone', 'Phone', 'phone')];
  assert.equal(pickColumn(columns, 'email', new Set()).key, 'email');
  assert.equal(pickColumn(columns, 'phone', new Set()).key, 'phone');
});

test('matches on the human name when the key differs', () => {
  const columns = [col('c1', 'Mobile Number', 'phone')];
  assert.equal(pickColumn(columns, 'phone', new Set()).key, 'c1');
});

test('falls back to a distinctive type when no key matches', () => {
  const columns = [col('c1', 'Contact', 'email')];
  assert.equal(pickColumn(columns, 'email', new Set()).key, 'c1');
});

test('never hijacks a plain text column for "source"', () => {
  // A board with only a generic text column must NOT get the source dumped in it.
  const columns = [col('city', 'City', 'text')];
  assert.equal(pickColumn(columns, 'source', new Set()), null);
  // But an explicitly named source column is fine.
  assert.equal(pickColumn([col('lead_source', 'Lead Source', 'text')], 'source', new Set()).key, 'lead_source');
});

test('a column already used is not reused', () => {
  const columns = [col('contact', 'Contact', 'email')];
  const taken = new Set(['id_contact']);
  assert.equal(pickColumn(columns, 'email', taken), null);
});

test('returns null when the board has no suitable column', () => {
  assert.equal(pickColumn([], 'budget', new Set()), null);
  assert.equal(pickColumn([col('x', 'Whatever', 'date')], 'budget', new Set()), null);
});

test('budget matches price/amount style columns', () => {
  assert.equal(pickColumn([col('price_range', 'Price Range', 'number')], 'budget', new Set()).key, 'price_range');
  assert.equal(pickColumn([col('n', 'Score', 'number')], 'budget', new Set()).key, 'n'); // type fallback
});

test('sample leads are clearly fictional and well-formed', () => {
  assert.equal(SAMPLE_LEADS.length, 6);
  for (const l of SAMPLE_LEADS) {
    assert.ok(l.name && l.email && l.phone, 'each lead has contact details');
    assert.ok(l.email.endsWith('@example.com'), 'uses the reserved example.com domain');
    assert.ok(l.phone.includes('555'), 'uses a reserved 555 number');
    assert.equal(typeof l.stageIndex, 'number');
  }
});

test('leads are spread across more than one stage', () => {
  assert.ok(new Set(SAMPLE_LEADS.map((l) => l.stageIndex)).size >= 4);
});
