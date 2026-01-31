const mongoose = require('mongoose');

const meetingAttendanceSchema = new mongoose.Schema({
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

meetingAttendanceSchema.index({ timestamp: -1 });
meetingAttendanceSchema.index({ createdAt: -1 });

meetingAttendanceSchema.pre('save', function(next) {
  this.timestamp = this.timestamp || Date.now();
  this.updatedAt = Date.now();
  next();
});

const MeetingAttendance = mongoose.model('MeetingAttendance', meetingAttendanceSchema);

module.exports = MeetingAttendance;
