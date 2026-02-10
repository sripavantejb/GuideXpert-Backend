const express = require('express');
const router = express.Router();
const requireCounsellor = require('../middleware/requireCounsellor');
const { list, create, update, remove } = require('../controllers/counsellorSessionController');

router.use(requireCounsellor);

router.get('/', list);
router.post('/', create);
router.patch('/:id', update);
router.delete('/:id', remove);

module.exports = router;
