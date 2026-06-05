'use strict';

const mongoose = require('mongoose');

const knowledgeChunkSchema = new mongoose.Schema(
  {
    sourceId: {
      type: Number,
      required: true,
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
      default: 0,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    question: {
      type: String,
      required: true,
      maxlength: 4096,
    },
    answer: {
      type: String,
      required: true,
      maxlength: 16384,
    },
    embedText: {
      type: String,
      required: true,
      maxlength: 20000,
    },
    contentHash: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    embedding: {
      type: [Number],
      required: true,
    },
    embeddingModel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    embeddingDimensions: {
      type: Number,
      required: true,
      min: 1,
    },
    active: {
      type: Boolean,
      default: true,
    },
    sourceVersion: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
    },
    indexedAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

knowledgeChunkSchema.index({ sourceId: 1, chunkIndex: 1 }, { unique: true });
knowledgeChunkSchema.index({ category: 1, active: 1 });
knowledgeChunkSchema.index({ active: 1 });

module.exports = mongoose.model('KnowledgeChunk', knowledgeChunkSchema);
