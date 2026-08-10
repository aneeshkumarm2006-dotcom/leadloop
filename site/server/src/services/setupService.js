/**
 * setupService.js — first-run setup checklist.
 *
 * The old product tour stored "seen" in the browser's localStorage: one device,
 * one browser, and no idea whether anything was actually configured. This
 * replaces it with state DERIVED from the workspace's real data, so an item
 * ticks itself when the thing is genuinely done and the whole team sees the
 * same progress.
 *
 * `buildChecklist` is PURE — it takes a counted snapshot, not a database — so
 * the completion rules are unit-tested without Mongo. `getSetupState` gathers
 * the counts and delegates.
 *
 * Only what CANNOT be derived is persisted on the Organisation:
 *   • `setup.wizardCompletedAt`   — did they finish the wizard
 *   • `setup.checklistDismissed`  — did they hide the checklist
 *   • `setup.manualDone[]`        — items with no server-side signal
 *                                   (e.g. installing the phone app)
 */

const Board = require('../models/Board');
const Task = require('../models/Task');
const LeadConnection = require('../models/LeadConnection');

/**
 * The checklist definition. `id` is the stable key the client translates and
 * the `manualDone` list references — never renumber or rename these.
 * `derive(snapshot)` returns true when the step is genuinely done, or null when
 * the step has no server-side signal and must fall back to `manualDone`.
 */
const STEPS = [
  {
    id: 'workspace',
    href: null,
    derive: () => true, // reaching the checklist at all means this happened
  },
  {
    id: 'pipeline',
    href: '/boards?new=1',
    derive: (s) => s.boardCount > 0,
  },
  {
    id: 'firstLead',
    href: '/boards',
    derive: (s) => s.leadCount > 0,
  },
  {
    id: 'inviteTeam',
    href: '/workspace-settings',
    derive: (s) => s.memberCount > 1,
  },
  {
    id: 'leadSource',
    href: '/lead-sources',
    derive: (s) => s.leadSourceCount > 0,
  },
  {
    id: 'businessHours',
    href: '/booking',
    derive: (s) => s.hasBookingHours,
  },
  {
    id: 'installApp',
    href: null,
    derive: () => null, // client-side only — tracked via manualDone
  },
];

/**
 * Pure. Build the checklist from a snapshot of workspace counts.
 *
 * @param {Object} snapshot { boardCount, leadCount, memberCount,
 *                            leadSourceCount, hasBookingHours }
 * @param {Object} [setup]  the org's stored `setup` sub-document
 * @returns {{ steps, total, completed, percent, dismissed, wizardCompleted, allDone }}
 */
const buildChecklist = (snapshot = {}, setup = {}) => {
  const manual = new Set(Array.isArray(setup.manualDone) ? setup.manualDone : []);
  const steps = STEPS.map((step) => {
    const derived = step.derive(snapshot);
    // A derivable step ignores manualDone — reality wins over a stored tick, so
    // a step can also UN-complete (e.g. the last teammate leaves).
    const done = derived === null ? manual.has(step.id) : !!derived;
    return { id: step.id, href: step.href, done, manual: derived === null };
  });

  const completed = steps.filter((s) => s.done).length;
  return {
    steps,
    total: steps.length,
    completed,
    percent: Math.round((completed / steps.length) * 100),
    allDone: completed === steps.length,
    dismissed: !!setup.checklistDismissed,
    wizardCompleted: !!setup.wizardCompletedAt,
  };
};

/** Gather the workspace's real counts and build its checklist. */
const getSetupState = async (org) => {
  const boards = await Board.find({ organisation: org._id }).select('_id').lean();
  const boardIds = boards.map((b) => b._id);

  const [leadCount, leadSourceCount] = await Promise.all([
    boardIds.length
      ? Task.countDocuments({ board: { $in: boardIds }, parent: null, isPersonal: { $ne: true } })
      : 0,
    boardIds.length ? LeadConnection.countDocuments({ boardId: { $in: boardIds } }) : 0,
  ]);

  // Booking hours live on the booking-link model in this codebase; treat "any
  // booking link configured" as the signal. Resolved defensively so a missing
  // model never breaks the checklist.
  let hasBookingHours = false;
  try {
    // eslint-disable-next-line global-require
    const BookingLink = require('../models/BookingLink');
    hasBookingHours = boardIds.length
      ? (await BookingLink.countDocuments({ board: { $in: boardIds } })) > 0
      : false;
  } catch {
    hasBookingHours = false;
  }

  return buildChecklist(
    {
      boardCount: boards.length,
      leadCount,
      memberCount: Array.isArray(org.members) ? org.members.length : 0,
      leadSourceCount,
      hasBookingHours,
    },
    org.setup || {}
  );
};

/** The business profile the wizard writes, serialised for the client. */
const serializeProfile = (org) => ({
  name: org.name,
  country: org.country || null,
  timezone: org.timezone || '',
  currency: org.currency || '',
  businessType: org.businessType || null,
  wizardCompletedAt: org.setup?.wizardCompletedAt || null,
});

/** Sensible currency for a country — the wizard pre-fills, the user can change. */
const defaultCurrencyFor = (country) => (country === 'US' ? 'USD' : country === 'CA' ? 'CAD' : '');

module.exports = {
  STEPS,
  buildChecklist,
  getSetupState,
  serializeProfile,
  defaultCurrencyFor,
  STEP_IDS: STEPS.map((s) => s.id),
};
