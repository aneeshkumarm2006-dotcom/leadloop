/**
 * leadloop-capture.test.js — runs the snippet in a vm with a tiny fake DOM to
 * check pixel loading (no double-loading), the seen beacon and the shared-id
 * lead events. Run: node --test src/public/leadloop-capture.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'leadloop-capture.js'), 'utf8');
const SITE = 'site_abcdef234567';

const makeEnv = ({ config, preset, attrs = {} }) => {
  const injected = [];
  const beacons = [];
  const listeners = {};
  const scriptAttrs = { 'data-site': SITE, ...attrs };
  const fakeScript = { src: 'https://api.leadloop.test/capture.js', getAttribute: (n) => (n in scriptAttrs ? scriptAttrs[n] : null) };
  const head = { appendChild: (el) => injected.push(el.src) };
  const document = {
    currentScript: fakeScript,
    cookie: '',
    readyState: 'complete',
    referrer: '',
    head,
    documentElement: head,
    createElement: () => ({ setAttribute() {}, style: {} }),
    getElementsByTagName: () => [{ parentNode: { insertBefore: (el) => injected.push(el.src) } }],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (ev, fn) => {
      listeners[ev] = fn;
    },
  };
  const window = {};
  const sandbox = {
    window,
    document,
    location: { search: '', href: 'https://bopayments.com/pricing', hostname: 'bopayments.com', pathname: '/pricing', protocol: 'https:' },
    navigator: { sendBeacon: (url, blob) => (beacons.push({ url, blob }), true) },
    URL,
    URLSearchParams,
    Blob,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    setTimeout,
    fetch: async () => ({ ok: true, json: async () => config }),
  };
  window.fetch = sandbox.fetch;
  if (preset) preset(window);
  // Globals the snippet reads as bare names must resolve to the window.
  const ctx = vm.createContext(new Proxy(sandbox, {
    get: (t, k) => (k in t ? t[k] : k in window ? window[k] : globalThis[k]),
    has: () => true,
    set: (t, k, v) => {
      window[k] = v;
      return true;
    },
  }));
  return { ctx, window, injected, beacons, listeners };
};

const run = async (opts) => {
  const env = makeEnv(opts);
  vm.runInContext(SRC, env.ctx);
  await new Promise((r) => setTimeout(r, 20));
  return env;
};

const PIXELS = { meta: '1234567890123', google: 'AW-123456789', tiktok: 'CABCDEFGHIJ1234567' };
const cfg = (pixels) => ({ formSelector: '', consentWording: '', accent: '', pixels });

test('fresh page: loads all three base codes once and sends one seen beacon', async () => {
  const { window, injected, beacons } = await run({ config: cfg(PIXELS) });
  assert.ok(injected.includes('https://connect.facebook.net/en_US/fbevents.js'));
  assert.ok(injected.includes('https://www.googletagmanager.com/gtag/js?id=AW-123456789'));
  assert.ok(injected.some((s) => /analytics\.tiktok\.com\/i18n\/pixel\/events\.js\?sdkid=CABCDEFGHIJ1234567/.test(s)));
  assert.equal(injected.length, 3);
  const q = window.fbq.queue.map((a) => Array.from(a));
  assert.deepEqual(q[0], ['init', PIXELS.meta]);
  assert.deepEqual(q[1], ['trackSingle', PIXELS.meta, 'PageView']);
  assert.ok(window.dataLayer.some((a) => a[0] === 'config' && a[1] === 'AW-123456789'));
  assert.ok(window.ttq._i[PIXELS.tiktok]);
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].url, `https://api.leadloop.test/api/capture/${SITE}/seen`);
  assert.equal(await beacons[0].blob.text(), JSON.stringify({ path: '/pricing' }));
});

test('page already has the same pixels → nothing injected or re-initialised', async () => {
  const { window, injected } = await run({
    config: cfg(PIXELS),
    preset: (w) => {
      const fbq = function () { fbq.queue.push(arguments); };
      fbq.queue = [['init', PIXELS.meta]];
      w.fbq = fbq;
      w.dataLayer = [['config', 'AW-123456789']];
      w.gtag = function () { w.dataLayer.push(arguments); };
      w.ttq = { _i: { [PIXELS.tiktok]: [] } };
    },
  });
  assert.equal(injected.length, 0);
  assert.equal(window.fbq.queue.length, 1);
  assert.equal(window.dataLayer.length, 1);
});

test('lead events: Meta Lead + TikTok SubmitForm share one event id', async () => {
  const { window, listeners } = await run({ config: cfg({ meta: PIXELS.meta, google: null, tiktok: PIXELS.tiktok }) });
  const form = {
    nodeName: 'FORM',
    elements: [{ name: 'email', type: 'email', value: 'a@b.co', getAttribute: () => null }],
    checkValidity: () => true,
    getAttribute: () => '',
    querySelector: (sel) => (/email/.test(sel) ? {} : null),
  };
  listeners.submit({ target: form });
  const lead = window.fbq.queue.map((a) => Array.from(a)).find((a) => a[2] === 'Lead');
  assert.ok(lead, 'fbq Lead fired');
  const tt = Array.from(window.ttq._i[PIXELS.tiktok]).find((a) => a[0] === 'track');
  assert.equal(tt[1], 'SubmitForm');
  assert.equal(tt[3].event_id, lead[4].eventID);
  assert.match(lead[4].eventID, /^ll\./);
});

test('invalid form (checkValidity false) fires no lead event', async () => {
  const { window, listeners } = await run({ config: cfg({ meta: PIXELS.meta }) });
  const form = {
    nodeName: 'FORM',
    elements: [],
    checkValidity: () => false,
    getAttribute: () => '',
    querySelector: (sel) => (/email/.test(sel) ? {} : null),
  };
  listeners.submit({ target: form });
  assert.ok(!window.fbq.queue.some((a) => a[2] === 'Lead'));
});

test('data-pixels="off" and malformed ids load nothing (but still beacon)', async () => {
  const off = await run({ config: cfg(PIXELS), attrs: { 'data-pixels': 'off' } });
  assert.equal(off.injected.length, 0);
  assert.equal(off.beacons.length, 1);
  const bad = await run({ config: cfg({ meta: "1');alert(1)//", google: 'G-ABC', tiktok: '<x>' }) });
  assert.equal(bad.injected.length, 0);
  assert.equal(bad.window.fbq, undefined);
});
