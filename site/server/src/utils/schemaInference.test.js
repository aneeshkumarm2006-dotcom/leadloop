/**
 * schemaInference.test.js — unit tests for the F14 "first call defines the
 * table" inference core. Pure functions, no DB. Run from the server directory:
 *     node --test src/utils/schemaInference.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inferSchema,
  inferFieldType,
  humanizeLabel,
  pickPrimaryKey,
} = require('./schemaInference');

test('inferFieldType: value shape wins for unambiguous types', () => {
  assert.equal(inferFieldType('whatever', 'jane@acme.co'), 'email');
  assert.equal(inferFieldType('x', 'https://acme.co/pricing'), 'link');
  assert.equal(inferFieldType('x', true), 'checkbox');
  assert.equal(inferFieldType('x', 4200), 'number');
  assert.equal(inferFieldType('signup_date', '2024-05-01'), 'date');
});

test('inferFieldType: key hints break ties for ambiguous values', () => {
  assert.equal(inferFieldType('phone', '+1 (780) 555-0134'), 'phone');
  assert.equal(inferFieldType('mobile', '780-555-0134'), 'phone');
  assert.equal(inferFieldType('budget', '5000'), 'number');
  assert.equal(inferFieldType('message', 'hi there'), 'long_text');
});

test('inferFieldType: numeric-looking strings stay text unless the key is numeric', () => {
  // Zip / order id must not be coerced to a number and lose leading zeros.
  assert.equal(inferFieldType('zip', '07030'), 'text');
  assert.equal(inferFieldType('order_id', '12345'), 'text');
  // A bare number field with a numeric key becomes a number.
  assert.equal(inferFieldType('quantity', '12'), 'number');
});

test('inferFieldType: unknown / empty values fall back to text (column still created)', () => {
  assert.equal(inferFieldType('company', 'Acme Inc'), 'text');
  assert.equal(inferFieldType('foo', ''), 'text');
  assert.equal(inferFieldType('notes', ''), 'long_text'); // key hint keeps the shape
  assert.equal(inferFieldType('bar', null), 'text');
});

test('humanizeLabel: snake / camel / kebab → Title Case', () => {
  assert.equal(humanizeLabel('full_name'), 'Full Name');
  assert.equal(humanizeLabel('fullName'), 'Full Name');
  assert.equal(humanizeLabel('full-name'), 'Full Name');
  assert.equal(humanizeLabel('email'), 'Email');
});

test('pickPrimaryKey: prefers an explicit name, then company, then email', () => {
  assert.equal(
    pickPrimaryKey([
      { sourceKey: 'email', normalizedKey: 'email', type: 'email' },
      { sourceKey: 'full_name', normalizedKey: 'full_name', type: 'text' },
    ]),
    'full_name'
  );
  assert.equal(
    pickPrimaryKey([
      { sourceKey: 'email', normalizedKey: 'email', type: 'email' },
      { sourceKey: 'company', normalizedKey: 'company', type: 'text' },
    ]),
    'company'
  );
  assert.equal(
    pickPrimaryKey([{ sourceKey: 'email', normalizedKey: 'email', type: 'email' }]),
    'email'
  );
});

test('inferSchema: end-to-end over a typical marketing form payload', () => {
  const { fields, primaryKey, skipped } = inferSchema({
    full_name: 'Jane Doe',
    email: 'jane@acme.co',
    phone: '+1 780 555 0134',
    budget: '5000',
    message: 'Interested in your SEO package.',
    subscribe: true,
    'cf-turnstile-response': 'tok_xyz', // captcha token — must be skipped
    _redirect: '/thanks', // control key — must be skipped
  });

  assert.equal(primaryKey, 'full_name');
  const byKey = Object.fromEntries(fields.map((f) => [f.sourceKey, f.type]));
  assert.deepEqual(byKey, {
    full_name: 'text',
    email: 'email',
    phone: 'phone',
    budget: 'number',
    message: 'long_text',
    subscribe: 'checkbox',
  });
  assert.ok(skipped.includes('cf-turnstile-response'));
  assert.ok(skipped.includes('_redirect'));
});

test('inferSchema: non-object / array payloads yield an empty schema', () => {
  assert.deepEqual(inferSchema(null), { fields: [], primaryKey: null, skipped: [] });
  assert.deepEqual(inferSchema([1, 2, 3]).fields, []);
});
