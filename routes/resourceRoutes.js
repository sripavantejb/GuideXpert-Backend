const express = require('express');
const multer = require('multer');
const {
  publicList,
  requestDownload,
  verifyDownload,
  downloadFile,
} = require('../controllers/studentResourceController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

router.get('/', publicList);
router.post('/:id/request-download', requestDownload);
router.post('/:id/verify-download', verifyDownload);
router.get('/:id/file', downloadFile);

module.exports = router;
module.exports.uploadMiddleware = upload;
