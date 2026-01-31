const mongoose = require('mongoose');

const meetEntrySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  mobile: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Mobile must be 10 digits'],
    unique: true
  },
  status: {
    type: String,
    enum: ['pending', 'registered', 'joined'],
    default: 'pending'
  },
  registeredAt: {
    type: Date,
    default: Date.now
  },
  joinedAt: {
    type: Date
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

// Indexes for performance
meetEntrySchema.index({ mobile: 1 });
meetEntrySchema.index({ createdAt: -1 });
meetEntrySchema.index({ status: 1 });

// Update updatedAt before saving
meetEntrySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual field for time difference between registered and joined
meetEntrySchema.virtual('timeToJoin').get(function() {
  if (this.joinedAt && this.registeredAt) {
    return Math.floor((this.joinedAt - this.registeredAt) / 1000); // seconds
  }
  return null;
});

const MeetEntry = mongoose.model('MeetEntry', meetEntrySchema);

module.exports = MeetEntry;
