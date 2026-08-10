/**
 * csvParse.test.js — the CSV reader. Pure, no DB.
 *     node --test src/utils/csvParse.test.js
 *
 * A brokerage's whole contact database passes through this once. A parser that
 * mangles one row in a thousand produces corrupt leads nobody notices for
 * months, so the edge cases below are the point of the file.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCsv, parseCsvToObjects, detectDelimiter } = require('./csvParse');

test('plain rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ]);
});

test('quoted field containing the delimiter', () => {
  assert.deepEqual(parseCsv('name,city\n"Whitfield, Dana",Montreal'), [
    ['name', 'city'],
    ['Whitfield, Dana', 'Montreal'],
  ]);
});

test('escaped quotes inside a quoted field', () => {
  assert.deepEqual(parseCsv('note\n"She said ""yes"" today"'), [['note'], ['She said "yes" today']]);
});

test('newline inside a quoted field does not split the row', () => {
  const out = parseCsv('name,note\nDana,"line one\nline two"');
  assert.equal(out.length, 2);
  assert.equal(out[1][1], 'line one\nline two');
});

test('CRLF and lone CR line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r1,2'), [['a', 'b'], ['1', '2']]);
});

test('a UTF-8 BOM does not corrupt the first header', () => {
  const { headers } = parseCsvToObjects('﻿Email,Phone\nx@y.co,555');
  assert.equal(headers[0], 'Email', 'BOM stripped, not glued to the header');
});

test('a trailing newline does not create a phantom row', () => {
  const { rows } = parseCsvToObjects('a,b\n1,2\n');
  assert.equal(rows.length, 1);
});

test('blank lines in the middle are skipped', () => {
  const { rows } = parseCsvToObjects('a,b\n1,2\n\n3,4\n');
  assert.equal(rows.length, 2);
});

test('empty trailing cells are preserved as empty strings', () => {
  const { rows } = parseCsvToObjects('name,email,phone\nDana,,514');
  assert.deepEqual(rows[0], { name: 'Dana', email: '', phone: '514' });
});

test('a short row does not throw and fills missing cells', () => {
  const { rows } = parseCsvToObjects('a,b,c\n1,2');
  assert.deepEqual(rows[0], { a: '1', b: '2', c: '' });
});

test('duplicate headers are disambiguated, never silently merged', () => {
  const { headers, rows } = parseCsvToObjects('Email,Email\na@x.co,b@x.co');
  assert.deepEqual(headers, ['Email', 'Email (2)']);
  assert.equal(rows[0].Email, 'a@x.co');
  assert.equal(rows[0]['Email (2)'], 'b@x.co');
});

test('an unnamed header column still gets a usable name', () => {
  const { headers } = parseCsvToObjects('Name,,Phone\nx,y,z');
  assert.equal(headers[1], 'Column 2');
});

test('semicolon and tab delimited exports are detected', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('single'), ',', 'no delimiter → comma');
  const { headers } = parseCsvToObjects('Name;Email\nDana;d@x.co');
  assert.deepEqual(headers, ['Name', 'Email']);
});

test('a delimiter inside quotes does not confuse detection', () => {
  assert.equal(detectDelimiter('"Whitfield, Dana",Montreal'), ',');
});

test('empty input is handled', () => {
  assert.deepEqual(parseCsvToObjects(''), { headers: [], rows: [] });
  assert.deepEqual(parseCsvToObjects(null), { headers: [], rows: [] });
});

test('maxRows caps a runaway file', () => {
  const big = 'a\n' + Array.from({ length: 500 }, (_, i) => i).join('\n');
  assert.ok(parseCsv(big, { maxRows: 10 }).length <= 10);
});
