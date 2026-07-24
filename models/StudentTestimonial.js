const mongoose = require('mongoose');

const studentTestimonialSchema = new mongoose.Schema(
  {
    studentName: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    quote: {
      type: String,
      trim: true,
      maxlength: 800,
      default: '',
    },
    rank: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    exam: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    colleges: {
      type: [String],
      default: [],
      validate: {
        validator(arr) {
          return Array.isArray(arr) && arr.length <= 8;
        },
        message: 'At most 8 colleges',
      },
    },
    accuracy: {
      type: Number,
      min: 0,
      max: 100,
      default: 95,
    },
    photoUrl: {
      type: String,
      trim: true,
      maxlength: 800,
      default: '',
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
    sortOrder: {
      type: Number,
      default: 0,
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

studentTestimonialSchema.index({ status: 1, pinned: -1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model('StudentTestimonial', studentTestimonialSchema);
