const express = require('express');
const router = express.Router();
const {
  submitOneOnOneCounselingLead,
  saveOneOnOneSection1,
  saveOneOnOneSection2,
  saveOneOnOneSection3,
} = require('../controllers/oneOnOneCounselingController');

router.post('/section1', saveOneOnOneSection1);
router.post('/section2', saveOneOnOneSection2);
router.post('/section3', saveOneOnOneSection3);
router.post('/', submitOneOnOneCounselingLead);

module.exports = router;
