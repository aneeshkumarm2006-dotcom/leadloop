/**
 * bookingWorkflowController — org-scoped CRUD for BookingWorkflow (the
 * Calendly-style reminder/alert workflows). Admin-only, mirrors the
 * automation-hub org auth.
 */

const mongoose = require('mongoose');
const Organisation = require('../models/Organisation');
const BookingWorkflow = require('../models/BookingWorkflow');

const ACTION_TYPES = BookingWorkflow.ACTION_TYPES;
const isObjectId = (v) => v != null && mongoose.Types.ObjectId.isValid(String(v));

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const loadOrgAdmin = async (orgId, userId) => {
  if (!isObjectId(orgId)) return { status: 400, error: 'A valid orgId is required' };
  const org = await Organisation.findById(orgId);
  if (!org) return { status: 404, error: 'Organisation not found' };
  if (!org.members.some((m) => m.toString() === userId)) return { status: 403, error: 'Not a member of this organisation' };
  if (!isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { org };
};

const sanitize = (body) => {
  const name = String(body.name || '').trim();
  if (!name) throw { status: 400, error: 'A workflow name is required' };
  const triggerType = body.triggerType === 'on_booking' ? 'on_booking' : 'before_event';
  const beforeMinutes = Math.max(0, Number(body.beforeMinutes) || 0);
  const links = Array.isArray(body.links) ? body.links.filter(isObjectId) : [];
  const actions = (Array.isArray(body.actions) ? body.actions : []).map((a) => ({
    type: ACTION_TYPES.includes(a.type) ? a.type : 'email_invitee',
    recipientEmail: a.recipientEmail ? String(a.recipientEmail).trim() : '',
    subject: a.subject ? String(a.subject) : '',
    body: a.body ? String(a.body) : '',
  }));
  return { name, triggerType, beforeMinutes, links, actions };
};

const serialize = (w) => ({
  _id: w._id,
  name: w.name,
  organisation: w.organisation,
  links: (w.links || []).map((l) => (l && l._id ? { _id: l._id, title: l.title } : l)),
  enabled: w.enabled,
  triggerType: w.triggerType,
  beforeMinutes: w.beforeMinutes,
  actions: w.actions,
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
});

const listWorkflows = async (req, res) => {
  const ctx = await loadOrgAdmin(req.query.org, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  const workflows = await BookingWorkflow.find({ organisation: ctx.org._id })
    .populate('links', 'title')
    .sort({ createdAt: -1 });
  return res.json({ workflows: workflows.map(serialize) });
};

const createWorkflow = async (req, res) => {
  const ctx = await loadOrgAdmin(req.body.org || req.query.org, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  let clean;
  try { clean = sanitize(req.body); } catch (e) { return res.status(e.status || 400).json({ error: e.error || 'Invalid' }); }
  const wf = await BookingWorkflow.create({
    ...clean,
    organisation: ctx.org._id,
    enabled: req.body.enabled !== false,
    createdBy: req.user.userId,
  });
  await wf.populate('links', 'title');
  return res.status(201).json({ workflow: serialize(wf) });
};

const loadWorkflowAdmin = async (id, userId) => {
  if (!isObjectId(id)) return { status: 400, error: 'Invalid workflow id' };
  const wf = await BookingWorkflow.findById(id);
  if (!wf) return { status: 404, error: 'Workflow not found' };
  const ctx = await loadOrgAdmin(wf.organisation, userId);
  if (ctx.error) return ctx;
  return { wf, org: ctx.org };
};

const getWorkflow = async (req, res) => {
  const ctx = await loadWorkflowAdmin(req.params.id, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  await ctx.wf.populate('links', 'title');
  return res.json({ workflow: serialize(ctx.wf) });
};

const updateWorkflow = async (req, res) => {
  const ctx = await loadWorkflowAdmin(req.params.id, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  const { wf } = ctx;
  if (req.body.enabled !== undefined) wf.enabled = req.body.enabled !== false;
  if (req.body.name !== undefined || req.body.actions !== undefined || req.body.triggerType !== undefined || req.body.links !== undefined || req.body.beforeMinutes !== undefined) {
    let clean;
    try { clean = sanitize({ ...serialize(wf), ...req.body, name: req.body.name ?? wf.name }); } catch (e) { return res.status(e.status || 400).json({ error: e.error || 'Invalid' }); }
    wf.name = clean.name;
    wf.triggerType = clean.triggerType;
    wf.beforeMinutes = clean.beforeMinutes;
    wf.links = clean.links;
    wf.actions = clean.actions;
  }
  await wf.save();
  await wf.populate('links', 'title');
  return res.json({ workflow: serialize(wf) });
};

const deleteWorkflow = async (req, res) => {
  const ctx = await loadWorkflowAdmin(req.params.id, req.user.userId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
  await BookingWorkflow.deleteOne({ _id: ctx.wf._id });
  return res.json({ ok: true });
};

module.exports = { listWorkflows, createWorkflow, getWorkflow, updateWorkflow, deleteWorkflow };
