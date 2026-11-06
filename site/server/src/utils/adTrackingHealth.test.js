/**
 * adTrackingHealth.test.js — checklist + health alert rules.
 * Run: node --test src/utils/adTrackingHealth.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./adTrackingHealth');

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const NOW = new Date('2026-11-06T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);

test('checklist: empty workspace → first step is connecting the website', () => {
  const c = H.buildAdTrackingChecklist({});
  assert.equal(c.completed, 0);
  assert.equal(c.total, 8); // google is optional
  assert.equal(c.nextStepId, 'websiteSource');
  assert.equal(c.allDone, false);
});

test('checklist: Bo Payments-like state → only "go live" left', () => {
  const c = H.buildAdTrackingChecklist({
    websiteSources: 1,
    websiteSubmissions: 1,
    attributedLeads: 1,
    consentedLeads: 1,
    rulesCount: 2,
    metaConnected: true,
    metaVerified: true,
    metaLive: false,
    googleConnected: false,
  });
  assert.equal(c.completed, 7);
  assert.equal(c.nextStepId, 'metaLive');
  assert.equal(c.percent, 88);
});

test('checklist: everything required done = allDone even without Google', () => {
  const c = H.buildAdTrackingChecklist({
    websiteSources: 1, websiteSubmissions: 4, attributedLeads: 2, consentedLeads: 2,
    rulesCount: 1, metaConnected: true, metaVerified: true, metaLive: true,
  });
  assert.equal(c.allDone, true);
  assert.equal(c.nextStepId, null);
  assert.equal(c.steps.find((s) => s.id === 'google').done, false);
});

test('silence: sources with < 3 leads are not monitored', () => {
  const v = H.silenceVerdict({ submissionCount: 2, createdAt: ago(30 * DAY), lastSubmissionAt: ago(20 * DAY), now: NOW });
  assert.equal(v.monitored, false);
  assert.equal(v.shouldAlert, false);
});

test('silence: busy source (a lead every few hours) alerts after the 48h floor', () => {
  // 40 leads over 5 days → avg gap ~3h → 3x = 9h, floored to 48h
  const base = { submissionCount: 40, createdAt: ago(7 * DAY), now: NOW };
  assert.equal(H.silenceVerdict({ ...base, lastSubmissionAt: ago(47 * HOUR) }).shouldAlert, false);
  const v = H.silenceVerdict({ ...base, lastSubmissionAt: ago(49 * HOUR) });
  assert.equal(v.thresholdMs, H.MIN_SILENCE_MS);
  assert.equal(v.shouldAlert, true);
});

test('silence: slow source (a lead every ~3 days) waits ~9 days before alerting', () => {
  // 5 leads over 12 days → avg gap 3 days → threshold 9 days
  const base = { submissionCount: 5, createdAt: ago(20 * DAY), now: NOW };
  const quiet6 = H.silenceVerdict({ ...base, lastSubmissionAt: ago(6 * DAY), createdAt: ago(18 * DAY) });
  assert.equal(quiet6.shouldAlert, false);
  const quiet10 = H.silenceVerdict({ ...base, lastSubmissionAt: ago(10 * DAY), createdAt: ago(22 * DAY) });
  assert.equal(quiet10.shouldAlert, true);
});

test('silence: never waits longer than 14 days', () => {
  const v = H.silenceVerdict({ submissionCount: 3, createdAt: ago(200 * DAY), lastSubmissionAt: ago(15 * DAY), now: NOW });
  assert.equal(v.thresholdMs, H.MAX_SILENCE_MS);
  assert.equal(v.shouldAlert, true);
});

test('silence: alerts once, re-arms when leads resume', () => {
  const base = { submissionCount: 40, createdAt: ago(10 * DAY), now: NOW };
  const silentSince = ago(3 * DAY);
  assert.equal(H.silenceVerdict({ ...base, lastSubmissionAt: silentSince, alertedAt: ago(1 * DAY) }).shouldAlert, false);
  // a new lead arrived after the alert, then went quiet again → alert again
  assert.equal(H.silenceVerdict({ ...base, lastSubmissionAt: ago(3 * DAY), alertedAt: ago(5 * DAY) }).shouldAlert, true);
});

test('failures: alert at most once a day', () => {
  assert.equal(H.failureVerdict({ failedCount: 0, now: NOW }).shouldAlert, false);
  assert.equal(H.failureVerdict({ failedCount: 2, now: NOW }).shouldAlert, true);
  assert.equal(H.failureVerdict({ failedCount: 2, lastAlertAt: ago(3 * HOUR), now: NOW }).shouldAlert, false);
  assert.equal(H.failureVerdict({ failedCount: 2, lastAlertAt: ago(25 * HOUR), now: NOW }).shouldAlert, true);
});

test('humanDuration', () => {
  assert.equal(H.humanDuration(36 * HOUR), '36 hours');
  assert.equal(H.humanDuration(3 * DAY), '3 days');
});
