/**
 * whatsappInboundResolver.js — route an inbound WhatsApp message to a task
 * (Phase 3, F11.4).
 *
 * The WhatsApp twin of `smsInboundResolver` (F10.4): after the STOP/START
 * opt-out keywords are handled upstream, an inbound message is matched to the
 * most-recently-active task in the SAME workspace whose `phone` column holds the
 * sender's number (reusing the F10 `findTasksByPhone` phone scan), the inbound
 * `WhatsAppMessage` (`direction: 'in'`, `status: 'received'`) is deduped on the
 * Twilio SID, and `whatsapp.received` is emitted.
 *
 * Persisting the inbound row with the current timestamp is what RE-OPENS the
 * 24-hour customer-service window (AC3) — `whatsappService.lastInboundAt` reads
 * exactly these rows.
 *
 * Edge case: a number on MORE than one task lands the reply on the
 * most-recently-active one and mirrors a system comment onto the others (parity
 * with SMS AC5), so nothing is silently lost.
 */

const WhatsAppMessage = require('../models/WhatsAppMessage');
const Comment = require('../models/Comment');
const eventBus = require('./eventBus');
const { findTasksByPhone } = require('./smsInboundResolver');

/**
 * Resolve + persist one inbound WhatsApp message. Returns the created
 * WhatsAppMessage, or null when no task matches (or it's a duplicate).
 *
 * @param {object} msg { workspaceId, from, to, body, mediaUrl, twilioSid, sentAt }
 */
const resolveInboundWhatsApp = async (msg) => {
  if (!msg || !msg.workspaceId) return null;

  // Dedup early on the Twilio SID.
  if (msg.twilioSid) {
    const dup = await WhatsAppMessage.findOne({ twilioSid: msg.twilioSid }).select('_id');
    if (dup) return null;
  }

  const matches = await findTasksByPhone(msg.workspaceId, msg.from);
  if (!matches.length) {
    console.warn('[whatsappInbound] no task matched for sender', msg.from);
    return null;
  }

  const primary = matches[0];
  let created;
  try {
    created = await WhatsAppMessage.create({
      taskId: primary._id,
      direction: 'in',
      from: msg.from || '',
      to: msg.to || '',
      body: msg.body || '',
      mediaUrl: msg.mediaUrl || null,
      twilioSid: msg.twilioSid || null,
      status: 'received',
      sentAt: msg.sentAt ? new Date(msg.sentAt) : new Date(),
    });
  } catch (err) {
    // Duplicate-key race on the unique twilioSid index → already captured.
    if (err && err.code === 11000) return null;
    throw err;
  }

  // Mirror a system comment onto the other tasks holding this number.
  if (matches.length > 1) {
    const note = `💬 WhatsApp reply from ${msg.from || 'a lead'} received on related task "${primary.name || 'a task'}".`;
    await Promise.allSettled(
      matches.slice(1).map((t) => Comment.create({ task: t._id, author: null, text: note }))
    );
  }

  eventBus.emit('whatsapp.received', {
    taskId: primary._id,
    messageId: created._id,
    from: created.from,
    mirroredTaskCount: Math.max(0, matches.length - 1),
  });
  return created;
};

module.exports = { resolveInboundWhatsApp };
