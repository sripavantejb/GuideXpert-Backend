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
    match: [/^\d{10}$/, 'Phone must be 10 digits'],
    unique: true
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
    enum: ['YES_SOON', 'MAYBE_LATER'],
    required: false
  },
  selectedSlot: {
    type: String,
    required: false
  },
  step1Data: {
    fullName: {
      type: String,
      trim: true
    },
    whatsappNumber: {
      type: String,
      trim: true
    },
    occupation: {
      type: String,
      trim: true
    },
    step1CompletedAt: {
      type: Date
    }
  },
  step2Data: {
    otpVerified: {
      type: Boolean,
      default: false
    },
    step2CompletedAt: {
      type: Date
    }
  },
  step3Data: {
    selectedSlot: {
      type: String
    },
    slotDate: {
      type: Date
    },
    step3CompletedAt: {
      type: Date
    }
  },
  currentStep: {
    type: Number,
    default: 1,
    min: 1,
    max: 4
  },
  applicationStatus: {
    type: String,
    enum: ['in_progress', 'registered', 'completed'],
    default: 'in_progress'
  },
  isRegistered: {
    type: Boolean,
    default: false
  },
  registeredAt: {
    type: Date
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  interestLevel: {
    type: Number,
    min: 1,
    max: 5,
    required: false
  },
  postRegistrationData: {
    interestLevel: {
      type: Number,
      min: 1,
      max: 5
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    completedAt: {
      type: Date
    }
  },
  // Reminder SMS tracking (sent 4 hours before slot)
  reminderSent: {
    type: Boolean,
    default: false
  },
  reminderSentAt: {
    type: Date,
    default: null
  },
  // Meet Link SMS tracking (sent 1 hour before slot)
  meetLinkSent: {
    type: Boolean,
    default: false
  },
  meetLinkSentAt: {
    type: Date,
    default: null
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

// phone already has unique: true → index created automatically
formSubmissionSchema.index({ createdAt: -1 });
formSubmissionSchema.index({ applicationStatus: 1 });
// Index for reminder cron job queries
formSubmissionSchema.index({ isRegistered: 1, reminderSent: 1, 'step3Data.slotDate': 1 });
// Index for meet link cron job queries
formSubmissionSchema.index({ isRegistered: 1, meetLinkSent: 1, 'step3Data.slotDate': 1 });

// Update updatedAt before saving
formSubmissionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Log collection name when model is created
const FormSubmission = mongoose.model('FormSubmission', formSubmissionSchema);

// Log collection info after model is created (will be available after connection)
if (mongoose.connection.readyState === 1) {
  console.log(`[FormSubmission Model] Collection name: ${FormSubmission.collection.name}`);
  console.log(`[FormSubmission Model] Database: ${FormSubmission.db.databaseName}`);
} else {
  mongoose.connection.once('connected', () => {
    console.log(`[FormSubmission Model] Collection name: ${FormSubmission.collection.name}`);
    console.log(`[FormSubmission Model] Database: ${FormSubmission.db.databaseName}`);
  });
}

module.exports = FormSubmission;
