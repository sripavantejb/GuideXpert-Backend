const mongoose = require('mongoose');

const STATUS_ENUM = ['active', 'inactive', 'on-hold'];

const studentSchema = new mongoose.Schema(
  {
    counsellorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Counsellor',
      required: true,
      index: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    course: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    status: {
      type: String,
      enum: STATUS_ENUM,
      default: 'active',
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Counsellor',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Counsellor',
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

studentSchema.index({ counsellorId: 1, deletedAt: 1 });
studentSchema.index({ counsellorId: 1, fullName: 1, email: 1, phone: 1 });
/** Owner-scoped list: logged-in counsellor sees only rows they created (createdBy). */
studentSchema.index({ counsellorId: 1, createdBy: 1, deletedAt: 1 });

const Student = mongoose.model('Student', studentSchema);
module.exports = Student;
module.exports.STATUS_ENUM = STATUS_ENUM;
