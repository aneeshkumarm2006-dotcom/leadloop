const mongoose = require('mongoose');

/**
 * PushSubscription — one browser/device an agent wants lead alerts on.
 *
 * A person legitimately has several (phone, laptop, tablet), so this is keyed
 * by the push `endpoint` rather than by user: the endpoint IS the device. When
 * a browser rotates its subscription the old endpoint stops working and the
 * sender deletes it (see pushService.pruneDead).
 *
 * `prefs` lives here rather than on User because notification choices are
 * per-device in practice — an agent may want lead alerts on their phone but not
 * on the laptop they leave open at the office.
 */

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organisation: { type: mongoose.Schema.Types.ObjectId, ref: 'Organisation', required: true, index: true },

    // The Web Push endpoint URL — unique per browser install.
    endpoint: { type: String, required: true, unique: true },
    // Encryption material from PushManager.subscribe().
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },

    userAgent: { type: String, default: '' },

    /** What this device wants to be woken for. */
    prefs: {
      leadAssigned: { type: Boolean, default: true },
      slaWarning: { type: Boolean, default: true },
      bookingChanged: { type: Boolean, default: true },
      leadReplied: { type: Boolean, default: true },
    },

    // Bumped on every successful send; used to spot stale devices.
    lastSentAt: { type: Date, default: null },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

pushSubscriptionSchema.index({ organisation: 1, user: 1 });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
