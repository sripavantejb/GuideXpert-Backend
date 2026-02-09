const express = require('express');
const router = express.Router();
const requireCounsellor = require('../middleware/requireCounsellor');
const {
  list,
  getOne,
  create,
  update,
  softDelete,
  restore,
  bulkUpdateStatus,
  bulkSoftDelete,
  exportStudents,
} = require('../controllers/studentController');

router.use(requireCounsellor);

router.get('/', list);
router.get('/export', exportStudents);
router.patch('/bulk-status', bulkUpdateStatus);
router.delete('/bulk', bulkSoftDelete);
router.get('/:id', getOne);
router.post('/', create);
router.patch('/:id', update);
router.delete('/:id', softDelete);
router.post('/:id/restore', restore);

module.exports = router;
