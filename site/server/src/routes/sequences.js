const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  listSequences,
  createSequence,
  getSequence,
  updateSequence,
  deleteSequence,
  enrollLeads,
  listEnrollments,
  getStats,
  stopEnrollment,
} = require('../controllers/sequenceController');

const router = express.Router();

router.use(authMiddleware);

// Board-scoped list + create.
router.get('/boards/:boardId/sequences', listSequences);
router.post('/boards/:boardId/sequences', createSequence);

// Enrollment-scoped (literal path before `/sequences/:id` so it isn't captured).
router.post('/sequences/enrollments/:enrollmentId/stop', stopEnrollment);

// Sequence-scoped.
router.get('/sequences/:id', getSequence);
router.put('/sequences/:id', updateSequence);
router.delete('/sequences/:id', deleteSequence);
router.post('/sequences/:id/enroll', enrollLeads);
router.get('/sequences/:id/enrollments', listEnrollments);
router.get('/sequences/:id/stats', getStats);

module.exports = router;
