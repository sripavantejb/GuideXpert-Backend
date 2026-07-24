const mongoose = require('mongoose');

const CATEGORIES = [
  'exam',
  'admission',
  'deadline',
  'tool',
  'counselling',
  'general',
];

const studentWorkspaceUpdateSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    summary: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    category: {
      type: String,
      enum: CATEGORIES,
      default: 'general',
    },
    tag: {
      type: String,
      trim: true,
      maxlength: 40,
      default: '',
    },
    linkUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    linkLabel: {
      type: String,
      trim: true,
      maxlength: 80,
      default: 'Learn more',
    },
    imageUrl: {
      type: String,
      trim: true,
      maxlength: 800,
      default: '',
    },
    priority: {
      type: String,
      enum: ['normal', 'important', 'urgent'],
      default: 'normal',
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
    pinned: {
      type: Boolean,
      default: false,
    },
    showInNavbar: {
      type: Boolean,
      default: true,
    },
    showOnHome: {
      type: Boolean,
      default: true,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
  },
  { timestamps: true }
);

studentWorkspaceUpdateSchema.index({ status: 1, publishedAt: -1 });
studentWorkspaceUpdateSchema.index({ pinned: -1, publishedAt: -1 });

const StudentWorkspaceUpdate = mongoose.model(
  'StudentWorkspaceUpdate',
  studentWorkspaceUpdateSchema
);

module.exports = StudentWorkspaceUpdate;
module.exports.CATEGORIES = CATEGORIES;
