const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  runAutomationNow,
  getRunLog,
  getActionRunLog,
  getActionCatalog,
  draftAutomation,
} = require('../controllers/automationController');
const {
  listRecipes,
  createFromRecipe,
} = require('../controllers/automationRecipeController');
const { getHub, getUsage, getConnections } = require('../controllers/automationHubController');

const router = express.Router();

router.use(authMiddleware);

// Board-scoped
router.get('/boards/:boardId/automations', listAutomations);
router.post('/boards/:boardId/automations', createAutomation);

// F5 action catalogue — static, authenticated. Registered before the
// `/automations/:id` param routes so the literal path isn't captured as an `:id`.
router.get('/automations/action-catalog', getActionCatalog);

// "Describe it" — AI draft of an automation from plain language (admin).
router.post('/automations/draft', draftAutomation);

// F6 recipe library — literal paths, registered before `/automations/:id` so
// `recipes` / `from-recipe` aren't captured as an `:id`.
router.get('/automations/recipes', listRecipes);
router.post('/automations/from-recipe/:slug', createFromRecipe);

// Phase 1b — account-wide Automations Hub (admin-only, org-scoped via ?orgId=).
// Literal paths, registered before `/automations/:id`.
router.get('/automations/hub', getHub);
router.get('/automations/usage', getUsage);
router.get('/automations/connections', getConnections);

// Automation-scoped
router.put('/automations/:id', updateAutomation);
router.delete('/automations/:id', deleteAutomation);
router.post('/automations/:id/run-now', runAutomationNow);
// Run log — member-level read of the last 20 firings (F4.6).
router.get('/automations/:id/run-log', getRunLog);
// Per-action audit rows (F5.3) — member-level.
router.get('/automations/:id/run-log/actions', getActionRunLog);

module.exports = router;
