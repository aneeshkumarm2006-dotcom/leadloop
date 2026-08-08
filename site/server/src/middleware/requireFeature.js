/**
 * requireFeature.js — server-side plan enforcement.
 *
 * The Billing page hides premium features, but hiding a button is not access
 * control: without this, any authenticated user could still call the endpoint
 * directly. This middleware is the real gate.
 *
 * ─── Enforcement is OPT-IN ─────────────────────────────────────────────────
 * `BILLING_ENFORCEMENT` must be exactly "on" for any request to be blocked.
 * This is deliberate: every existing workspace predates billing and therefore
 * has no subscription, so switching gating on by default would instantly break
 * paying-in-spirit customers the moment this deploys. With enforcement off the
 * middleware still resolves the entitlement and stamps it on `req.entitlement`
 * (so handlers and logs can see it) but always calls next().
 *
 * Turn it on only once real plans exist in Stripe AND existing workspaces have
 * been migrated onto a plan.
 *
 * ─── Usage ─────────────────────────────────────────────────────────────────
 *   router.post('/x', requireFeature(FEATURES.LEAD_CONNECTORS, fromQueryOrg))
 *   router.post('/boards/:id/y', requireFeature(FEATURES.LEAD_CONNECTORS, fromBoardParam()))
 *
 * A blocked request gets 402 Payment Required (not 403): the caller is
 * authenticated and authorised, the workspace simply isn't on a plan that
 * includes the feature. The body names the feature and the required plan so the
 * client can deep-link to the upgrade page.
 */

const mongoose = require('mongoose');
const Board = require('../models/Board');
// Required as a module (not destructured) so the lookup is resolved at call
// time — late binding keeps this unit-testable without a live database.
const billingService = require('../services/billingService');
const { PLANS } = require('../config/plans');

/** Enforcement is off unless explicitly enabled. */
const enforcementOn = () => String(process.env.BILLING_ENFORCEMENT || '').toLowerCase() === 'on';

/** Resolve the workspace id from common query/body params. */
const fromQueryOrg = (req) =>
  req.query.orgId || req.query.org || req.body?.orgId || req.body?.org || null;

/**
 * Resolve the workspace id from a board route param (default `:id`), so
 * board-scoped premium routes can be gated without the client passing an org.
 */
const fromBoardParam =
  (param = 'id') =>
  async (req) => {
    const boardId = req.params[param];
    if (!mongoose.Types.ObjectId.isValid(boardId)) return null;
    const board = await Board.findById(boardId).select('organisation').lean();
    return board ? board.organisation : null;
  };

/** The cheapest plan that includes `feature` — used for the upgrade hint. */
const cheapestPlanWith = (feature) =>
  Object.values(PLANS)
    .filter((p) => p.features.includes(feature))
    .sort((a, b) => (a.amount || 0) - (b.amount || 0))[0] || null;

/**
 * @param {string} feature   a FEATURES.* key from config/plans.js
 * @param {Function} resolveOrgId  (req) => orgId | Promise<orgId>
 */
const requireFeature =
  (feature, resolveOrgId = fromQueryOrg) =>
  async (req, res, next) => {
    try {
      const orgId = await resolveOrgId(req);
      // No resolvable workspace → let the handler deal with it (it will 400/404
      // with a better message than this middleware could).
      if (!orgId || !mongoose.Types.ObjectId.isValid(orgId)) return next();

      const entitlement = await billingService.getEntitlement(orgId);
      req.entitlement = entitlement;

      if (!enforcementOn()) return next();
      if (billingService.entitlementHasFeature(entitlement, feature)) return next();

      const needed = cheapestPlanWith(feature);
      return res.status(402).json({
        error: 'This feature is not included in your plan',
        code: 'upgrade_required',
        feature,
        currentPlan: entitlement.planId,
        requiredPlan: needed ? needed.id : null,
        requiredPlanName: needed ? needed.name : null,
      });
    } catch (err) {
      // A billing lookup failure must never take down a feature — fail OPEN and
      // log it. Losing revenue on one request beats an outage.
      console.error('requireFeature error (failing open):', err);
      return next();
    }
  };

module.exports = requireFeature;
module.exports.requireFeature = requireFeature;
module.exports.fromQueryOrg = fromQueryOrg;
module.exports.fromBoardParam = fromBoardParam;
module.exports.enforcementOn = enforcementOn;
module.exports.cheapestPlanWith = cheapestPlanWith;
