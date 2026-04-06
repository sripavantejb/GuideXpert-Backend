const mongoose = require('mongoose');

const callSessionSchema = new mongoose.Schema({
  callId: { type: String, trim: true },
  phone: { type: String, trim: true },
  agentName: { type: String, trim: true },
  callType: { type: String, trim: true },
  duration: { type: Number },
  status: { type: String, trim: true },
  recordingUrl: { type: String, trim: true },
  summary: { type: String, trim: true },
  transcript: { type: String, trim: true },
  tag: { type: String, trim: true },
  sessionRating: { type: String, trim: true },
  candidateQuestions: { type: String, trim: true },
  availabilityForTraining: { type: String, trim: true },
  endReason: { type: String, trim: true },
  endedBy: { type: String, trim: true },
  callTime: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('CallSession', callSessionSchema);
