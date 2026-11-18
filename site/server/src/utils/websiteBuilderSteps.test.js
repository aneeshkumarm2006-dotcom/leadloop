/**
 * websiteBuilderSteps.test.js — Run: node --test src/utils/websiteBuilderSteps.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('./websiteBuilderSteps');

test('every builder the API accepts has a name, intro and steps', () => {
  assert.deepEqual(s.BUILDER_IDS, ['gtm', 'wordpress', 'wix', 'squarespace', 'webflow', 'shopify', 'other']);
  for (const id of s.BUILDER_IDS) {
    const b = s.getBuilderSteps(id);
    assert.ok(b.name && b.intro, id);
    assert.ok(b.steps.length >= 3, id);
    assert.ok(b.steps.every((x) => typeof x === 'string' && x.length > 5), id);
    assert.ok(Array.isArray(b.notes), id);
  }
});

test('unknown / prototype keys are not builders', () => {
  for (const id of ['', 'toString', '__proto__', 'constructor', 'joomla', null, undefined]) {
    assert.equal(s.isBuilder(id), false, String(id));
    assert.equal(s.getBuilderSteps(id), null);
  }
});

test('returned steps are copies', () => {
  s.getBuilderSteps('wix').steps.push('x');
  assert.ok(!s.getBuilderSteps('wix').steps.includes('x'));
});

test('key menu names are present', () => {
  const all = (id) => s.getBuilderSteps(id).steps.join(' ');
  assert.match(all('gtm'), /Custom HTML/);
  assert.match(all('gtm'), /All Pages/);
  assert.match(all('wordpress'), /Upload Plugin/);
  assert.match(all('wix'), /Custom Code/);
  assert.match(all('squarespace'), /Code Injection/);
  assert.match(all('webflow'), /Custom code/);
  assert.match(all('shopify'), /theme\.liquid/);
});

test('renderers include the tag; HTML escapes it', () => {
  const tag = '<script src="https://x.test/capture.js" data-site="site_abcdefgh" defer></script>';
  const text = s.renderStepsText('shopify', tag);
  assert.ok(text.includes(tag));
  assert.match(text, /^Shopify:/);
  const html = s.renderStepsHtml('shopify', tag);
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;script src=&quot;https://x.test/capture.js&quot;'));
  assert.ok(html.includes('&lt;/head&gt;'));
  assert.equal(s.renderStepsText('nope', tag), '');
});
