/**
 * pushController.js — device registration for lead alerts.
 *
 *   GET    /api/push/key                (member) VAPID public key + enabled flag
 *   POST   /api/push/subscribe          (member) register this device
 *   POST   /api/push/unsubscribe        (member) drop this device
 *   PUT    /api/push/prefs              (member) what this device wants
 *   POST   /api/push/test               (member) send yourself one
 */

const mongoose = require('mongoose');
const Organisation = require('../models/Organisation');
const PushSubscription = require('../models/PushSubscription');
const { publicKey, isConfigured, notifyUser } = require('../services/pushService');

const memberOf = async (orgId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(orgId)) return null;
  const org = await Organisation.findById(orgId).select('members');
  if (!org || !org.members.some((m) => m.toString() === userId)) return null;
  return org;
};

const getKey = async (req, res) =>
  res.json({ enabled: isConfigured(), publicKey: publicKey() });

/** POST /api/push/subscribe — body: { org, subscription } */
const subscribe = async (req, res) => {
  try {
    const org = await memberOf(req.body?.org, req.user.userId);
    if (!org) return res.status(403).json({ error: 'Not a member of this workspace' });

    const sub = req.body?.subscription || {};
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return res.status(400).json({ error: 'Invalid push subscription' });
    }

    // Keyed by endpoint: re-subscribing the same browser updates rather than
    // creating a duplicate device.
    const row = await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      {
        $set: {
          user: req.user.userId,
          organisation: org._id,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          userAgent: req.headers['user-agent'] || '',
          failureCount: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({ subscribed: true, prefs: row.prefs });
  } catch (err) {
    console.error('push subscribe error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/push/unsubscribe — body: { endpoint } */
const unsubscribe = async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '');
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    await PushSubscription.deleteOne({ endpoint, user: req.user.userId });
    return res.json({ unsubscribed: true });
  } catch (err) {
    console.error('push unsubscribe error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PUT /api/push/prefs — body: { endpoint, prefs } */
const updatePrefs = async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '');
    const prefs = req.body?.prefs || {};
    const row = await PushSubscription.findOne({ endpoint, user: req.user.userId });
    if (!row) return res.status(404).json({ error: 'This device is not registered' });
    for (const key of ['leadAssigned', 'slaWarning', 'bookingChanged', 'leadReplied']) {
      if (prefs[key] !== undefined) row.prefs[key] = !!prefs[key];
    }
    await row.save();
    return res.json({ prefs: row.prefs });
  } catch (err) {
    console.error('push prefs error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /api/push/status?org= — is this workspace's user registered anywhere? */
const status = async (req, res) => {
  try {
    const org = await memberOf(req.query.org, req.user.userId);
    if (!org) return res.status(403).json({ error: 'Not a member of this workspace' });
    const devices = await PushSubscription.find({ user: req.user.userId, organisation: org._id })
      .select('endpoint prefs userAgent createdAt lastSentAt')
      .lean();
    return res.json({ enabled: isConfigured(), devices });
  } catch (err) {
    console.error('push status error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/push/test — prove to the user it works. */
const sendTest = async (req, res) => {
  try {
    const org = await memberOf(req.body?.org, req.user.userId);
    if (!org) return res.status(403).json({ error: 'Not a member of this workspace' });
    const out = await notifyUser(req.user.userId, org._id, 'generic', {
      body: 'Push notifications are working. New leads will reach you here.',
    });
    return res.json(out);
  } catch (err) {
    console.error('push test error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getKey, subscribe, unsubscribe, updatePrefs, status, sendTest };
