/**
 * requireFeature.test.js — plan-enforcement middleware. No DB: the billing
 * lookup is stubbed via the service module. Run from the server directory:
 *     node --test src/middleware/requireFeature.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const billingService = require('../services/billingService');
const requireFeature = require('./requireFeature');
const { enforcementOn, cheapestPlanWith } = require('./requireFeature');
const { FEATURES } = require('../config/plans');

const ORG_ID = new mongoose.Types.ObjectId().toString();

/** Minimal express double. */
const mkRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};

const run = async (mw, req) => {
  const res = mkRes();
  let nexted = false;
  await mw(req, res, () => {
    nexted = true;
  });
  return { res, nexted };
};

/** Swap the entitlement lookup for a fixed value, restoring afterwards. */
const withEntitlement = async (entitlement, fn) => {
  const original = billingService.getEntitlement;
  billingService.getEntitlement = async () => entitlement;
  try {
    await fn();
  } finally {
    billingService.getEntitlement = original;
  }
};

const withEnforcement = async (value, fn) => {
  const prev = process.env.BILLING_ENFORCEMENT;
  process.env.BILLING_ENFORCEMENT = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.BILLING_ENFORCEMENT;
    else process.env.BILLING_ENFORCEMENT = prev;
  }
};

// --- tests -----------------------------------------------------------------

test('enforcement is OFF unless BILLING_ENFORCEMENT=on', async () => {
  await withEnforcement('', async () => assert.equal(enforcementOn(), false));
  await withEnforcement('off', async () => assert.equal(enforcementOn(), false));
  await withEnforcement('true', async () => assert.equal(enforcementOn(), false));
  await withEnforcement('on', async () => assert.equal(enforcementOn(), true));
  await withEnforcement('ON', async () => assert.equal(enforcementOn(), true));
});

test('with enforcement OFF a free workspace still passes through', async () => {
  await withEnforcement('off', async () => {
    await withEntitlement({ planId: 'free', features: [FEATURES.CORE] }, async () => {
      const mw = requireFeature(FEATURES.LEAD_CONNECTORS);
      const { nexted, res } = await run(mw, { query: { orgId: ORG_ID }, body: {}, params: {} });
      assert.equal(nexted, true, 'must not block while enforcement is off');
      assert.equal(res.statusCode, null);
    });
  });
});

test('with enforcement ON a free workspace is blocked with 402 + upgrade hint', async () => {
  await withEnforcement('on', async () => {
    await withEntitlement({ planId: 'free', features: [FEATURES.CORE] }, async () => {
      const mw = requireFeature(FEATURES.LEAD_CONNECTORS);
      const { nexted, res } = await run(mw, { query: { orgId: ORG_ID }, body: {}, params: {} });
      assert.equal(nexted, false);
      assert.equal(res.statusCode, 402, 'payment required, not forbidden');
      assert.equal(res.body.code, 'upgrade_required');
      assert.equal(res.body.feature, FEATURES.LEAD_CONNECTORS);
      assert.equal(res.body.currentPlan, 'free');
      assert.equal(res.body.requiredPlan, 'team');
    });
  });
});

test('with enforcement ON an entitled workspace passes', async () => {
  await withEnforcement('on', async () => {
    await withEntitlement(
      { planId: 'team', features: [FEATURES.CORE, FEATURES.LEAD_CONNECTORS] },
      async () => {
        const mw = requireFeature(FEATURES.LEAD_CONNECTORS);
        const { nexted, res } = await run(mw, { query: { orgId: ORG_ID }, body: {}, params: {} });
        assert.equal(nexted, true);
        assert.equal(res.statusCode, null);
      }
    );
  });
});

test('the entitlement is stamped on the request even when not enforcing', async () => {
  await withEnforcement('off', async () => {
    await withEntitlement({ planId: 'solo', features: [FEATURES.CORE] }, async () => {
      const req = { query: { orgId: ORG_ID }, body: {}, params: {} };
      await run(requireFeature(FEATURES.LEAD_CONNECTORS), req);
      assert.equal(req.entitlement.planId, 'solo');
    });
  });
});

test('an unresolvable workspace falls through to the handler', async () => {
  await withEnforcement('on', async () => {
    const mw = requireFeature(FEATURES.LEAD_CONNECTORS);
    const { nexted } = await run(mw, { query: {}, body: {}, params: {} });
    assert.equal(nexted, true, 'handler gives a better 400/404 than we could');
  });
});

test('a billing lookup failure FAILS OPEN (revenue loss beats an outage)', async () => {
  await withEnforcement('on', async () => {
    const original = billingService.getEntitlement;
    billingService.getEntitlement = async () => {
      throw new Error('mongo down');
    };
    try {
      const mw = requireFeature(FEATURES.LEAD_CONNECTORS);
      const { nexted, res } = await run(mw, { query: { orgId: ORG_ID }, body: {}, params: {} });
      assert.equal(nexted, true);
      assert.equal(res.statusCode, null);
    } finally {
      billingService.getEntitlement = original;
    }
  });
});

test('orgId is also read from the body (POST routes)', async () => {
  await withEnforcement('on', async () => {
    await withEntitlement({ planId: 'free', features: [FEATURES.CORE] }, async () => {
      const mw = requireFeature(FEATURES.PRODUCTION_REPORTS);
      const { res } = await run(mw, { query: {}, body: { orgId: ORG_ID }, params: {} });
      assert.equal(res.statusCode, 402);
    });
  });
});

test('cheapestPlanWith picks the lowest-priced qualifying tier', () => {
  assert.equal(cheapestPlanWith(FEATURES.LEAD_CONNECTORS).id, 'team');
  assert.equal(cheapestPlanWith(FEATURES.API_ACCESS).id, 'brokerage');
  assert.equal(cheapestPlanWith(FEATURES.CORE).id, 'free');
});
