const mongoose = require('mongoose');

const trainingFeedbackSchema = new mongoose.Schema({
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
  whatsappNumber: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'WhatsApp number must be 10 digits']
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  addressOfCommunication: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 500
  },
  occupation: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 200
  },
  dateOfBirth: {
    type: Date,
    required: true
  },
  gender: {
    type: String,
    required: true,
    enum: ['Male', 'Female']
  },
  educationQualification: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 200
  },
  yearsOfExperience: {
    type: Number,
    required: true,
    min: 0,
    max: 50
  },
  anythingToConvey: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  }
}, { timestamps: true });

trainingFeedbackSchema.index({ createdAt: -1 });
trainingFeedbackSchema.index({ mobileNumber: 1 });
trainingFeedbackSchema.index({ email: 1 });
trainingFeedbackSchema.index({ gender: 1 });
trainingFeedbackSchema.index({ occupation: 1 });

trainingFeedbackSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const TrainingFeedback = mongoose.model('TrainingFeedback', trainingFeedbackSchema);

module.exports = TrainingFeedback;
