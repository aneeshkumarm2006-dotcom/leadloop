/**
 * sequenceRunner.js — drives email sequences (Phase 4, Comms).
 *
 * Two responsibilities, both idempotent and safe to start once on boot:
 *   1. A per-minute cron sweep of due enrollments (`status: active`,
 *      `nextRunAt <= now`) → send the due step + advance the cursor.
 *   2. An `email.received` listener that stops a contact's active enrollments
 *      when they reply (honouring each sequence's `stopOnReply`).
 *
 * Mirrors `automationRunner.js`: node-cron, a `started` guard, and a start fn
 * wired into `server.js`.
 */

const cron = require('node-cron');
const SequenceEnrollment = require('../models/SequenceEnrollment');
const eventBus = require('./eventBus');
const {
  processEnrollment,
  stopEnrollmentsForReply,
} = require('./sequenceService');

let started = false;
const BATCH = 100;

const tick = async () => {
  const now = new Date();
  const due = await SequenceEnrollment.find({
    status: 'active',
    nextRunAt: { $ne: null, $lte: now },
  })
    .sort({ nextRunAt: 1 })
    .limit(BATCH);

  for (const enrollment of due) {
    try {
      await processEnrollment(enrollment, new Date());
    } catch (err) {
      console.error('[sequence] enrollment', String(enrollment._id), 'error:', err.message);
    }
  }
};

const startSequenceRunner = () => {
  if (started) return;
  started = true;

  // Stop a contact's active enrollments the moment they reply.
  eventBus.on('email.received', async (payload) => {
    try {
      if (payload && payload.taskId) {
        await stopEnrollmentsForReply(payload.taskId);
      }
    } catch (err) {
      console.error('[sequence] reply-stop error:', err.message);
    }
  });

  cron.schedule('* * * * *', () => {
    tick().catch((err) => console.error('[sequence] tick error:', err.message));
  });

  console.log('sequence runner started');
};

module.exports = { startSequenceRunner, tick };
