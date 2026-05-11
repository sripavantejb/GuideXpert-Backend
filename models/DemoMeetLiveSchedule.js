const mongoose = require('mongoose');

const recurringWindowSchema = new mongoose.Schema(
  {
    /** 0 = Sunday … 6 = Saturday (interpreted in Asia/Kolkata). */
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    /** "HH:mm" 24h in IST */
    startHHmm: { type: String, required: true, trim: true },
    endHHmm: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const demoMeetLiveScheduleSchema = new mongoose.Schema(
  {
    singletonKey: { type: String, default: 'demoMeetLive', unique: true, immutable: true },
    recurringWindows: { type: [recurringWindowSchema], default: [] },
    joinEarlyMinutes: { type: Number, default: 5, min: 0, max: 120 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DemoMeetLiveSchedule', demoMeetLiveScheduleSchema);
