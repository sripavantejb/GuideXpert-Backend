const express = require('express');
const osviAuth = require('../middleware/osviAuth');
const requireAdmin = require('../middleware/requireAdmin');
const {
  saveCallSession,
  saveIitAiCallAnalysis,
  getCallSessions,
} = require('../controllers/osviCallController');

const router = express.Router();

router.post('/iit-ai-call-analysis', osviAuth, saveIitAiCallAnalysis);
router.post('/call-session', osviAuth, saveCallSession);
router.get('/test', (req, res) => {
  return res.json({ message: 'OSVI API working' });
});
router.get('/call-sessions', requireAdmin, getCallSessions);

module.exports = router;
