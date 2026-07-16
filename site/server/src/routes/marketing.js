const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getRoi,
} = require('../controllers/marketingController');

const router = express.Router();
router.use(authMiddleware);

// Phase 2.3 — Marketing/ROI (admin-only, org-scoped via ?orgId=).
router.get('/marketing/campaigns', listCampaigns);
router.post('/marketing/campaigns', createCampaign);
router.patch('/marketing/campaigns/:id', updateCampaign);
router.delete('/marketing/campaigns/:id', deleteCampaign);
router.get('/marketing/roi', getRoi);

module.exports = router;
