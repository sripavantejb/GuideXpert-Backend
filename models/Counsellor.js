const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const counsellorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  phone: {
    type: String,
    trim: true,
    match: /^\d{10}$/,
    unique: true,
    sparse: true,
    default: null,
  },
  role: {
    type: String,
    default: 'counsellor',
    enum: ['counsellor'],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

counsellorSchema.pre('save', function (next) {
  if (this.phone != null && String(this.phone).trim() !== '') {
    const digits = String(this.phone).replace(/\D/g, '');
    this.phone = digits.length >= 10 ? digits.slice(-10) : null;
  }
  next();
});

counsellorSchema.pre('save', function (next) {
  if (!this.isModified('password')) return next();
  const self = this;
  bcrypt.genSalt(10, function (err, salt) {
    if (err) return next(err);
    bcrypt.hash(self.password, salt, function (err, hash) {
      if (err) return next(err);
      self.password = hash;
      next();
    });
  });
});

counsellorSchema.methods.comparePassword = function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const Counsellor = mongoose.model('Counsellor', counsellorSchema);
module.exports = Counsellor;
