const express = require('express');
const router = express.Router();
const requireCounsellor = require('../middleware/requireCounsellor');
const {
  getAssessmentLinks,
  getAssessmentResults,
  getAssessmentResultById,
} = require('../controllers/counsellorAssessmentController');

router.use(requireCounsellor);
router.get('/assessment-links', getAssessmentLinks);
router.get('/assessment-results', getAssessmentResults);
router.get('/assessment-results/:id', getAssessmentResultById);

module.exports = router;
