const mongoose = require('mongoose');

/** Dedicated collection for the /iitcounsellingmeet attendance flow.
 *  Mirrors MeetingAttendance shape so admin tooling stays consistent,
 *  but is intentionally a separate collection so the IIT counselling
 *  flow can never be conflated with the demo-window /meet attendance. */
const iitMeetAttendanceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100
  },
  mobileNumber: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Mobile number must be 10 digits']
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  attendanceStatus: {
    type: String,
    enum: ['joined'],
    default: 'joined'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

iitMeetAttendanceSchema.index({ timestamp: -1 });
iitMeetAttendanceSchema.index({ createdAt: -1 });
iitMeetAttendanceSchema.index({ mobileNumber: 1 });
iitMeetAttendanceSchema.index({ mobileNumber: 1, timestamp: -1 });

iitMeetAttendanceSchema.pre('save', function () {
  this.timestamp = this.timestamp || Date.now();
  this.updatedAt = Date.now();
});

const IitMeetAttendance = mongoose.model('IitMeetAttendance', iitMeetAttendanceSchema);

module.exports = IitMeetAttendance;
