/**
 * bookingWorkflowService.js — execute a BookingWorkflow's email actions for one
 * booking. Builds the booking variable context, interpolates {{Variable}} tokens
 * in each action's subject/body, resolves the recipient (invitee / host agent /
 * fixed address) and sends through the same tracked `sendEmailForTask` path the
 * booking confirmation uses (falling back to Resend when no mailbox is connected).
 */

const fmtEventTime = (booking) => {
  try {
    return new Date(booking.slotStart).toLocaleString('en-US', {
      timeZone: booking.timezone || 'America/Toronto',
      dateStyle: 'full',
      timeStyle: 'short',
    });
  } catch {
    return new Date(booking.slotStart).toUTCString();
  }
};

/** Replace {{Variable Name}} tokens (keys may contain spaces). Unknown → ''. */
const interpolateVars = (tpl, vars) => {
  if (!tpl) return '';
  return String(tpl).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, key) => {
    const v = vars[key.trim()];
    return v != null ? String(v) : '';
  });
};

/** A workflow with no `links` applies to every event type; otherwise must match. */
const workflowAppliesTo = (workflow, linkId) =>
  !workflow.links || workflow.links.length === 0 ||
  workflow.links.some((l) => String(l) === String(linkId));

/** Run every email action of `workflow` against `booking`. Never throws. */
const executeWorkflow = async (workflow, booking) => {
  const BookingLink = require('../models/BookingLink');
  const User = require('../models/User');
  const { sendEmailForTask, resolveSenderAccount } = require('./taskEmail');

  if (!booking || !booking.leadId) return; // need a task to attach the email to
  const link = await BookingLink.findById(booking.link).lean();
  if (!link) return;

  const agent = booking.agentId
    ? await User.findById(booking.agentId).select('name email').lean()
    : null;

  const vars = {
    'Invitee Full Name': booking.visitor?.name || '',
    'Event Name': link.title || '',
    'Event Time': fmtEventTime(booking),
    Location: (booking.meetingType === 'virtual' ? 'WhatsApp video call' : link.location) || '',
    'Invitee Email': booking.visitor?.email || '',
    'Invitee Phone Number': booking.visitor?.phone || '',
    'Agent First Name': agent ? (agent.name || '').split(/\s+/)[0] : '',
    'Questions And Answers': (booking.answers || []).map((a) => `${a.label}: ${a.value}`).join('; '),
  };

  const account = await resolveSenderAccount({
    workspaceId: booking.organisation || link.organisation,
    candidateUserIds: [booking.agentId, link.createdBy, workflow.createdBy].filter(Boolean).map(String),
  });

  for (const action of workflow.actions || []) {
    let to = '';
    if (action.type === 'email_invitee') to = booking.visitor?.email || '';
    else if (action.type === 'email_host') to = agent?.email || '';
    else if (action.type === 'email_other') to = action.recipientEmail || '';
    if (!to) continue;

    const subject = interpolateVars(action.subject, vars).trim() || `Reminder — ${link.title}`;
    const bodyHtml = interpolateVars(action.body, vars);
    if (!bodyHtml.trim()) continue;

    try {
      await sendEmailForTask({
        taskId: booking.leadId,
        to,
        subject,
        bodyHtml,
        account,
        sentBy: workflow.createdBy || link.createdBy || null,
      });
    } catch (e) {
      console.error('[booking-workflow] send failed:', e.message);
    }
  }
};

module.exports = { executeWorkflow, workflowAppliesTo, interpolateVars };
