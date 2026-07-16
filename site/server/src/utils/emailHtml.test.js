/**
 * emailHtml.test.js — unit tests for the F8.3/F8.4 HTML + tracking helpers.
 * Pure / no DB. Run from the server directory:
 *     node --test src/utils/emailHtml.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeEmailHtml,
  htmlToText,
  textToHtml,
  injectTracking,
  rewriteLinksForTracking,
  openPixelTag,
} = require('./emailHtml');

test('sanitizeEmailHtml strips script/style blocks and inline handlers', () => {
  const dirty = '<p onclick="steal()">Hi</p><script>evil()</script><style>x{}</style>';
  const clean = sanitizeEmailHtml(dirty);
  assert.equal(clean.includes('<script'), false);
  assert.equal(clean.includes('<style'), false);
  assert.equal(/onclick/i.test(clean), false);
  assert.ok(clean.includes('Hi'));
});

test('sanitizeEmailHtml neutralises javascript: URLs', () => {
  const clean = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>');
  assert.equal(/javascript:/i.test(clean), false);
});

test('htmlToText renders a readable approximation', () => {
  const text = htmlToText('<p>Hello</p><p>World</p><br/>Line');
  assert.ok(text.includes('Hello'));
  assert.ok(text.includes('World'));
  assert.equal(text.includes('<'), false);
});

test('textToHtml escapes + nl2br', () => {
  const html = textToHtml('a < b\nnext');
  assert.ok(html.includes('&lt;'));
  assert.ok(html.includes('<br />'));
});

test('openPixelTag points at the open-tracking endpoint for the message id', () => {
  const tag = openPixelTag('msg123', 'https://crm.example.com');
  assert.ok(tag.includes('/api/email/track/msg123/open.gif'));
});

test('rewriteLinksForTracking wraps http links through the click redirect', () => {
  const out = rewriteLinksForTracking('<a href="https://x.com/a?b=1">go</a>', 'm1', 'https://crm.test');
  assert.ok(out.includes('/api/email/track/m1/click?u='));
  assert.ok(out.includes(encodeURIComponent('https://x.com/a?b=1')));
});

test('rewriteLinksForTracking leaves non-http + already-tracked links alone', () => {
  const mailto = '<a href="mailto:x@y.com">mail</a>';
  assert.equal(rewriteLinksForTracking(mailto, 'm1', 'https://crm.test'), mailto);
});

test('injectTracking appends the pixel and rewrites links', () => {
  const out = injectTracking('<a href="https://x.com">x</a>', 'm9', 'https://crm.test');
  assert.ok(out.includes('/api/email/track/m9/click?u='));
  assert.ok(out.includes('/api/email/track/m9/open.gif'));
});

test('injectTracking is a no-op when base url is unset (local dev)', () => {
  const html = '<a href="https://x.com">x</a>';
  assert.equal(injectTracking(html, 'm9', ''), html);
});
