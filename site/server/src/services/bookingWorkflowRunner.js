/**
 * bookingWorkflowRunner.js — drives BookingWorkflow reminders.
 *   1. `booking.created` listener → fires `on_booking` workflows immediately.
 *   2. Per-minute cron → fires `before_event` workflows when now reaches
 *      slotStart − beforeMinutes, deduped via the booking's `remindersSent`.
 * Mirrors sequenceRunner/automationRunner (node-cron + a `started` guard).
 */

const cron = require('node-cron');
const eventBus = require('./eventBus');
const Booking = require('../models/Booking');
const BookingWorkflow = require('../models/BookingWorkflow');
const { executeWorkflow, workflowAppliesTo } = require('./bookingWorkflowService');

let started = false;
// Look 48h ahead so 24h (and shorter) reminders are caught well before firing.
const LOOKAHEAD_MS = 48 * 60 * 60 * 1000;

const tick = async () => {
  const now = new Date();
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS);
  const bookings = await Booking.find({
    status: 'confirmed',
    slotStart: { $gt: now, $lte: horizon },
  }).limit(500);
  if (!bookings.length) return;

  const orgIds = [...new Set(bookings.map((b) => String(b.organisation || '')).filter(Boolean))];
  const workflows = await BookingWorkflow.find({
    organisation: { $in: orgIds },
    enabled: true,
    triggerType: 'before_event',
  });
  if (!workflows.length) return;

  for (const booking of bookings) {
    const matching = workflows.filter(
      (w) => String(w.organisation) === String(booking.organisation) && workflowAppliesTo(w, booking.link)
    );
    let mutated = false;
    for (const wf of matching) {
      const fireAt = new Date(booking.slotStart.getTime() - (Number(wf.beforeMinutes) || 0) * 60000);
      if (now < fireAt) continue;
      if ((booking.remindersSent || []).some((r) => String(r.workflow) === String(wf._id))) continue;
      await executeWorkflow(wf, booking).catch((e) => console.error('[booking-workflow] exec:', e.message));
      booking.remindersSent.push({ workflow: wf._id, at: now });
      mutated = true;
    }
    if (mutated) await booking.save().catch(() => {});
  }
};

const startBookingWorkflowRunner = () => {
  if (started) return;
  started = true;

  // Immediate "new booking" alerts.
  eventBus.on('booking.created', async (payload) => {
    try {
      if (!payload || !payload.bookingId) return;
      const booking = await Booking.findById(payload.bookingId);
      if (!booking) return;
      const wfs = await BookingWorkflow.find({
        organisation: booking.organisation,
        enabled: true,
        triggerType: 'on_booking',
      });
      for (const wf of wfs) {
        if (!workflowAppliesTo(wf, booking.link)) continue;
        await executeWorkflow(wf, booking).catch((e) => console.error('[booking-workflow] on-booking:', e.message));
      }
    } catch (e) {
      console.error('[booking-workflow] booking.created handler:', e.message);
    }
  });

  cron.schedule('* * * * *', () => {
    tick().catch((e) => console.error('[booking-workflow] tick:', e.message));
  });
  console.log('booking workflow runner started');
};

module.exports = { startBookingWorkflowRunner, tick };
