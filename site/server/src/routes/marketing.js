const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getRoi,
  getProduction,
} = require('../controllers/marketingController');

const router = express.Router();
router.use(authMiddleware);

// Phase 2.3 — Marketing/ROI (admin-only, org-scoped via ?orgId=).
router.get('/marketing/campaigns', listCampaigns);
router.post('/marketing/campaigns', createCampaign);
router.patch('/marketing/campaigns/:id', updateCampaign);
router.delete('/marketing/campaigns/:id', deleteCampaign);
router.get('/marketing/roi', getRoi);

// Production report — GCI/commission, source ROI with revenue, agent
// leaderboard (admin-only, org-scoped via ?orgId=).
router.get('/reports/production', getProduction);

module.exports = router;
