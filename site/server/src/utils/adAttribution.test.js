/**
 * adAttribution.test.js — unit tests for ad-click attribution extraction.
 * Run: node --test src/utils/adAttribution.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { extractAttribution, parseClickTime, deriveChannel } = require('./adAttribution');

const NOW = new Date('2026-11-06T12:00:00Z');
const GCLID = 'Cj0KCQiA4L67BhDUARIsADWrl7Ff_abc-123';
const FBCLID = 'IwAR2xYz_AbC-123';

test('lifts click IDs and UTMs out of the lead fields', () => {
  const { attribution, remaining, warnings } = extractAttribution(
    {
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      gclid: GCLID,
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'merchant-q4',
    },
    { now: NOW }
  );
  assert.deepEqual(remaining, { full_name: 'Jane Doe', email: 'jane@example.com' });
  assert.equal(attribution.gclid, GCLID);
  assert.equal(attribution.utmSource, 'google');
  assert.equal(attribution.utmCampaign, 'merchant-q4');
  assert.equal(attribution.channel, 'google_ads');
  assert.equal(attribution.capturedAt, NOW);
  assert.deepEqual(warnings, []);
});

test('no attribution keys → null attribution, payload untouched', () => {
  const body = { name: 'A', phone: '555' };
  const { attribution, remaining } = extractAttribution(body, { now: NOW });
  assert.equal(attribution, null);
  assert.deepEqual(remaining, body);
});

test('accepts cookie-style and camel-case aliases', () => {
  const { attribution, remaining } = extractAttribution(
    { name: 'A', _fbp: 'fb.1.1730000000000.123456789', utmSource: 'facebook', GBRAID: 'abc_DEF' },
    { now: NOW }
  );
  assert.deepEqual(remaining, { name: 'A' });
  assert.equal(attribution.fbp, 'fb.1.1730000000000.123456789');
  assert.equal(attribution.utmSource, 'facebook');
  assert.equal(attribution.gbraid, 'abc_DEF');
  assert.equal(attribution.channel, 'google_ads');
});

test('builds fbc from fbclid when no _fbc cookie was sent, timestamped at the click', () => {
  const clickMs = NOW.getTime() - 2 * 24 * 60 * 60 * 1000;
  const { attribution } = extractAttribution(
    { name: 'A', fbclid: FBCLID, click_ts: String(clickMs) },
    { now: NOW }
  );
  assert.equal(attribution.fbc, `fb.1.${clickMs}.${FBCLID}`);
  assert.equal(attribution.channel, 'meta_ads');
});

test('keeps a real _fbc cookie rather than rebuilding it', () => {
  const fbc = `fb.1.1730000000000.${FBCLID}`;
  const { attribution } = extractAttribution({ name: 'A', fbclid: FBCLID, fbc }, { now: NOW });
  assert.equal(attribution.fbc, fbc);
});

test('drops malformed identifiers with a warning instead of failing', () => {
  const { attribution, warnings } = extractAttribution(
    {
      name: 'A',
      gclid: 'bad id <script>',
      fbc: 'not-a-cookie',
      landing_page: 'javascript:alert(1)',
      client_ip: '999.1.1.1',
      utm_source: 'google',
    },
    { now: NOW }
  );
  assert.equal(attribution.gclid, undefined);
  assert.equal(attribution.fbc, undefined);
  assert.equal(attribution.landingPage, undefined);
  assert.equal(attribution.clientIp, undefined);
  assert.equal(attribution.channel, 'campaign');
  const keys = warnings.map((w) => w.key).sort();
  assert.deepEqual(keys, ['clientIp', 'fbc', 'gclid', 'landingPage']);
});

test('records ad consent with the visitor IP/UA forwarded by the site', () => {
  const { attribution, remaining } = extractAttribution(
    {
      name: 'A',
      gclid: GCLID,
      ad_consent: 'on',
      consent_text: 'I agree Bo Payments may use my details to measure ads.',
      client_ip: '203.0.113.7',
      client_user_agent: 'Mozilla/5.0 (iPhone)',
    },
    { now: NOW, requestIp: '10.0.0.1', requestUserAgent: 'PHP' }
  );
  assert.deepEqual(remaining, { name: 'A' });
  assert.equal(attribution.adConsent.granted, true);
  assert.match(attribution.adConsent.wording, /measure ads/);
  assert.equal(attribution.adConsent.ip, '203.0.113.7');
  assert.equal(attribution.adConsent.userAgent, 'Mozilla/5.0 (iPhone)');
  assert.equal(attribution.clientIp, '203.0.113.7');
});

test('unchecked consent is recorded as not granted', () => {
  const { attribution } = extractAttribution({ name: 'A', consent: 'false' }, { now: NOW, requestIp: '10.0.0.1' });
  assert.equal(attribution.adConsent.granted, false);
  assert.equal(attribution.adConsent.ip, '10.0.0.1'); // falls back to the caller IP
});

test('keepKeys leaves an already-mapped key feeding its column too', () => {
  const { attribution, remaining } = extractAttribution(
    { name: 'A', utm_source: 'google' },
    { now: NOW, keepKeys: new Set(['utm_source']) }
  );
  assert.deepEqual(remaining, { name: 'A', utm_source: 'google' });
  assert.equal(attribution.utmSource, 'google');
});

test('parseClickTime accepts ms, seconds and ISO; rejects stale or future', () => {
  const ms = NOW.getTime() - 1000;
  assert.equal(parseClickTime(String(ms), NOW).getTime(), ms);
  assert.equal(parseClickTime(String(Math.floor(ms / 1000)), NOW).getTime(), Math.floor(ms / 1000) * 1000);
  assert.equal(parseClickTime('2026-11-01T00:00:00Z', NOW).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(parseClickTime('2020-01-01T00:00:00Z', NOW), null);
  assert.equal(parseClickTime(String(NOW.getTime() + 3 * 86400000), NOW), null);
  assert.equal(parseClickTime('nonsense', NOW), null);
});

test('deriveChannel prefers Google, then Meta, then others', () => {
  assert.equal(deriveChannel({ gclid: 'x', fbclid: 'y' }), 'google_ads');
  assert.equal(deriveChannel({ fbc: 'x' }), 'meta_ads');
  assert.equal(deriveChannel({ msclkid: 'x' }), 'microsoft_ads');
  assert.equal(deriveChannel({ ttclid: 'x' }), 'tiktok_ads');
  assert.equal(deriveChannel({ utmCampaign: 'x' }), 'campaign');
  assert.equal(deriveChannel({}), null);
});
