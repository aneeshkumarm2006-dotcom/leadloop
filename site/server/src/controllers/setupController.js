/**
 * setupController.js — first-run setup wizard + checklist endpoints.
 *
 *   GET   /api/orgs/:id/setup            (member) profile + derived checklist
 *   PATCH /api/orgs/:id/setup/profile    (admin)  save the wizard's answers
 *   POST  /api/orgs/:id/setup/complete   (admin)  mark the wizard finished
 *   POST  /api/orgs/:id/setup/dismiss    (admin)  hide/show the checklist
 *   POST  /api/orgs/:id/setup/step       (member) tick a non-derivable step
 *
 * Membership is checked here rather than trusted from the client — the wizard
 * writes workspace-wide settings, so writes require an admin.
 */

const mongoose = require('mongoose');
const Organisation = require('../models/Organisation');
const {
  getSetupState,
  serializeProfile,
  defaultCurrencyFor,
  STEP_IDS,
} = require('../services/setupService');

const isOrgAdmin = (org, userId) =>
  !!org &&
  ((org.admin && org.admin.toString() === userId) ||
    (Array.isArray(org.admins) && org.admins.some((a) => a.toString() === userId)));

const loadOrg = async (orgId, userId, { admin = false } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(orgId)) return { status: 400, error: 'Invalid workspace id' };
  const org = await Organisation.findById(orgId);
  if (!org) return { status: 404, error: 'Workspace not found' };
  if (!org.members.some((m) => m.toString() === userId)) {
    return { status: 403, error: 'Not a member of this workspace' };
  }
  if (admin && !isOrgAdmin(org, userId)) return { status: 403, error: 'Admin access required' };
  return { org };
};

/** GET /api/orgs/:id/setup */
const getSetup = async (req, res) => {
  try {
    const ctx = await loadOrg(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const checklist = await getSetupState(ctx.org);
    return res.json({
      profile: serializeProfile(ctx.org),
      checklist,
      isAdmin: isOrgAdmin(ctx.org, req.user.userId),
    });
  } catch (err) {
    console.error('getSetup error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** PATCH /api/orgs/:id/setup/profile — country / timezone / currency / type. */
const updateProfile = async (req, res) => {
  try {
    const ctx = await loadOrg(req.params.id, req.user.userId, { admin: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const { org } = ctx;
    const body = req.body || {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return res.status(400).json({ error: 'Workspace name cannot be empty' });
      org.name = name;
    }
    if (body.country !== undefined) {
      if (body.country && !Organisation.COUNTRIES.includes(body.country)) {
        return res.status(400).json({ error: 'Unsupported country' });
      }
      org.country = body.country || null;
      // Pre-fill the currency when the wizard hasn't set one explicitly.
      if (!org.currency && org.country) org.currency = defaultCurrencyFor(org.country);
    }
    if (body.businessType !== undefined) {
      if (body.businessType && !Organisation.BUSINESS_TYPES.includes(body.businessType)) {
        return res.status(400).json({ error: 'Unsupported business type' });
      }
      org.businessType = body.businessType || null;
    }
    if (body.timezone !== undefined) org.timezone = String(body.timezone || '').trim();
    if (body.currency !== undefined) org.currency = String(body.currency || '').trim().toUpperCase();

    await org.save();
    return res.json({ profile: serializeProfile(org) });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/orgs/:id/setup/complete — the wizard finished (or was skipped). */
const completeWizard = async (req, res) => {
  try {
    const ctx = await loadOrg(req.params.id, req.user.userId, { admin: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    ctx.org.setup = ctx.org.setup || {};
    ctx.org.setup.wizardCompletedAt = new Date();
    await ctx.org.save();
    const checklist = await getSetupState(ctx.org);
    return res.json({ profile: serializeProfile(ctx.org), checklist });
  } catch (err) {
    console.error('completeWizard error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/** POST /api/orgs/:id/setup/dismiss — hide (or restore) the checklist. */
const dismissChecklist = async (req, res) => {
  try {
    const ctx = await loadOrg(req.params.id, req.user.userId, { admin: true });
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    ctx.org.setup = ctx.org.setup || {};
    ctx.org.setup.checklistDismissed = req.body?.dismissed === false ? false : true;
    await ctx.org.save();
    return res.json({ dismissed: ctx.org.setup.checklistDismissed });
  } catch (err) {
    console.error('dismissChecklist error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/orgs/:id/setup/step — tick a step that has no server-side signal
 * (currently only "installApp"). Derivable steps reject: their truth comes from
 * the data, and letting a client fake them is exactly the drift we're avoiding.
 */
const markStep = async (req, res) => {
  try {
    const ctx = await loadOrg(req.params.id, req.user.userId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });
    const stepId = String(req.body?.stepId || '');
    if (!STEP_IDS.includes(stepId)) return res.status(400).json({ error: 'Unknown step' });

    const { org } = ctx;
    org.setup = org.setup || {};
    const current = new Set(org.setup.manualDone || []);
    if (req.body?.done === false) current.delete(stepId);
    else current.add(stepId);
    org.setup.manualDone = [...current];
    await org.save();

    const checklist = await getSetupState(org);
    return res.json({ checklist });
  } catch (err) {
    console.error('markStep error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getSetup, updateProfile, completeWizard, dismissChecklist, markStep };
