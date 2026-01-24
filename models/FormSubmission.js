const mongoose = require('mongoose');

const formSubmissionSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits']
  },
  occupation: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 200
  },
  demoInterest: {
    type: String,
    required: true,
    enum: ['YES_SOON', 'MAYBE_LATER']
  },
  selectedSlot: {
    type: String,
    enum: ['SATURDAY_7PM', 'SUNDAY_3PM'],
    required: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

formSubmissionSchema.index({ phone: 1 });
formSubmissionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('FormSubmission', formSubmissionSchema);
