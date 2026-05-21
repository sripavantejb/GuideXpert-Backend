const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { BDA_LANGUAGES } = require('../constants/bdaLanguage');

const bdaSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 100,
  },
  phone: {
    type: String,
    trim: true,
    match: [/^\d{10}$/, 'Phone must be 10 digits'],
    sparse: true,
    unique: true,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 120,
    sparse: true,
    unique: true,
  },
  password: {
    type: String,
    minlength: 6,
    select: false,
  },
  role: {
    type: String,
    enum: ['BDA'],
    default: 'BDA',
  },
  language: {
    type: String,
    enum: BDA_LANGUAGES,
    index: true,
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
    index: true,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null,
  },
}, {
  timestamps: true,
  versionKey: false,
});

bdaSchema.index({ status: 1, name: 1 });
bdaSchema.index({ email: 1 });
bdaSchema.index({ phone: 1 });

bdaSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

bdaSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Bda', bdaSchema);
