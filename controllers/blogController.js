const mongoose = require('mongoose');
const Blog = require('../models/Blog');

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function hasContentJson(doc) {
  return doc && typeof doc === 'object' && doc.type === 'doc' && Array.isArray(doc.content);
}

function normalizeIncomingContent(body = {}) {
  const contentJson = body.contentJson ?? null;
  const contentHtml = body.contentHtml != null ? String(body.contentHtml) : '';
  const legacyContent = body.content != null ? String(body.content) : '';

  return {
    contentJson: hasContentJson(contentJson) ? contentJson : null,
    contentHtml,
    // Keep compatibility field for old records/readers.
    content: contentHtml || legacyContent,
  };
}

/**
 * GET /api/blogs?limit=
 */
async function listBlogs(req, res) {
  try {
    const limitRaw = req.query.limit;
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 0, 0), 100);
    const query = Blog.find().sort({ createdAt: -1 }).lean();
    if (limit > 0) query.limit(limit);
    const blogs = await query.exec();
    res.json({ success: true, data: blogs });
  } catch (err) {
    console.error('[listBlogs]', err);
    res.status(500).json({ success: false, message: 'Failed to load blogs' });
  }
}

/**
 * GET /api/blogs/:id
 */
async function getBlogById(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid blog id' });
    }
    const blog = await Blog.findById(id).lean();
    if (!blog) {
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }
    res.json({ success: true, data: blog });
  } catch (err) {
    console.error('[getBlogById]', err);
    res.status(500).json({ success: false, message: 'Failed to load blog' });
  }
}

/**
 * POST /api/admin/blogs
 */
async function createBlog(req, res) {
  try {
    const { title, subtitle, category, coverImage, author, slug } = req.body || {};
    const normalizedContent = normalizeIncomingContent(req.body || {});
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }
    if (!category || !String(category).trim()) {
      return res.status(400).json({ success: false, message: 'Category is required' });
    }
    if (!coverImage || !String(coverImage).trim()) {
      return res.status(400).json({ success: false, message: 'Cover image is required' });
    }
    if (!normalizedContent.contentJson) {
      return res.status(400).json({ success: false, message: 'Structured content is required' });
    }
    const blog = await Blog.create({
      title: String(title).trim(),
      subtitle: subtitle != null ? String(subtitle).trim() : '',
      category: String(category).trim(),
      coverImage: String(coverImage).trim(),
      content: normalizedContent.content,
      contentHtml: normalizedContent.contentHtml,
      contentJson: normalizedContent.contentJson,
      author: author != null && String(author).trim() ? String(author).trim() : undefined,
      slug: slug != null && String(slug).trim() ? String(slug).trim().toLowerCase() : undefined,
    });
    res.status(201).json({ success: true, data: blog });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Slug already exists' });
    }
    console.error('[createBlog]', err);
    res.status(500).json({ success: false, message: 'Failed to create blog' });
  }
}

/**
 * PUT /api/admin/blogs/:id
 */
async function updateBlog(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid blog id' });
    }
    const { title, subtitle, category, coverImage, author, slug } = req.body || {};
    const updates = {};
    const normalizedContent = normalizeIncomingContent(req.body || {});
    if (title !== undefined) updates.title = String(title).trim();
    if (subtitle !== undefined) updates.subtitle = String(subtitle).trim();
    if (category !== undefined) updates.category = String(category).trim();
    if (coverImage !== undefined) updates.coverImage = String(coverImage).trim();
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'contentJson')) {
      if (req.body.contentJson != null && !hasContentJson(req.body.contentJson)) {
        return res.status(400).json({ success: false, message: 'Invalid structured content payload' });
      }
      updates.contentJson = normalizedContent.contentJson;
      updates.contentHtml = normalizedContent.contentHtml;
      updates.content = normalizedContent.content;
    } else if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'contentHtml')) {
      updates.contentHtml = normalizedContent.contentHtml;
      updates.content = normalizedContent.content;
    } else if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'content')) {
      updates.content = normalizedContent.content;
    }
    if (author !== undefined) updates.author = String(author).trim() || 'GuideXpert Editorial';
    if (slug !== undefined) updates.slug = slug ? String(slug).trim().toLowerCase() : null;

    const blog = await Blog.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });
    if (!blog) {
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }
    res.json({ success: true, data: blog });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Slug already exists' });
    }
    console.error('[updateBlog]', err);
    res.status(500).json({ success: false, message: 'Failed to update blog' });
  }
}

/**
 * DELETE /api/admin/blogs/:id
 */
async function deleteBlog(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'Invalid blog id' });
    }
    const deleted = await Blog.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Blog not found' });
    }
    res.json({ success: true, message: 'Blog deleted' });
  } catch (err) {
    console.error('[deleteBlog]', err);
    res.status(500).json({ success: false, message: 'Failed to delete blog' });
  }
}

module.exports = {
  listBlogs,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
};
