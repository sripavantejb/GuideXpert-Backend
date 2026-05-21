const mongoose = require('mongoose');

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

module.exports = mongoose.model('Bda', bdaSchema);
