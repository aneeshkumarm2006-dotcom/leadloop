/**
 * slaService.js — the speed-to-lead clock.
 *
 * Responding in minutes rather than hours is the single biggest conversion
 * lever in real estate: a lead that waits an hour has usually already spoken to
 * someone else. LeadLoop already had round-robin assignment and automations;
 * what was missing was a CLOCK, and something that takes the lead back when
 * nobody answers it.
 *
 * The rules are pure and tested here; the DB work lives in slaRunner.js.
 *
 * Lifecycle of an inbound lead:
 *   created ──► pending ──(agent replies)──► responded   (clock stopped)
 *                  │
 *                  ├──(target passed)──────► breached    (escalate + reassign)
 *                  └──(no owner)───────────► unassigned
 */

/** Defaults, overridable per workspace. */
const DEFAULTS = {
  targetMinutes: 5, // respond within this
  warnAtPercent: 70, // "running out" styling in the UI
  escalateAfterMinutes: 10, // hand to the team lead / reassign after this
  reassign: true, // actually move the lead on breach
  enabled: true,
};

const STATE = {
  RESPONDED: 'responded',
  PENDING: 'pending',
  WARNING: 'warning',
  BREACHED: 'breached',
};

const ms = (minutes) => minutes * 60 * 1000;

/** Merge a workspace's stored policy over the defaults, ignoring junk values. */
const resolvePolicy = (raw = {}) => {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    targetMinutes: num(raw.targetMinutes, DEFAULTS.targetMinutes),
    warnAtPercent: Math.min(99, num(raw.warnAtPercent, DEFAULTS.warnAtPercent)),
    escalateAfterMinutes: num(raw.escalateAfterMinutes, DEFAULTS.escalateAfterMinutes),
    reassign: raw.reassign === undefined ? DEFAULTS.reassign : !!raw.reassign,
    enabled: raw.enabled === undefined ? DEFAULTS.enabled : !!raw.enabled,
  };
};

/** When must this lead be answered by? */
const dueAt = (createdAt, policy = DEFAULTS) =>
  new Date(new Date(createdAt).getTime() + ms(resolvePolicy(policy).targetMinutes));

/**
 * Evaluate a lead's clock.
 *
 * @param {Object} lead  { createdAt, firstResponseAt?, slaDueAt?, assignedTo? }
 * @param {Object} policy
 * @param {Date} now
 * @returns {{ state, msRemaining, msLate, percentElapsed, dueAt, shouldEscalate }}
 */
const evaluate = (lead = {}, policy = DEFAULTS, now = new Date()) => {
  const p = resolvePolicy(policy);
  const created = new Date(lead.createdAt || now);
  const due = lead.slaDueAt ? new Date(lead.slaDueAt) : dueAt(created, p);
  const nowMs = new Date(now).getTime();

  // Answered — the clock stops for good, even if the reply was late. The
  // response TIME still gets reported; the state is simply no longer pending.
  if (lead.firstResponseAt) {
    const responded = new Date(lead.firstResponseAt);
    return {
      state: STATE.RESPONDED,
      msRemaining: 0,
      msLate: Math.max(0, responded.getTime() - due.getTime()),
      responseMs: Math.max(0, responded.getTime() - created.getTime()),
      percentElapsed: 100,
      dueAt: due,
      shouldEscalate: false,
      metTarget: responded.getTime() <= due.getTime(),
    };
  }

  const total = Math.max(1, due.getTime() - created.getTime());
  const elapsed = nowMs - created.getTime();
  const percentElapsed = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  const msRemaining = due.getTime() - nowMs;

  if (msRemaining <= 0) {
    const msLate = -msRemaining;
    return {
      state: STATE.BREACHED,
      msRemaining: 0,
      msLate,
      percentElapsed: 100,
      dueAt: due,
      // Escalate only once the grace period past the target has also passed —
      // otherwise every breach pages the team lead the same second it happens.
      shouldEscalate: p.reassign && msLate >= ms(p.escalateAfterMinutes - p.targetMinutes >= 0
        ? p.escalateAfterMinutes - p.targetMinutes
        : 0),
      metTarget: false,
    };
  }

  return {
    state: percentElapsed >= p.warnAtPercent ? STATE.WARNING : STATE.PENDING,
    msRemaining,
    msLate: 0,
    percentElapsed,
    dueAt: due,
    shouldEscalate: false,
    metTarget: null,
  };
};

/**
 * Roll a set of evaluated leads into the numbers the dashboard shows.
 * Median rather than mean: one lead answered three days later would drag an
 * average into meaninglessness.
 */
const summarise = (evaluations = []) => {
  const responded = evaluations.filter((e) => e.state === STATE.RESPONDED);
  const times = responded.map((e) => e.responseMs).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);

  let medianMs = null;
  if (times.length) {
    const mid = Math.floor(times.length / 2);
    medianMs = times.length % 2 ? times[mid] : Math.round((times[mid - 1] + times[mid]) / 2);
  }

  const metCount = responded.filter((e) => e.metTarget).length;
  return {
    total: evaluations.length,
    responded: responded.length,
    pending: evaluations.filter((e) => e.state === STATE.PENDING || e.state === STATE.WARNING).length,
    breached: evaluations.filter((e) => e.state === STATE.BREACHED).length,
    medianMs,
    withinTargetPercent: responded.length ? Math.round((metCount / responded.length) * 100) : null,
  };
};

/** "3:12" / "1h 04m" — compact, for the countdown UI. */
const formatDuration = (msValue) => {
  const total = Math.max(0, Math.round(msValue / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
};

module.exports = {
  DEFAULTS,
  STATE,
  resolvePolicy,
  dueAt,
  evaluate,
  summarise,
  formatDuration,
};
