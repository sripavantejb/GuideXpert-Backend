const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    sessionTitle: { type: String, required: true, trim: true, minlength: 2, maxlength: 200 },
    slotDate: { type: String, required: true, trim: true, match: [/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'] },
    slotTime: { type: String, required: true, trim: true, maxlength: 80 },
    maxBookings: { type: Number, required: true, min: 1, max: 500 },
    currentBookings: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    oneOnOneCounselorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OneOnOneCounselor',
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true }
);

schema.index({ slotDate: 1, isActive: 1 });
schema.index({ oneOnOneCounselorId: 1, isActive: 1 });

schema.virtual('isFull').get(function isFull() {
  return this.currentBookings >= this.maxBookings;
});

module.exports = mongoose.model('GuidanceSlot', schema);
