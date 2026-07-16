const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * BookingLink — Phase 4b. A Calendly-style public visit-booking link for ONE
 * building/property. Tied to a board (its calendar) + a target group where new
 * bookings land. Availability is set manually (weekly hours + date overrides).
 *
 * Published at `/book/:slug` (frontend-served, like public Forms `/f/:slug`).
 */
const weeklyHoursSchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    start: { type: String, default: '09:00' }, // "HH:MM" wall-clock in `timezone`
    end: { type: String, default: '17:00' },
  },
  { _id: false }
);

const dateOverrideSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // "YYYY-MM-DD"
    unavailable: { type: Boolean, default: false },
    windows: { type: [{ _id: false, start: String, end: String }], default: [] },
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, default: '' },
    type: { type: String, enum: ['text', 'textarea', 'phone', 'email'], default: 'text' },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

const DEFAULT_WEEKLY = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, start: '09:00', end: '17:00' }));

const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);

const bookingLinkSchema = new mongoose.Schema(
  {
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', index: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'TaskGroup', required: true },
    title: { type: String, required: true, trim: true }, // building / property name
    slug: { type: String, unique: true, index: true },
    durationMinutes: { type: Number, default: 30 },
    // The property address, shown when a visitor chooses an in-person visit.
    // The in-person vs virtual (WhatsApp video) choice is made by the visitor at
    // booking time and stored on the Booking — it is NOT predefined here.
    location: { type: String, default: '' },
    timezone: { type: String, default: 'America/Toronto' },
    weeklyHours: { type: [weeklyHoursSchema], default: () => DEFAULT_WEEKLY.map((w) => ({ ...w })) },
    dateOverrides: { type: [dateOverrideSchema], default: [] },
    bufferBefore: { type: Number, default: 0 },
    bufferAfter: { type: Number, default: 0 },
    dailyCap: { type: Number, default: 0 }, // 0 = unlimited
    minNoticeHours: { type: Number, default: 2 },
    dateRangeDays: { type: Number, default: 30 },
    slotInterval: { type: Number, default: 0 }, // 0 = step by duration
    questions: { type: [questionSchema], default: [] },
    // Auto-assignment of the agent for a booking.
    assignMode: { type: String, enum: ['fixed', 'round_robin'], default: 'round_robin' },
    agents: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    lastAssignedIndex: { type: Number, default: 0 },
    // Which board columns to write the booking onto.
    dateColumnId: { type: String, default: null }, // visit datetime → shows on Calendar
    nameColumnId: { type: String, default: null },
    emailColumnId: { type: String, default: null },
    phoneColumnId: { type: String, default: null },
    branding: {
      type: new mongoose.Schema(
        {
          logoUrl: { type: String, default: '' },
          coverUrl: { type: String, default: '' },
          accentColor: { type: String, default: '' },
          headline: { type: String, default: '' },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

bookingLinkSchema.pre('validate', function generateSlug() {
  if (this.slug) return;
  const base = slugify(this.title) || 'visit';
  const suffix = crypto.randomBytes(3).toString('hex');
  this.slug = `${base}-${suffix}`;
});

module.exports = mongoose.model('BookingLink', bookingLinkSchema);
