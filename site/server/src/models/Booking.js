const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Booking — Phase 4b. One confirmed (or cancelled) visit booked through a
 * BookingLink. Holds the slot, the visitor's details + answers, and links to the
 * lead Task it created and the agent it was assigned to. `cancelToken` powers the
 * public cancel/rebook link.
 */
const bookingSchema = new mongoose.Schema(
  {
    link: { type: mongoose.Schema.Types.ObjectId, ref: 'BookingLink', required: true, index: true },
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', index: true },
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation' },
    slotStart: { type: Date, required: true, index: true },
    slotEnd: { type: Date, required: true },
    timezone: { type: String, default: 'America/Toronto' },
    visitor: {
      name: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    answers: { type: [{ _id: false, label: String, value: String }], default: [] },
    // How the visitor chose to meet — picked by the visitor on the booking page
    // (NOT predefined on the link). Virtual = WhatsApp video at visitor.phone.
    meetingType: { type: String, enum: ['in_person', 'virtual'], default: 'in_person' },
    status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed', index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelToken: { type: String, index: true },
    cancelledAt: { type: Date, default: null },
    // Which before_event reminder workflows have already fired for this booking
    // (so the runner never double-sends).
    remindersSent: {
      type: [{ _id: false, workflow: { type: mongoose.Schema.Types.ObjectId, ref: 'BookingWorkflow' }, at: { type: Date, default: Date.now } }],
      default: [],
    },
  },
  { timestamps: true }
);

bookingSchema.pre('validate', function genToken() {
  if (!this.cancelToken) this.cancelToken = crypto.randomBytes(16).toString('hex');
});

module.exports = mongoose.model('Booking', bookingSchema);
