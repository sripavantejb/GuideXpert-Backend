const mongoose = require('mongoose');

/** Dedicated collection for the /iitcounsellingmeethindi attendance flow.
 *  Same shape as IitMeetAttendance; separate collection so Hindi and English
 *  meet registrations are never mixed. */
const iitMeetHindiAttendanceSchema = new mongoose.Schema(
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
  { collection: 'iitMeetHindiAttendances' }
);

iitMeetHindiAttendanceSchema.index({ timestamp: -1 });
iitMeetHindiAttendanceSchema.index({ createdAt: -1 });
iitMeetHindiAttendanceSchema.index({ mobileNumber: 1 });
iitMeetHindiAttendanceSchema.index({ mobileNumber: 1, timestamp: -1 });

iitMeetHindiAttendanceSchema.pre('save', function () {
  this.timestamp = this.timestamp || Date.now();
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('IitMeetHindiAttendance', iitMeetHindiAttendanceSchema);
