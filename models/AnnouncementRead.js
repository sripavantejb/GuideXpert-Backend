const mongoose = require('mongoose');

const announcementReadSchema = new mongoose.Schema(
  {
    announcement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Announcement',
      required: true,
    },
    counsellor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Counsellor',
      required: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
    reactionType: {
      type: String,
      enum: ['helpful', 'appreciated', 'great', 'important'],
      default: null,
    },
    acknowledged: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: false }
);

announcementReadSchema.index({ announcement: 1, counsellor: 1 }, { unique: true });

const AnnouncementRead = mongoose.model('AnnouncementRead', announcementReadSchema);
module.exports = AnnouncementRead;
