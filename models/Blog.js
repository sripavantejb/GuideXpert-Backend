const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    subtitle: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    coverImage: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      default: '',
    },
    contentHtml: {
      type: String,
      default: '',
    },
    contentJson: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    author: {
      type: String,
      default: 'GuideXpert Editorial',
      trim: true,
      maxlength: 120,
    },
    slug: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
      maxlength: 200,
    },
  },
  { timestamps: true }
);

blogSchema.index({ createdAt: -1 });
blogSchema.index({ category: 1 });

const Blog = mongoose.model('Blog', blogSchema);
module.exports = Blog;
