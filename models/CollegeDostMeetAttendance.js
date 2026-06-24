const mongoose = require('mongoose');

const collegeDostMeetAttendanceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    mobileNumber: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10}$/, 'Mobile number must be 10 digits'],
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    attendanceStatus: {
      type: String,
      enum: ['joined'],
      default: 'joined',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { collection: 'collegeDostMeetAttendances' }
);

collegeDostMeetAttendanceSchema.index({ timestamp: -1 });
collegeDostMeetAttendanceSchema.index({ createdAt: -1 });
collegeDostMeetAttendanceSchema.index({ mobileNumber: 1 });
collegeDostMeetAttendanceSchema.index({ mobileNumber: 1, timestamp: -1 });

collegeDostMeetAttendanceSchema.pre('save', function () {
  this.timestamp = this.timestamp || Date.now();
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('CollegeDostMeetAttendance', collegeDostMeetAttendanceSchema);
