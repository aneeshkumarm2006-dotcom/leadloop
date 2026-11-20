/**
 * zipStore.test.js — the in-memory zip writer, verified with the system
 * `unzip` (skipped when unzip isn't installed).
 * Run: node --test src/utils/zipStore.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createZip, dosDateTime } = require('./zipStore');

const hasUnzip = (() => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const tmpZip = (buf) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zipstore-'));
  const file = path.join(dir, 'out.zip');
  fs.writeFileSync(file, buf);
  return { dir, file };
};

test('structure: signatures, entry count, UTF-8 flag', () => {
  const zip = createZip([{ name: 'a/' }, { name: 'a/x.txt', data: 'hello' }], { date: new Date(2026, 0, 2, 3, 4, 6) });
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  assert.equal(zip.readUInt16LE(end + 10), 2);
  assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800);
});

test('dosDateTime packs fields', () => {
  const { time, date } = dosDateTime(new Date(2026, 10, 18, 13, 45, 31));
  assert.equal(time >> 11, 13);
  assert.equal((time >> 5) & 63, 45);
  assert.equal((time & 31) * 2, 30);
  assert.equal((date >> 9) + 1980, 2026);
  assert.equal((date >> 5) & 15, 11);
  assert.equal(date & 31, 18);
});

test('rejects unsafe names', () => {
  for (const name of ['../x', '/abs', 'a/../../b', 'a\\b', '']) assert.throws(() => createZip([{ name, data: 'x' }]));
  assert.throws(() => createZip([]));
});

test('unzip -t accepts the archive and contents round-trip', { skip: !hasUnzip && 'unzip not installed' }, () => {
  const php = "<?php\necho 'héllo';\n";
  const bin = Buffer.from([0, 1, 2, 255, 254]);
  const zip = createZip([
    { name: 'leadloop/' },
    { name: 'leadloop/leadloop.php', data: php },
    { name: 'leadloop/bin.dat', data: bin },
    { name: 'leadloop/empty.txt', data: '' },
  ]);
  const { dir, file } = tmpZip(zip);
  try {
    const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.match(out, /No errors detected/);
    assert.equal(execFileSync('unzip', ['-p', file, 'leadloop/leadloop.php'], { encoding: 'utf8' }), php);
    assert.deepEqual(execFileSync('unzip', ['-p', file, 'leadloop/bin.dat']), bin);
    const list = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(list, ['leadloop/', 'leadloop/leadloop.php', 'leadloop/bin.dat', 'leadloop/empty.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
