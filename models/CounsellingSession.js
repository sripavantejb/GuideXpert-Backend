const mongoose = require('mongoose');

const STATUS_ENUM = ['upcoming', 'completed', 'cancelled'];
const PLATFORM_ENUM = ['Google Meet', 'Zoom', 'Other'];

const counsellingSessionSchema = new mongoose.Schema(
  {
    counsellorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Counsellor',
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Student',
      default: null,
    },
    studentName: {
      type: String,
      trim: true,
      default: '',
    },
    purpose: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    scheduledAt: {
      type: Date,
      required: true,
      index: true,
    },
    platform: {
      type: String,
      trim: true,
      enum: PLATFORM_ENUM,
      default: 'Google Meet',
    },
    meetingLink: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: STATUS_ENUM,
      default: 'upcoming',
      index: true,
    },
  },
  { timestamps: true }
);

counsellingSessionSchema.index({ counsellorId: 1, scheduledAt: -1 });

module.exports = mongoose.model('CounsellingSession', counsellingSessionSchema);
