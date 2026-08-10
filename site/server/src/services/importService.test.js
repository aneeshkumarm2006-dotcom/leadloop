/**
 * importService.test.js — CSV → lead mapping. Pure, no DB.
 *     node --test src/services/importService.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { roleForHeader, suggestMapping, buildLead, splitExisting } = require('./importService');

const col = (id, name, type, extra = {}) => ({ _id: id, name, type, key: null, ...extra });
const BOARD = [
  col('p1', 'Lead Name', 'text', { isPrimary: true, key: 'lead_name' }),
  col('c1', 'Email', 'email', { key: 'email' }),
  col('c2', 'Phone', 'phone', { key: 'phone' }),
  col('c3', 'Price Range', 'number', { key: 'price_range' }),
  col('c4', 'Notes', 'long_text', { key: 'notes' }),
];

test('headers are classified into roles', () => {
  assert.equal(roleForHeader('E-mail Address'), 'email');
  assert.equal(roleForHeader('Cell'), 'phone');
  assert.equal(roleForHeader('Full Name'), 'name');
  assert.equal(roleForHeader('First Name'), 'firstName');
  assert.equal(roleForHeader('Max Price'), 'number');
  assert.equal(roleForHeader('Lead Source'), 'source');
  assert.equal(roleForHeader('Notes_2024'), 'notes');
  assert.equal(roleForHeader('Wingspan'), null, 'unknown headers stay unknown');
});

test('an exact column-name match wins', () => {
  const m = suggestMapping(['Email', 'Phone'], BOARD);
  assert.equal(m[0].columnId, 'c1');
  assert.equal(m[0].confidence, 'exact');
  assert.equal(m[1].columnId, 'c2');
});

test('a differently-named header still maps by type', () => {
  const m = suggestMapping(['Cell'], BOARD);
  assert.equal(m[0].columnId, 'c2');
  assert.equal(m[0].confidence, 'type');
});

test('the name header targets the primary column', () => {
  const m = suggestMapping(['Full Name'], BOARD);
  assert.equal(m[0].columnId, 'primary');
});

test('an unrecognised header is left unmapped rather than guessed', () => {
  const m = suggestMapping(['Wingspan'], BOARD);
  assert.equal(m[0].columnId, null);
  assert.equal(m[0].confidence, 'none');
});

test('one column is never claimed by two headers', () => {
  const m = suggestMapping(['Email', 'E-mail Address'], BOARD);
  assert.equal(m[0].columnId, 'c1');
  assert.equal(m[1].columnId, null, 'second email header has nowhere to go');
});

test('a row becomes a lead with values on the right columns', () => {
  const mapping = suggestMapping(['Full Name', 'Email', 'Cell', 'Max Price'], BOARD);
  const lead = buildLead(
    { 'Full Name': 'Dana Whitfield', Email: 'Dana@Example.com', Cell: '+1 (514) 555-0142', 'Max Price': '740000' },
    mapping
  );
  assert.equal(lead.name, 'Dana Whitfield');
  assert.equal(lead.columnValues.c1, 'Dana@Example.com');
  assert.equal(lead.columnValues.c2, '+1 (514) 555-0142');
  assert.equal(lead.columnValues.c3, '740000');
  assert.equal(lead.email, 'dana@example.com', 'normalised for matching');
  assert.equal(lead.phone, '5145550142');
});

test('first + last name columns are combined', () => {
  const mapping = suggestMapping(['First Name', 'Last Name', 'Email'], BOARD);
  const lead = buildLead({ 'First Name': 'Dana', 'Last Name': 'Whitfield', Email: 'd@x.co' }, mapping);
  assert.equal(lead.name, 'Dana Whitfield');
});

test('a lead is never left untitled', () => {
  const mapping = suggestMapping(['Email'], BOARD);
  const lead = buildLead({ Email: 'dana@example.com' }, mapping);
  assert.equal(lead.name, 'dana@example.com', 'falls back to the email');
});

test('empty cells and skipped columns are ignored', () => {
  const mapping = suggestMapping(['Full Name', 'Wingspan', 'Email'], BOARD);
  const lead = buildLead({ 'Full Name': 'Dana', Wingspan: '2m', Email: '  ' }, mapping);
  assert.equal(lead.name, 'Dana');
  assert.equal(lead.columnValues.c1, undefined, 'blank email not written');
  assert.equal(Object.values(lead.columnValues).includes('2m'), false, 'skipped column not written');
});

test('rows already on the board are separated from new ones', () => {
  const existing = { emails: new Set(['dana@example.com']), phones: new Set() };
  const leads = [
    { name: 'Dana', email: 'dana@example.com', phone: null },
    { name: 'Priya', email: 'priya@example.com', phone: null },
  ];
  const { fresh, duplicates } = splitExisting(leads, existing);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].name, 'Priya');
  assert.equal(duplicates[0].reason, 'exists');
});

test('the same person twice INSIDE the file is caught', () => {
  // Exports routinely contain duplicates; importing both would recreate the
  // exact problem the dedupe feature exists to solve.
  const leads = [
    { name: 'Dana', email: 'dana@example.com', phone: null },
    { name: 'D. Whitfield', email: 'dana@example.com', phone: null },
  ];
  const { fresh, duplicates } = splitExisting(leads, { emails: new Set(), phones: new Set() });
  assert.equal(fresh.length, 1);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].reason, 'duplicate_in_file');
});

test('leads with no contact details are all imported, never merged', () => {
  const leads = [
    { name: 'Walk-in A', email: null, phone: null },
    { name: 'Walk-in B', email: null, phone: null },
  ];
  const { fresh } = splitExisting(leads, { emails: new Set(), phones: new Set() });
  assert.equal(fresh.length, 2, 'nothing to match on → keep both');
});
