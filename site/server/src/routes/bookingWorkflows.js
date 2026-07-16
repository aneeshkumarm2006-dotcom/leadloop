const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listWorkflows,
  createWorkflow,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
} = require('../controllers/bookingWorkflowController');

const router = express.Router();
router.use(authMiddleware);

router.get('/booking-workflows', listWorkflows);
router.post('/booking-workflows', createWorkflow);
router.get('/booking-workflows/:id', getWorkflow);
router.patch('/booking-workflows/:id', updateWorkflow);
router.delete('/booking-workflows/:id', deleteWorkflow);

module.exports = router;
