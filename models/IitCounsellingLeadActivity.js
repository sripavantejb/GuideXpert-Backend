const mongoose = require('mongoose');
const { EVENT_TYPES } = require('../constants/iitCounsellingLeadCrm');

const iitCounsellingLeadActivitySchema = new mongoose.Schema({
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IitCounsellingSubmission',
    required: true,
    index: true,
  },
  bdaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bda',
    default: null,
    index: true,
  },
  bdaName: {
    type: String,
    trim: true,
    maxlength: 100,
  },
  actorType: {
    type: String,
    enum: ['admin'],
    default: 'admin',
  },
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
  },
  actorName: {
    type: String,
    trim: true,
    maxlength: 100,
  },
  eventType: {
    type: String,
    enum: EVENT_TYPES,
    required: true,
    index: true,
  },
  fromValue: {
    type: String,
    trim: true,
    maxlength: 64,
  },
  toValue: {
    type: String,
    trim: true,
    maxlength: 64,
  },
  remark: {
    type: String,
    trim: true,
    maxlength: 2000,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  versionKey: false,
});

iitCounsellingLeadActivitySchema.index({ bdaId: 1, createdAt: -1 });
iitCounsellingLeadActivitySchema.index({ leadId: 1, createdAt: -1 });
iitCounsellingLeadActivitySchema.index({ bdaId: 1, eventType: 1, toValue: 1, createdAt: -1 });

module.exports = mongoose.model('IitCounsellingLeadActivity', iitCounsellingLeadActivitySchema);
