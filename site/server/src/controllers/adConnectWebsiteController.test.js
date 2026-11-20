/**
 * adConnectWebsiteController.test.js — pure helpers: URL picking (domain lock
 * for the site check), plugin zip, developer email.
 * Run: node --test src/controllers/adConnectWebsiteController.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

require('../models');
const c = require('./adConnectWebsiteController');

const has = (bin, args) => {
  try {
    execFileSync(bin, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

test('pickCheckUrl: defaults to the first domain; custom URL must be on an allowed domain', () => {
  const domains = ['bopayments.com', 'acme.io'];
  assert.deepEqual(c.pickCheckUrl(undefined, domains), { url: 'https://bopayments.com/' });
  assert.deepEqual(c.pickCheckUrl('', domains), { url: 'https://bopayments.com/' });
  assert.equal(c.pickCheckUrl('www.bopayments.com/contact#x', domains).url, 'https://www.bopayments.com/contact');
  assert.equal(c.pickCheckUrl('http://shop.acme.io/', domains).url, 'http://shop.acme.io/');
  for (const bad of ['https://evilbopayments.com/', 'https://bopayments.com.evil.io/', 'http://169.254.169.254/', 'file:///etc/passwd', 'ftp://acme.io/', 42, 'x'.repeat(2001)]) {
    assert.ok(c.pickCheckUrl(bad, domains).error, String(bad).slice(0, 40));
  }
  assert.ok(c.pickCheckUrl(undefined, []).error);
});

test('normalizeEmail', () => {
  assert.equal(c.normalizeEmail(' dev@agency.co.uk '), 'dev@agency.co.uk');
  for (const bad of ['', 'nope', 'a@b', 'a@b.c', 'a b@c.com', 'a@b.com\r\nBcc: x@y.com', 'a,b@c.com', '<a@b.com>', 42, null, `${'a'.repeat(250)}@b.com`]) {
    assert.equal(c.normalizeEmail(bad), '', String(bad));
  }
});

test('buildDeveloperEmail: escapes user-controlled names and the tag; strips newlines from the subject', () => {
  const tag = '<script src="https://api.test/capture.js" data-site="site_abcdefgh" defer></script>';
  const m = c.buildDeveloperEmail({
    builder: 'webflow',
    snippetTag: tag,
    site: 'bopayments.com',
    senderName: 'Eve <img src=x onerror=alert(1)>\r\nBcc: x@y.com',
    workspaceName: 'Acme & Co',
  });
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.match(m.subject, /bopayments\.com \(Webflow\)/);
  assert.ok(!m.html.includes('<img'));
  assert.ok(!m.html.includes('<script'));
  assert.ok(m.html.includes('Acme &amp; Co'));
  assert.ok(m.text.includes(tag));
});

const PLUGIN_FILES = Object.fromEntries(['leadloop.php', 'readme.txt'].map((f) => [f, fs.readFileSync(path.join(c.PLUGIN_DIR, f), 'utf8')]));

test('buildPluginZip: refuses a malformed key or origin', () => {
  assert.throws(() => c.buildPluginZip({ siteKey: "site_x'; system('id'); //", origin: 'https://api.test', files: PLUGIN_FILES }));
  assert.throws(() => c.buildPluginZip({ siteKey: 'site_abcdefgh2345', origin: "https://a.test/'.phpinfo().'", files: PLUGIN_FILES }));
  assert.throws(() => c.buildPluginZip({ siteKey: 'site_abcdefgh2345', origin: 'javascript:alert(1)', files: PLUGIN_FILES }));
});

test('buildPluginZip: valid zip with the key + script URL filled in', { skip: !has('unzip', ['-v']) && 'unzip not installed' }, () => {
  const zip = c.buildPluginZip({ siteKey: 'site_abcdefgh2345', origin: 'https://api.leadloop.test', files: PLUGIN_FILES });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llplugin-'));
  try {
    const file = path.join(dir, 'leadloop.zip');
    fs.writeFileSync(file, zip);
    assert.match(execFileSync('unzip', ['-t', file], { encoding: 'utf8' }), /No errors detected/);
    assert.deepEqual(execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n'), [
      'leadloop/',
      'leadloop/leadloop.php',
      'leadloop/readme.txt',
    ]);
    const php = execFileSync('unzip', ['-p', file, 'leadloop/leadloop.php'], { encoding: 'utf8' });
    assert.ok(php.includes("define( 'LEADLOOP_DEFAULT_SITE_KEY', 'site_abcdefgh2345' );"));
    assert.ok(php.includes("define( 'LEADLOOP_SCRIPT_URL', 'https://api.leadloop.test/capture.js' );"));
    assert.ok(!php.includes('{{'));
    if (has('php', ['-v'])) {
      fs.writeFileSync(path.join(dir, 'leadloop.php'), php);
      assert.match(execFileSync('php', ['-l', path.join(dir, 'leadloop.php')], { encoding: 'utf8' }), /No syntax errors/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
