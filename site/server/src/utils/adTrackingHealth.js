/**
 * adTrackingHealth.js — the ad-tracking setup checklist and the health rules
 * behind "your lead source went quiet" / "conversion sends are failing" alerts.
 *
 * PURE: everything takes a snapshot + clock and returns a decision, so the
 * rules are unit-tested without Mongo. services/adTrackingService.js gathers
 * the snapshot and acts on the decisions.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MIN_SILENCE_MS = 48 * HOUR;
const MAX_SILENCE_MS = 14 * DAY;
const MIN_SUBMISSIONS_TO_MONITOR = 3;
const FAILURE_ALERT_EVERY_MS = DAY;

/**
 * The checklist. Steps derive from real data, so they tick themselves (and
 * un-tick if something breaks, e.g. Meta switched off). `optional` steps don't
 * count towards completion.
 *
 * @param {Object} s snapshot — see adTrackingService.getChecklist
 */
const buildAdTrackingChecklist = (s = {}) => {
  const steps = [
    { id: 'websiteSource', done: s.websiteSources > 0, href: '/lead-sources' },
    { id: 'firstSubmission', done: s.websiteSubmissions > 0, href: '/lead-sources' },
    { id: 'adClicks', done: s.attributedLeads > 0, href: null },
    { id: 'consent', done: s.consentedLeads > 0, href: null },
    { id: 'stages', done: s.rulesCount > 0, href: '/settings?tab=ads' },
    { id: 'metaConnect', done: !!s.metaConnected, href: '/settings?tab=ads' },
    { id: 'metaVerified', done: !!s.metaVerified, href: '/settings?tab=ads' },
    { id: 'metaLive', done: !!s.metaLive, href: '/settings?tab=ads' },
    { id: 'google', done: !!s.googleConnected, href: '/settings?tab=ads', optional: true },
  ];
  const required = steps.filter((x) => !x.optional);
  const completed = required.filter((x) => x.done).length;
  const next = steps.find((x) => !x.done && !x.optional) || null;
  return {
    steps,
    completed,
    total: required.length,
    percent: Math.round((completed / required.length) * 100),
    allDone: completed === required.length,
    nextStepId: next ? next.id : null,
  };
};

/**
 * Has a lead source gone quiet? Learns each source's normal pace: silence is
 * "3× the average gap between its leads", never less than 48h nor more than
 * 14 days. Sources with fewer than 3 leads aren't monitored (no pace yet).
 *
 * `shouldAlert` is true once per silence: after alerting, it re-arms only when
 * a new lead arrives (lastSubmissionAt moves past alertedAt).
 */
const silenceVerdict = ({ submissionCount, createdAt, lastSubmissionAt, alertedAt, now = new Date() }) => {
  if (!lastSubmissionAt || (submissionCount || 0) < MIN_SUBMISSIONS_TO_MONITOR) {
    return { monitored: false, silent: false, shouldAlert: false, thresholdMs: null, silentForMs: 0 };
  }
  const last = new Date(lastSubmissionAt).getTime();
  const start = new Date(createdAt || lastSubmissionAt).getTime();
  const avgGap = Math.max(0, last - start) / Math.max(1, submissionCount - 1);
  const thresholdMs = Math.min(MAX_SILENCE_MS, Math.max(MIN_SILENCE_MS, 3 * avgGap));
  const silentForMs = new Date(now).getTime() - last;
  const silent = silentForMs > thresholdMs;
  const alreadyAlerted = alertedAt && new Date(alertedAt).getTime() >= last;
  return { monitored: true, silent, shouldAlert: silent && !alreadyAlerted, thresholdMs, silentForMs };
};

/** Alert about failed conversion sends at most once a day. */
const failureVerdict = ({ failedCount, lastAlertAt, now = new Date() }) => {
  if (!failedCount) return { shouldAlert: false };
  if (lastAlertAt && new Date(now).getTime() - new Date(lastAlertAt).getTime() < FAILURE_ALERT_EVERY_MS) {
    return { shouldAlert: false };
  }
  return { shouldAlert: true };
};

/** "3 days" / "36 hours" — for alert copy. */
const humanDuration = (ms) => {
  const hours = Math.round(ms / HOUR);
  if (hours < 48) return `${hours} hours`;
  return `${Math.round(ms / DAY)} days`;
};

module.exports = {
  buildAdTrackingChecklist,
  silenceVerdict,
  failureVerdict,
  humanDuration,
  MIN_SILENCE_MS,
  MAX_SILENCE_MS,
  MIN_SUBMISSIONS_TO_MONITOR,
};
