/**
 * smsInboundResolver.js — route an inbound SMS to a task (Phase 3, F10.4).
 *
 * Mirrors `emailInboundResolver` but matches on phone instead of email. An
 * inbound reply (after the STOP/START opt-out keywords are handled upstream) is
 * matched to the most-recently-active task in the SAME workspace whose `phone`
 * column holds the sender's number. The inbound `SmsMessage` (`direction: 'in'`,
 * `status: 'received'`) is deduped on the Twilio SID and `sms.received` is
 * emitted for downstream listeners.
 *
 * Edge case (AC5): when the number lives on MORE than one task, the reply lands
 * on the most-recently-active one and a system comment is mirrored onto the
 * others ("SMS reply received on related task …") so nothing is silently lost.
 */

const Board = require('../models/Board');
const Task = require('../models/Task');
const SmsMessage = require('../models/SmsMessage');
const Comment = require('../models/Comment');
const eventBus = require('./eventBus');
const { phonesMatch } = require('./smsService');

/** Read a (lean or hydrated) task's column value, tolerating Map vs object. */
const readColumnValue = (columnValues, colId) => {
  if (!columnValues) return undefined;
  if (typeof columnValues.get === 'function') return columnValues.get(colId);
  return columnValues[colId];
};

/**
 * Every task in `workspaceId` whose phone column matches `fromPhone`, ordered
 * most-recently-active first. Scoped to the owning workspace's boards (we know
 * it from the SmsConfig the inbound webhook resolved), so the scan stays tight.
 */
const findTasksByPhone = async (workspaceId, fromPhone) => {
  if (!workspaceId || !fromPhone) return [];
  const boards = await Board.find({ organisation: workspaceId, 'columns.type': 'phone' })
    .select('_id columns')
    .lean();

  const matches = [];
  for (const board of boards) {
    const phoneColIds = (board.columns || [])
      .filter((c) => c.type === 'phone')
      .map((c) => c._id.toString());
    if (!phoneColIds.length) continue;

    const or = phoneColIds.map((id) => ({ [`columnValues.${id}`]: { $exists: true, $nin: [null, ''] } }));
    const tasks = await Task.find({ board: board._id, $or: or })
      .select('_id name columnValues updatedAt')
      .lean();

    for (const t of tasks) {
      for (const colId of phoneColIds) {
        const v = readColumnValue(t.columnValues, colId);
        if (v && phonesMatch(v, fromPhone)) {
          matches.push(t);
          break;
        }
      }
    }
  }

  matches.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  return matches;
};

/**
 * Resolve + persist one inbound SMS. Returns the created SmsMessage, or null
 * when no task matches (or it's a duplicate).
 *
 * @param {object} msg { workspaceId, from, to, body, twilioSid, sentAt }
 */
const resolveInboundSms = async (msg) => {
  if (!msg || !msg.workspaceId) return null;

  // Dedup early on the Twilio SID.
  if (msg.twilioSid) {
    const dup = await SmsMessage.findOne({ twilioSid: msg.twilioSid }).select('_id');
    if (dup) return null;
  }

  const matches = await findTasksByPhone(msg.workspaceId, msg.from);
  if (!matches.length) {
    console.warn('[smsInbound] no task matched for sender', msg.from);
    return null;
  }

  const primary = matches[0];
  let created;
  try {
    created = await SmsMessage.create({
      taskId: primary._id,
      direction: 'in',
      from: msg.from || '',
      to: msg.to || '',
      body: msg.body || '',
      twilioSid: msg.twilioSid || null,
      status: 'received',
      sentAt: msg.sentAt ? new Date(msg.sentAt) : new Date(),
    });
  } catch (err) {
    // Duplicate-key race on the unique twilioSid index → already captured.
    if (err && err.code === 11000) return null;
    throw err;
  }

  // AC5 — mirror a system comment onto the other tasks holding this number.
  if (matches.length > 1) {
    const note = `📩 SMS reply from ${msg.from || 'a lead'} received on related task "${primary.name || 'a task'}".`;
    await Promise.allSettled(
      matches.slice(1).map((t) =>
        Comment.create({ task: t._id, author: null, text: note })
      )
    );
  }

  eventBus.emit('sms.received', {
    taskId: primary._id,
    messageId: created._id,
    from: created.from,
    mirroredTaskCount: Math.max(0, matches.length - 1),
  });
  return created;
};

module.exports = { resolveInboundSms, findTasksByPhone };
