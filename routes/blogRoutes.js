const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const { listBlogs, getBlogById, createBlog, updateBlog, deleteBlog } = require('../controllers/blogController');

const router = express.Router();

router.get('/', listBlogs);
router.get('/:id', getBlogById);
router.post('/', requireAdmin, createBlog);
router.put('/:id', requireAdmin, updateBlog);
router.delete('/:id', requireAdmin, deleteBlog);

module.exports = router;
