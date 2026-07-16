const mongoose = require('mongoose');
const Board = require('../models/Board');
const Organisation = require('../models/Organisation');
const TaskGroup = require('../models/TaskGroup');
const BookingLink = require('../models/BookingLink');
const Booking = require('../models/Booking');
const { createTaskWithColumnValues } = require('../services/taskCreation');
const { sendEmailForTask, resolveSenderAccount } = require('../services/taskEmail');
const { computeOpenSlots, isSlotOpen } = require('../services/slotEngine');
const { buildIcs } = require('../utils/ics');
const { isValidTimezone } = require('../services/automationSchedule');
const eventBus = require('../services/eventBus');

/**
 * bookingController — Phase 4b Visit Booking. Admin CRUD for BookingLinks plus
 * the public booking flow (slots → submit → lead + agent + confirmation email).
 * Mirrors the Forms controller's split: board-scoped admin routes + public
 * unauthenticated routes.
 */

const PUBLIC_BASE_URL = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
// The API's own absolute base (for server-served links like the .ics download),
// which lives on a different host than the frontend in production.
const API_BASE_URL = () =>
  (process.env.WEBHOOK_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');
const asId = (v) => (v == null ? '' : v.toString());

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

/** Load board + org and assert the caller is an admin of the board's org. */
const loadBoardAdmin = async (boardId, userId) => {
  if (!boardId || !mongoose.Types.ObjectId.isValid(boardId)) return { status: 400, error: 'Invalid board id' };
  const board = await Board.findById(boardId);
  if (!board) return { status: 404, error: 'Board not found' };
  const org = await Organisation.findById(board.organisation);
  if (!org) return { status: 404, error: 'Organisation not found' };
  if (!isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { board, org };
};

// Human-readable "where" for a booking — depends on the meeting type the
// visitor chose: a WhatsApp-video note for virtual, else the link's address.
const locationLabel = (link, meetingType) =>
  meetingType === 'virtual' ? 'WhatsApp video call' : (link.location || '');

const boardColumns = (board) => (Array.isArray(board.columns) ? board.columns : []);
const colById = (board, id) => (id ? boardColumns(board).find((c) => asId(c._id) === asId(id)) : null);
const firstColOfType = (board, types) => boardColumns(board).find((c) => types.includes(c.type)) || null;

const serializeLink = (l) => ({
  _id: l._id,
  board: l.board,
  group: l.group,
  title: l.title,
  slug: l.slug,
  durationMinutes: l.durationMinutes,
  location: l.location,
  timezone: l.timezone,
  weeklyHours: l.weeklyHours || [],
  dateOverrides: l.dateOverrides || [],
  bufferBefore: l.bufferBefore,
  bufferAfter: l.bufferAfter,
  dailyCap: l.dailyCap,
  minNoticeHours: l.minNoticeHours,
  dateRangeDays: l.dateRangeDays,
  slotInterval: l.slotInterval,
  questions: l.questions || [],
  assignMode: l.assignMode,
  agents: l.agents || [],
  dateColumnId: l.dateColumnId,
  nameColumnId: l.nameColumnId,
  emailColumnId: l.emailColumnId,
  phoneColumnId: l.phoneColumnId,
  branding: l.branding || {},
  active: l.active,
  publicUrl: `${PUBLIC_BASE_URL()}/book/${l.slug}`,
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
});

// ---- payload validation ---------------------------------------------------
const HHMM = /^\d{1,2}:\d{2}$/;
const validateLinkBody = async (body, board, org) => {
  const out = {};
  if (typeof body.title === 'string') {
    if (!body.title.trim()) return { error: 'A title is required' };
    out.title = body.title.trim();
  }
  if (body.group !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(body.group)) return { error: 'Invalid group' };
    const g = await TaskGroup.findOne({ _id: body.group, board: board._id }).select('_id');
    if (!g) return { error: 'Group does not belong to this board' };
    out.group = g._id;
  }
  if (body.timezone !== undefined) {
    if (!isValidTimezone(body.timezone)) return { error: 'Invalid timezone' };
    out.timezone = body.timezone;
  }
  for (const k of ['durationMinutes', 'bufferBefore', 'bufferAfter', 'dailyCap', 'minNoticeHours', 'dateRangeDays', 'slotInterval']) {
    if (body[k] !== undefined) {
      const n = Number(body[k]);
      if (!Number.isFinite(n) || n < 0) return { error: `${k} must be a non-negative number` };
      out[k] = n;
    }
  }
  if (body.location !== undefined) out.location = String(body.location || '');
  if (body.assignMode !== undefined) out.assignMode = body.assignMode === 'fixed' ? 'fixed' : 'round_robin';
  if (Array.isArray(body.weeklyHours)) {
    out.weeklyHours = body.weeklyHours
      .filter((w) => w && Number.isInteger(Number(w.dayOfWeek)) && HHMM.test(w.start || '') && HHMM.test(w.end || ''))
      .map((w) => ({ dayOfWeek: Number(w.dayOfWeek), start: w.start, end: w.end }));
  }
  if (Array.isArray(body.dateOverrides)) {
    out.dateOverrides = body.dateOverrides
      .filter((o) => o && typeof o.date === 'string')
      .map((o) => ({
        date: o.date,
        unavailable: !!o.unavailable,
        windows: Array.isArray(o.windows) ? o.windows.filter((w) => HHMM.test(w.start || '') && HHMM.test(w.end || '')).map((w) => ({ start: w.start, end: w.end })) : [],
      }));
  }
  if (Array.isArray(body.questions)) {
    out.questions = body.questions
      .filter((q) => q && q.id)
      .map((q) => ({ id: String(q.id), label: String(q.label || ''), type: ['text', 'textarea', 'phone', 'email'].includes(q.type) ? q.type : 'text', required: !!q.required }));
  }
  if (Array.isArray(body.agents)) {
    const memberIds = new Set((org.members || []).map(asId));
    out.agents = body.agents.map(asId).filter((id) => mongoose.Types.ObjectId.isValid(id) && memberIds.has(id));
  }
  for (const [k, types] of [['dateColumnId', ['date', 'timeline']], ['emailColumnId', ['email']], ['phoneColumnId', ['phone']], ['nameColumnId', ['text', 'long_text']]]) {
    if (body[k] !== undefined) {
      if (!body[k]) { out[k] = null; continue; }
      const col = colById(board, body[k]);
      if (!col || !types.includes(col.type)) return { error: `${k} is not a valid ${types.join('/')} column on this board` };
      out[k] = asId(col._id);
    }
  }
  if (body.branding !== undefined && body.branding && typeof body.branding === 'object') {
    out.branding = {
      logoUrl: String(body.branding.logoUrl || ''),
      coverUrl: String(body.branding.coverUrl || ''),
      accentColor: /^#[0-9a-fA-F]{6}$/.test(body.branding.accentColor || '') ? body.branding.accentColor : '',
      headline: String(body.branding.headline || ''),
    };
  }
  if (body.active !== undefined) out.active = !!body.active;
  return { doc: out };
};

// ===========================================================================
// Admin CRUD
// ===========================================================================
const listBookingLinks = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const links = await BookingLink.find({ board: ctx.board._id }).sort({ createdAt: -1 });
    const counts = await Booking.aggregate([
      { $match: { link: { $in: links.map((l) => l._id) }, status: 'confirmed' } },
      { $group: { _id: '$link', n: { $sum: 1 } } },
    ]);
    const byLink = new Map(counts.map((c) => [c._id.toString(), c.n]));
    return res.json({ links: links.map((l) => ({ ...serializeLink(l), bookingCount: byLink.get(l._id.toString()) || 0 })) });
  } catch (err) {
    console.error('listBookingLinks error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const createBookingLink = async (req, res) => {
  try {
    const ctx = await loadBoardAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const body = req.body || {};
    if (!body.title || !String(body.title).trim()) return res.status(400).json({ error: 'A title is required' });
    if (!body.group) return res.status(400).json({ error: 'A target group is required' });
    const v = await validateLinkBody(body, ctx.board, ctx.org);
    if (v.error) return res.status(400).json({ error: v.error });
    // Auto-detect a date column to stamp if none chosen (so the visit shows on the calendar).
    if (v.doc.dateColumnId === undefined) {
      const d = firstColOfType(ctx.board, ['date', 'timeline']);
      if (d) v.doc.dateColumnId = asId(d._id);
    }
    const link = await BookingLink.create({
      ...v.doc,
      board: ctx.board._id,
      organisation: ctx.board.organisation,
      createdBy: req.user.userId,
    });
    return res.status(201).json({ link: serializeLink(link) });
  } catch (err) {
    console.error('createBookingLink error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const loadLinkAdmin = async (linkId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(linkId)) return { status: 404, error: 'Booking link not found' };
  const link = await BookingLink.findById(linkId);
  if (!link) return { status: 404, error: 'Booking link not found' };
  const ctx = await loadBoardAdmin(link.board, userId);
  if (ctx.error) return ctx;
  return { link, board: ctx.board, org: ctx.org };
};

const getBookingLink = async (req, res) => {
  try {
    const ctx = await loadLinkAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    return res.json({ link: serializeLink(ctx.link) });
  } catch (err) {
    console.error('getBookingLink error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const updateBookingLink = async (req, res) => {
  try {
    const ctx = await loadLinkAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const v = await validateLinkBody(req.body || {}, ctx.board, ctx.org);
    if (v.error) return res.status(400).json({ error: v.error });
    Object.assign(ctx.link, v.doc);
    await ctx.link.save();
    return res.json({ link: serializeLink(ctx.link) });
  } catch (err) {
    console.error('updateBookingLink error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const deleteBookingLink = async (req, res) => {
  try {
    const ctx = await loadLinkAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    await ctx.link.deleteOne();
    return res.status(204).end();
  } catch (err) {
    console.error('deleteBookingLink error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const listBookingsForLink = async (req, res) => {
  try {
    const ctx = await loadLinkAdmin(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const bookings = await Booking.find({ link: ctx.link._id })
      .populate('agentId', 'name email profilePic')
      .sort({ slotStart: -1 })
      .lean();
    return res.json({ bookings });
  } catch (err) {
    console.error('listBookingsForLink error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// ===========================================================================
// Public booking flow
// ===========================================================================
const loadActiveLink = async (slug) => BookingLink.findOne({ slug, active: true });

const slotCtx = async (link) => {
  const now = new Date();
  const existing = await Booking.find({ link: link._id, status: 'confirmed', slotEnd: { $gte: now } })
    .select('slotStart slotEnd')
    .lean();
  return { now, existingBookings: existing.map((b) => ({ start: b.slotStart, end: b.slotEnd })) };
};

/** GET /book/:slug — public link config (no slots). */
const renderBookingPublic = async (req, res) => {
  try {
    const link = await loadActiveLink(req.params.slug);
    if (!link) return res.status(404).json({ error: 'This booking link is not available' });
    return res.json({
      slug: link.slug,
      title: link.title,
      location: link.location || '', // property address (shown when visitor picks in-person)
      durationMinutes: link.durationMinutes,
      timezone: link.timezone,
      questions: link.questions || [],
      branding: link.branding || {},
    });
  } catch (err) {
    console.error('renderBookingPublic error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** GET /book/:slug/slots — open slots grouped by day. */
const getPublicSlots = async (req, res) => {
  try {
    const link = await loadActiveLink(req.params.slug);
    if (!link) return res.status(404).json({ error: 'This booking link is not available' });
    const ctx = await slotCtx(link);
    const days = computeOpenSlots(link.toObject(), ctx);
    return res.json({ timezone: link.timezone, durationMinutes: link.durationMinutes, days });
  } catch (err) {
    console.error('getPublicSlots error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** POST /book/:slug/submit — book a slot → create the lead + assign + email. */
const submitBooking = async (req, res) => {
  try {
    const link = await loadActiveLink(req.params.slug);
    if (!link) return res.status(404).json({ error: 'This booking link is not available' });

    const body = req.body || {};
    const visitor = body.visitor || {};
    const name = String(visitor.name || '').trim();
    const email = String(visitor.email || '').trim();
    const phone = String(visitor.phone || '').trim();
    const meetingType = body.meetingType === 'virtual' ? 'virtual' : 'in_person';
    if (!name) return res.status(400).json({ error: 'Your name is required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (meetingType === 'virtual' && !phone) return res.status(400).json({ error: 'A phone number is required for a WhatsApp video visit' });
    if (!body.slotStart) return res.status(400).json({ error: 'Please choose a time slot' });

    // Re-validate the chosen slot against fresh availability + bookings.
    const ctx = await slotCtx(link);
    if (!isSlotOpen(link.toObject(), ctx, body.slotStart)) {
      return res.status(409).json({ error: 'That time was just taken — please pick another slot' });
    }
    const slotStart = new Date(body.slotStart);
    const slotEnd = new Date(slotStart.getTime() + (link.durationMinutes || 30) * 60000);

    const board = await Board.findById(link.board);
    if (!board) return res.status(404).json({ error: 'Board not found' });

    // Resolve target columns (configured, else auto-detect by type).
    const dateCol = colById(board, link.dateColumnId) || firstColOfType(board, ['date', 'timeline']);
    const emailCol = colById(board, link.emailColumnId) || firstColOfType(board, ['email']);
    const phoneCol = colById(board, link.phoneColumnId) || firstColOfType(board, ['phone']);
    const personCol = boardColumns(board).find((c) => c.key === 'assignees' && c.type === 'person') || firstColOfType(board, ['person']);

    // Round-robin / fixed agent assignment.
    let agentId = null;
    if (Array.isArray(link.agents) && link.agents.length > 0) {
      if (link.assignMode === 'fixed') {
        agentId = link.agents[0];
      } else {
        const bumped = await BookingLink.findByIdAndUpdate(link._id, { $inc: { lastAssignedIndex: 1 } }, { new: true });
        const idx = (((bumped.lastAssignedIndex - 1) % link.agents.length) + link.agents.length) % link.agents.length;
        agentId = link.agents[idx];
      }
    }

    const columnValues = {};
    if (emailCol) columnValues[asId(emailCol._id)] = email;
    if (phoneCol && phone) columnValues[asId(phoneCol._id)] = phone;
    if (dateCol) {
      columnValues[asId(dateCol._id)] =
        dateCol.type === 'timeline' ? { start: slotStart.toISOString(), end: slotEnd.toISOString() } : slotStart.toISOString();
    }
    if (personCol && agentId) columnValues[asId(personCol._id)] = [asId(agentId)];

    const whereText = locationLabel(link, meetingType);
    const note = [`Visit booked for ${slotStart.toISOString()}`, `Type: ${meetingType === 'virtual' ? 'WhatsApp video' : 'In person'}`, whereText ? `Location: ${whereText}` : '', ...(Array.isArray(body.answers) ? body.answers.map((a) => `${a.label}: ${a.value}`) : [])]
      .filter(Boolean)
      .join('\n');

    const { task } = await createTaskWithColumnValues({
      board,
      groupId: link.group,
      columnValues,
      name,
      createdBy: link.createdBy || board.createdBy,
    });
    if (note) { task.note = note; await task.save(); }

    const booking = await Booking.create({
      link: link._id,
      board: board._id,
      organisation: board.organisation,
      slotStart,
      slotEnd,
      timezone: link.timezone,
      visitor: { name, email, phone },
      meetingType,
      answers: Array.isArray(body.answers) ? body.answers.map((a) => ({ label: String(a.label || ''), value: String(a.value || '') })) : [],
      leadId: task._id,
      agentId,
    });

    // Let ITEM_CREATED automations treat the new lead like any other.
    eventBus.emit('item.created', { taskId: task._id, boardId: board._id, groupId: task.group, statusId: task.status, createdByUserId: asId(board.createdBy) });
    // Fire on_booking reminder/alert workflows for this event type.
    eventBus.emit('booking.created', { bookingId: booking._id, linkId: link._id, organisationId: board.organisation });

    // Best-effort confirmation emails (never fail the booking on email errors).
    sendBookingEmails({ link, board, booking, task, agentId }).catch((e) => console.error('[booking] email failed:', e?.message || e));

    return res.status(201).json({
      ok: true,
      booking: { slotStart: booking.slotStart, slotEnd: booking.slotEnd, timezone: booking.timezone },
      title: link.title,
      meetingType,
      location: whereText,
      cancelUrl: `${PUBLIC_BASE_URL()}/book/${link.slug}?cancel=${booking.cancelToken}`,
      icsUrl: `${API_BASE_URL()}/book/ics/${booking.cancelToken}`,
    });
  } catch (err) {
    console.error('submitBooking error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

const sendBookingEmails = async ({ link, board, booking, task, agentId }) => {
  const User = require('../models/User');
  const when = booking.slotStart.toLocaleString('en-US', { timeZone: link.timezone, dateStyle: 'full', timeStyle: 'short' });
  const isVirtual = booking.meetingType === 'virtual';
  const where = locationLabel(link, booking.meetingType);
  const whereLine = where
    ? `<strong>Where:</strong> ${where}${isVirtual && booking.visitor.phone ? ` — we'll call you on WhatsApp at ${booking.visitor.phone}` : ''}<br/>`
    : '';
  const account = await resolveSenderAccount({ workspaceId: board.organisation, candidateUserIds: [agentId, link.createdBy].filter(Boolean).map(asId) });
  const calUrl = `${API_BASE_URL()}/book/ics/${booking.cancelToken}`;
  const cancelUrl = `${PUBLIC_BASE_URL()}/book/${link.slug}?cancel=${booking.cancelToken}`;

  // Visitor confirmation.
  const visitorHtml = `
    <p>Hi ${booking.visitor.name || 'there'},</p>
    <p>Your visit to <strong>${link.title}</strong> is confirmed.</p>
    <p><strong>When:</strong> ${when}<br/>${whereLine}</p>
    <p><a href="${calUrl}">Add to calendar</a> · <a href="${cancelUrl}">Cancel or reschedule</a></p>`;
  await sendEmailForTask({
    taskId: task._id,
    to: booking.visitor.email,
    subject: `Visit confirmed — ${link.title}`,
    bodyHtml: visitorHtml,
    body: `Your visit to ${link.title} is confirmed for ${when}. ${where}${isVirtual && booking.visitor.phone ? ` (WhatsApp video — ${booking.visitor.phone})` : ''}\nCancel/reschedule: ${cancelUrl}`,
    account,
    sentBy: asId(link.createdBy),
  });

  // Agent notification (best-effort).
  if (agentId) {
    const agent = await User.findById(agentId).select('email name').lean();
    if (agent?.email) {
      await sendEmailForTask({
        taskId: task._id,
        to: agent.email,
        subject: `New visit booked — ${link.title}`,
        bodyHtml: `<p>A visit was booked for <strong>${link.title}</strong>.</p><p><strong>When:</strong> ${when}<br/><strong>Visitor:</strong> ${booking.visitor.name} · ${booking.visitor.email}${booking.visitor.phone ? ' · ' + booking.visitor.phone : ''}</p>`,
        body: `New visit for ${link.title} on ${when}. Visitor: ${booking.visitor.name} (${booking.visitor.email}).`,
        account,
        sentBy: asId(link.createdBy),
      }).catch((e) => console.error('[booking] agent email failed:', e?.message || e));
    }
  }
};

/** GET /book/ics/:token — download the .ics for a booking. */
const getBookingIcs = async (req, res) => {
  try {
    const booking = await Booking.findOne({ cancelToken: req.params.token }).populate('link', 'title location timezone').lean();
    if (!booking) return res.status(404).send('Not found');
    const link = booking.link || {};
    const where = locationLabel(link, booking.meetingType);
    const ics = buildIcs({
      uid: `${booking._id}@macan-crm`,
      start: booking.slotStart,
      end: booking.slotEnd,
      title: `Visit — ${link.title || 'Property'}`,
      description: where ? `Location: ${where}` : '',
      location: where,
      attendeeEmail: booking.visitor?.email || '',
      status: booking.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="visit.ics"');
    return res.send(ics);
  } catch (err) {
    console.error('getBookingIcs error:', err);
    return res.status(500).send('Server error');
  }
};

/** POST /book/:slug/cancel/:token — cancel a booking (frees the slot). */
const cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({ cancelToken: req.params.token }).populate('link', 'slug');
    if (!booking || booking.link?.slug !== req.params.slug) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status === 'cancelled') return res.json({ ok: true, alreadyCancelled: true });
    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    await booking.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error('cancelBooking error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  // admin
  listBookingLinks,
  createBookingLink,
  getBookingLink,
  updateBookingLink,
  deleteBookingLink,
  listBookingsForLink,
  // public
  renderBookingPublic,
  getPublicSlots,
  submitBooking,
  getBookingIcs,
  cancelBooking,
};
