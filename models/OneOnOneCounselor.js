const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const schema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
      unique: true,
    },
    mobile: {
      type: String,
      trim: true,
      match: [/^\d{10}$/, 'Mobile must be 10 digits'],
      sparse: true,
    },
    password: { type: String, minlength: 6, select: false },
    profileImage: { type: String, trim: true, maxlength: 500, default: '' },
    collegeName: { type: String, trim: true, maxlength: 120, default: '' },
    designation: { type: String, trim: true, maxlength: 120, default: '' },
    bio: { type: String, trim: true, maxlength: 2000, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    role: { type: String, enum: ['oneOnOneCounselor'], default: 'oneOnOneCounselor' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true, versionKey: false }
);

schema.index({ isActive: 1, name: 1 });

schema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

schema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('OneOnOneCounselor', schema);
