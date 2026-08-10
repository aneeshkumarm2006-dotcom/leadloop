/**
 * dedupeService.test.js — duplicate matching rules. Pure, no DB.
 *     node --test src/services/dedupeService.test.js
 *
 * The emphasis is on FALSE POSITIVES: a missed duplicate is an annoyance, a
 * wrong merge destroys two real people's records.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePhone,
  normalizeEmail,
  nameSimilarity,
  scoreMatch,
  findBestMatch,
  mergeValues,
} = require('./dedupeService');

// --- phone -----------------------------------------------------------------

test('phone: formatting is irrelevant', () => {
  const want = '5145550142';
  for (const raw of ['+1 (514) 555-0142', '514 555 0142', '514.555.0142', '15145550142', '(514)5550142']) {
    assert.equal(normalizePhone(raw), want, raw);
  }
});

test('phone: too-short numbers never produce a key', () => {
  assert.equal(normalizePhone('0142'), null);
  assert.equal(normalizePhone('x'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
});

test('phone: different numbers stay different', () => {
  assert.notEqual(normalizePhone('514 555 0142'), normalizePhone('514 555 0143'));
});

// --- email -----------------------------------------------------------------

test('email: case and whitespace are irrelevant', () => {
  assert.equal(normalizeEmail('  Dana.W@Example.COM '), 'dana.w@example.com');
});

test('email: +tag subaddressing is stripped', () => {
  assert.equal(normalizeEmail('dana+zillow@example.com'), 'dana@example.com');
  assert.equal(normalizeEmail('dana+facebook@example.com'), 'dana@example.com');
});

test('email: dots collapse for Gmail only', () => {
  assert.equal(normalizeEmail('d.a.n.a@gmail.com'), 'dana@gmail.com');
  assert.equal(normalizeEmail('dana@gmail.com'), 'dana@gmail.com');
  // Other hosts DO distinguish dots — two real mailboxes must stay distinct.
  assert.notEqual(normalizeEmail('j.smith@acme.com'), normalizeEmail('jsmith@acme.com'));
});

test('email: malformed addresses produce no key', () => {
  for (const bad of ['not-an-email', '@example.com', 'dana@', 'dana@localhost', '', null]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

// --- names -----------------------------------------------------------------

test('name similarity ignores order, case, accents and punctuation', () => {
  assert.equal(nameSimilarity('Marie-Claude Roy', 'roy marie claude'), 1);
  assert.ok(nameSimilarity('Dana Whitfield', 'D. Whitfield') > 0, 'initial is dropped, surname matches');
});

test('unrelated names score low', () => {
  assert.ok(nameSimilarity('Dana Whitfield', 'Samuel Osei') === 0);
});

// --- scoring: the important half ------------------------------------------

test('same phone AND email is a certain match', () => {
  const r = scoreMatch(
    { name: 'Dana Whitfield', email: 'dana@example.com', phone: '+1 514 555 0142' },
    { name: 'D. Whitfield', email: 'dana@example.com', phone: '5145550142' }
  );
  assert.equal(r.score, 100);
  assert.equal(r.isDuplicate, true);
  assert.equal(r.isStrong, true);
  assert.ok(r.reasons.includes('phone') && r.reasons.includes('email'));
});

test('one matching contact detail is enough to review', () => {
  const r = scoreMatch(
    { name: 'Dana Whitfield', phone: '514 555 0142' },
    { name: 'Dana Whitfield', phone: '+1 (514) 555-0142' }
  );
  assert.equal(r.isDuplicate, true);
  assert.ok(r.reasons.includes('name'), 'name corroborates');
});

test('A NAME ALONE IS NEVER A DUPLICATE', () => {
  // Two different John Smiths with no shared contact details.
  const r = scoreMatch(
    { name: 'John Smith', email: 'john.smith@acme.com', phone: '514 555 0001' },
    { name: 'John Smith', email: 'jsmith@other.com', phone: '416 555 9999' }
  );
  assert.equal(r.score, 0);
  assert.equal(r.isDuplicate, false);
});

test('leads with no contact details at all never match', () => {
  const r = scoreMatch({ name: 'Dana Whitfield' }, { name: 'Dana Whitfield' });
  assert.equal(r.isDuplicate, false, 'nothing to match on — do not guess');
});

test('empty/absent fields never collide', () => {
  const r = scoreMatch({ name: 'A', email: '', phone: '' }, { name: 'B', email: '', phone: '' });
  assert.equal(r.score, 0);
  assert.equal(scoreMatch({}, {}).score, 0);
});

test('same household, different people: shared phone but different names', () => {
  // Deliberately DOES flag for review (shared landline) but is not "strong",
  // so a human decides rather than an automatic merge.
  const r = scoreMatch(
    { name: 'Dana Whitfield', phone: '514 555 0142' },
    { name: 'Owen Clarke', phone: '514 555 0142' }
  );
  assert.equal(r.isDuplicate, true);
  assert.equal(r.isStrong, false, 'must not be auto-merge confident');
});

// --- picking the best match ------------------------------------------------

test('findBestMatch returns the strongest candidate, or null', () => {
  const incoming = { id: 'new', name: 'Dana Whitfield', email: 'dana@example.com', phone: '514 555 0142' };
  const existing = [
    { id: 'a', name: 'Someone Else', email: 'else@example.com', phone: '416 555 1111', createdAt: '2026-01-01' },
    { id: 'b', name: 'D. Whitfield', phone: '5145550142', createdAt: '2026-02-01' },
    { id: 'c', name: 'Dana Whitfield', email: 'dana@example.com', phone: '5145550142', createdAt: '2026-03-01' },
  ];
  const best = findBestMatch(incoming, existing);
  assert.equal(best.match.id, 'c', 'both contacts beat one');
  assert.equal(best.score, 100);

  assert.equal(findBestMatch(incoming, []), null);
  assert.equal(findBestMatch(incoming, [existing[0]]), null, 'no match → null, not a weak guess');
});

test('findBestMatch never matches a lead against itself', () => {
  const self = { id: 'x', name: 'Dana', email: 'dana@example.com', phone: '514 555 0142' };
  assert.equal(findBestMatch(self, [self]), null);
});

// --- merging ---------------------------------------------------------------

test('merge prefers the primary but never loses data the user did not discard', () => {
  const primary = { name: 'Dana Whitfield', email: '', budget: 740000 };
  const duplicate = { name: 'D. Whitfield', email: 'dana@example.com', budget: null };
  const merged = mergeValues(primary, duplicate);
  assert.equal(merged.name, 'Dana Whitfield', 'primary wins when present');
  assert.equal(merged.email, 'dana@example.com', 'empty primary falls back to duplicate');
  assert.equal(merged.budget, 740000);
});

test('explicit choices win', () => {
  const merged = mergeValues(
    { name: 'D. Whitfield', phone: '111' },
    { name: 'Dana Whitfield', phone: '222' },
    { name: 'duplicate', phone: 'primary' }
  );
  assert.equal(merged.name, 'Dana Whitfield');
  assert.equal(merged.phone, '111');
});

test('choosing an empty value still falls back rather than blanking the field', () => {
  const merged = mergeValues({ email: 'keep@example.com' }, { email: '' }, { email: 'duplicate' });
  assert.equal(merged.email, 'keep@example.com', 'a merge must never destroy the only value');
});
