const mongoose = require('mongoose');

/** Position & style for name or mobile text; x/y are % of poster container (0–100). */
const overlayFieldSchema = new mongoose.Schema(
  {
    x: { type: Number, default: 12, min: 0, max: 100 },
    y: { type: Number, default: 12, min: 0, max: 100 },
    fontSize: { type: Number, default: 20, min: 4, max: 400 },
    color: { type: String, default: '#111827' },
    fontWeight: { type: String, default: '600' },
    textAlign: { type: String, default: 'left', enum: ['left', 'center', 'right', 'justify'] },
  },
  { _id: false }
);

const posterTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    route: { type: String, required: true },
    svgTemplate: { type: String, required: true },
    published: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
    nameField: { type: overlayFieldSchema, default: () => ({}) },
    mobileField: { type: overlayFieldSchema, default: () => ({}) },
    /** @deprecated Legacy only; API migrates to nameField / mobileField in responses */
    elements: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

posterTemplateSchema.index({ route: 1 }, { unique: true });

const PosterTemplate = mongoose.model('PosterTemplate', posterTemplateSchema);

module.exports = PosterTemplate;
