const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    minlength: 2,
    maxlength: 50
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    trim: true,
    maxlength: 100
  },
  isSuperAdmin: {
    type: Boolean,
    default: false
  },
  sectionAccess: {
    type: [String],
    default: []
  },
  copilotAgentProfile: {
    enabled: { type: Boolean, default: false },
    role: {
      type: String,
      enum: ['sr_counsellor', 'iit_expert', 'scholarship_expert', 'general_counsellor', 'admin'],
      default: 'sr_counsellor',
    },
    availability: {
      type: String,
      enum: ['active', 'away', 'offline'],
      default: 'active',
    },
    maxConcurrentConversations: { type: Number, min: 1, max: 50, default: 5 },
    specialties: [{ type: String, maxlength: 32 }],
    legacySlot: { type: String, enum: ['sr1', 'sr2', null], default: null },
    roundRobinIndex: { type: Number, default: 0 },
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

// username already has unique: true → index created automatically

adminSchema.pre('save', async function() {
  this.updatedAt = Date.now();
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

adminSchema.methods.comparePassword = function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const Admin = mongoose.model('Admin', adminSchema);
module.exports = Admin;
