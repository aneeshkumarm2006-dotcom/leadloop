/**
 * BookingWorkflow.js — automated reminder/alert emails for property-tour
 * bookings (the Calendly-style "Workflows" feature).
 *
 * A workflow is org-scoped and applies to one or more booking links (event
 * types — empty `links` = all event types in the org). It fires either:
 *   - on_booking    : immediately when a new visit is booked, or
 *   - before_event  : `beforeMinutes` before the visit start (e.g. 1440 = 24h, 120 = 2h)
 * running its `actions` (emails to the invitee / host agent / a fixed address),
 * with templated subject/body interpolated from booking variables.
 */

const mongoose = require('mongoose');

const ACTION_TYPES = ['email_invitee', 'email_host', 'email_other'];

const actionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ACTION_TYPES, default: 'email_invitee' },
    recipientEmail: { type: String, default: '' }, // for email_other
    subject: { type: String, default: '' },
    body: { type: String, default: '' }, // text/HTML with {{Variable}} tokens
  },
  { _id: false }
);

const bookingWorkflowSchema = new mongoose.Schema(
  {
    organisation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organisation',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    // Event types (booking links) this applies to. Empty = every event type.
    links: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BookingLink' }], default: [] },
    enabled: { type: Boolean, default: true },
    triggerType: { type: String, enum: ['on_booking', 'before_event'], default: 'before_event' },
    // Minutes before slotStart to fire (for before_event). 1440 = 24h, 120 = 2h.
    beforeMinutes: { type: Number, default: 1440 },
    actions: { type: [actionSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

bookingWorkflowSchema.statics.ACTION_TYPES = ACTION_TYPES;

module.exports =
  mongoose.models.BookingWorkflow ||
  mongoose.model('BookingWorkflow', bookingWorkflowSchema);
