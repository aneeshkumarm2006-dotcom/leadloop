/**
 * pushService.js — lead alerts on an agent's phone.
 *
 * The speed-to-lead clock only works if the agent KNOWS a lead arrived. The PWA
 * is already installed on their home screen; this is what makes it tap them on
 * the shoulder.
 *
 * Configuration: VAPID keys identify this server to the push services.
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https: URL)
 * Generate a pair once with:  npx web-push generate-vapid-keys
 *
 * With no keys configured, `isConfigured()` is false and every send is a no-op
 * — the app runs perfectly well without push, so a missing key must never
 * throw inside an event handler.
 *
 * `buildNotification` is pure and tested: getting the copy right matters more
 * than the transport, because a notification that doesn't say WHICH lead and
 * HOW URGENT is just noise people switch off.
 */

const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

let configured = null;

/** Lazily configure VAPID; null keys → push disabled rather than crashing. */
const isConfigured = () => {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    configured = false;
    return configured;
  }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@leadloop.app', pub, priv);
    configured = true;
  } catch (err) {
    console.warn('push disabled — invalid VAPID keys:', err.message);
    configured = false;
  }
  return configured;
};

/** The public key the browser needs in order to subscribe. */
const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

/**
 * Which preference gates a given notification kind. Keep in sync with
 * PushSubscription.prefs.
 */
const PREF_FOR_KIND = {
  lead_assigned: 'leadAssigned',
  sla_warning: 'slaWarning',
  sla_breached: 'slaWarning',
  booking_changed: 'bookingChanged',
  lead_replied: 'leadReplied',
};

/**
 * Pure. Build the payload a device receives.
 *
 * Rules learned from notifications people actually keep switched on:
 *   • name the lead — "New lead" alone is useless in a list of five;
 *   • say what is expected — a deadline beats an adjective;
 *   • deep-link to the exact record, never the home screen.
 *
 * @returns {{ title, body, tag, url, kind, requireInteraction }}
 */
const buildNotification = (kind, data = {}) => {
  const name = String(data.leadName || '').trim() || 'A lead';
  const url = data.taskId
    ? `/boards/${data.boardId || ''}?task=${data.taskId}`
    : data.boardId
      ? `/boards/${data.boardId}`
      : '/workspace';

  switch (kind) {
    case 'lead_assigned':
      return {
        kind,
        title: 'New lead — act now',
        body: data.minutes
          ? `${name}${data.source ? ` from ${data.source}` : ''}. You have ${data.minutes} minutes.`
          : `${name}${data.source ? ` from ${data.source}` : ''} is yours.`,
        tag: `lead-${data.taskId || name}`,
        url,
        requireInteraction: true,
      };
    case 'sla_warning':
      return {
        kind,
        title: 'Lead still waiting',
        body: `${name} has not been contacted yet. Your response time is nearly up.`,
        tag: `sla-${data.taskId || name}`,
        url,
        requireInteraction: true,
      };
    case 'sla_breached':
      return {
        kind,
        title: 'Lead reassigned',
        body: `${name} went unanswered and has been passed to someone else.`,
        tag: `sla-${data.taskId || name}`,
        url,
        requireInteraction: false,
      };
    case 'booking_changed':
      return {
        kind,
        title: data.cancelled ? 'Tour cancelled' : 'Tour booked',
        body: data.when ? `${name} — ${data.when}` : name,
        tag: `booking-${data.bookingId || name}`,
        url,
        requireInteraction: false,
      };
    case 'lead_replied':
      return {
        kind,
        title: `${name} replied`,
        body: String(data.preview || '').slice(0, 120) || 'Open the conversation.',
        tag: `reply-${data.taskId || name}`,
        url,
        requireInteraction: false,
      };
    default:
      return {
        kind: 'generic',
        title: 'LeadLoop',
        body: String(data.body || '').slice(0, 140) || 'You have an update.',
        tag: 'leadloop',
        url,
        requireInteraction: false,
      };
  }
};

/**
 * Send a notification to every device a user has registered in a workspace.
 * Never throws: a failed push must not break the event that triggered it.
 *
 * @returns {Promise<{ sent:number, removed:number }>}
 */
const notifyUser = async (userId, organisationId, kind, data = {}) => {
  if (!isConfigured() || !userId) return { sent: 0, removed: 0 };

  const query = { user: userId };
  if (organisationId) query.organisation = organisationId;
  const subs = await PushSubscription.find(query).lean();
  if (!subs.length) return { sent: 0, removed: 0 };

  const prefKey = PREF_FOR_KIND[kind];
  const payload = JSON.stringify(buildNotification(kind, data));

  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (sub) => {
      // Respect this device's preferences.
      if (prefKey && sub.prefs && sub.prefs[prefKey] === false) return;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
          { TTL: 3600 }
        );
        sent += 1;
        await PushSubscription.updateOne({ _id: sub._id }, { $set: { lastSentAt: new Date(), failureCount: 0 } });
      } catch (err) {
        // 404/410 mean the browser dropped this subscription — delete it rather
        // than retrying a dead endpoint forever.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
          removed += 1;
        } else {
          await PushSubscription.updateOne({ _id: sub._id }, { $inc: { failureCount: 1 } });
        }
      }
    })
  );

  return { sent, removed };
};

/** Fire-and-forget wrapper for event handlers. */
const notifySafely = (userId, organisationId, kind, data) =>
  notifyUser(userId, organisationId, kind, data).catch((err) => {
    console.warn('push notify failed:', err.message);
    return { sent: 0, removed: 0 };
  });

module.exports = {
  isConfigured,
  publicKey,
  PREF_FOR_KIND,
  buildNotification,
  notifyUser,
  notifySafely,
};
