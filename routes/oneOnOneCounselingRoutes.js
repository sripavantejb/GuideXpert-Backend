const express = require('express');
const router = express.Router();
const { attachRouteIndex } = require('../utils/routeIndex');
const {
  submitOneOnOneCounselingLead,
  saveOneOnOneSection1,
  saveOneOnOneSection2,
  saveOneOnOneSection3,
  listMyOneOnOneBookings,
} = require('../controllers/oneOnOneCounselingController');

attachRouteIndex(router, {
  name: 'one-on-one-counseling',
  routes: [
    { method: 'GET', path: '/my-bookings' },
    { method: 'POST', path: '/section1' },
    { method: 'POST', path: '/section2' },
    { method: 'POST', path: '/section3' },
    { method: 'POST', path: '/', note: 'submit lead' },
  ],
});
router.get('/my-bookings', listMyOneOnOneBookings);
router.post('/section1', saveOneOnOneSection1);
router.post('/section2', saveOneOnOneSection2);
router.post('/section3', saveOneOnOneSection3);
router.post('/', submitOneOnOneCounselingLead);

module.exports = router;
