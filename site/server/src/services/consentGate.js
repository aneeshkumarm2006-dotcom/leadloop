/**
 * consentGate.js — the database-backed wrapper around consentService.
 *
 * consentService decides; this resolves the facts it decides on: the lead's
 * consent record, and whether the address/number is suppressed. Outbound
 * channels call `checkSend` and refuse when it says no.
 *
 * It deliberately checks BOTH suppression stores:
 *   • the new workspace-wide `Suppression` (email unsubscribes, DNC, manual)
 *   • the existing `SmsOptOut` written by the SMS STOP handler
 * so an opt-out recorded by either path blocks. Consolidating them would mean a
 * migration and a window where a STOP could be missed — checking both is the
 * safer route, and the older store keeps working untouched.
 */

const Suppression = require('../models/Suppression');
const LeadConsent = require('../models/LeadConsent');
const { canSend, STATES } = require('./consentService');
const { normalizeEmail, normalizePhone } = require('./dedupeService');

/** Normalise an identifier into the key Suppression stores. */
const normalizeKey = (kind, raw) =>
  kind === 'email' ? normalizeEmail(raw) : normalizePhone(raw);

/** Which identifier a channel uses. */
const kindForChannel = (channel) => (channel === 'email' ? 'email' : 'phone');

/**
 * Is this identifier suppressed in this workspace? Checks the unified list and,
 * for phone numbers, the legacy SMS opt-out store.
 */
const isSuppressed = async (organisation, channel, identifier) => {
  const kind = kindForChannel(channel);
  const value = normalizeKey(kind, identifier);
  if (!organisation || !value) return false;

  const hit = await Suppression.findOne({ organisation, kind, value }).select('_id').lean();
  if (hit) return true;

  if (kind === 'phone') {
    try {
      // eslint-disable-next-line global-require
      const smsService = require('./smsService');
      if (typeof smsService.isOptedOut === 'function') {
        return !!(await smsService.isOptedOut(organisation, identifier));
      }
    } catch {
      /* legacy store unavailable — the unified list still applied above */
    }
  }
  return false;
};

/**
 * Record a suppression. Idempotent, so replaying a STOP is harmless.
 */
const suppress = async (organisation, channel, identifier, { reason = 'manual', note = '', userId = null } = {}) => {
  const kind = kindForChannel(channel);
  const value = normalizeKey(kind, identifier);
  if (!organisation || !value) return null;
  return Suppression.findOneAndUpdate(
    { organisation, kind, value },
    {
      $setOnInsert: {
        organisation,
        kind,
        value,
        display: String(identifier || ''),
        reason,
        note,
        createdBy: userId,
      },
    },
    { upsert: true, new: true }
  );
};

/** Remove a suppression (someone opts back in, or it was added by mistake). */
const unsuppress = async (organisation, kind, identifier) => {
  const value = normalizeKey(kind, identifier);
  if (!organisation || !value) return false;
  const res = await Suppression.deleteOne({ organisation, kind, value });
  return (res.deletedCount || 0) > 0;
};

/**
 * The full check an outbound channel should make before sending.
 *
 * @param {Object} args
 * @param {ObjectId} args.organisation
 * @param {string} args.channel      'email' | 'sms' | 'whatsapp' | 'call'
 * @param {string} args.identifier   the email address or phone number
 * @param {ObjectId} [args.taskId]   the lead, when the send is lead-scoped
 * @param {string} [args.messageType] 'marketing' (default) | 'transactional'
 * @param {string} [args.timezone]   recipient timezone for quiet hours
 * @param {Object} [args.quietHours]
 * @returns {Promise<{allowed, reason, expiresAt}>}
 */
const checkSend = async ({
  organisation,
  channel,
  identifier,
  taskId = null,
  messageType = 'marketing',
  timezone = null,
  quietHours,
  now = new Date(),
}) => {
  const suppressed = await isSuppressed(organisation, channel, identifier);

  let consent = null;
  if (taskId) {
    consent = await LeadConsent.findOne({ task: taskId, channel }).lean();
  }

  return canSend({ channel, consent, suppressed, messageType, timezone, quietHours, now });
};

/**
 * Record (or update) a lead's consent for a channel, preserving the evidence.
 * Setting `withdrawn` also stamps `withdrawnAt`.
 */
const recordConsent = async (
  organisation,
  taskId,
  channel,
  { state = STATES.EXPRESS, basis = null, source = '', wording = '', ip = '', userAgent = '', userId = null, expiresAt = null } = {}
) => {
  const update = {
    organisation,
    task: taskId,
    channel,
    state,
    basis: state === STATES.IMPLIED ? basis || 'enquiry' : null,
    source,
    wording,
    ip,
    userAgent,
    recordedBy: userId,
    expiresAt,
  };
  if (state === STATES.WITHDRAWN) update.withdrawnAt = new Date();
  else update.capturedAt = new Date();

  return LeadConsent.findOneAndUpdate({ task: taskId, channel }, { $set: update }, { upsert: true, new: true });
};

module.exports = {
  normalizeKey,
  kindForChannel,
  isSuppressed,
  suppress,
  unsuppress,
  checkSend,
  recordConsent,
};
