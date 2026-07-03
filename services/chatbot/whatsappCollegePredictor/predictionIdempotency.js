'use strict';

const crypto = require('crypto');

/**
 * Stable hash of prediction inputs — detects profile changes on the same inbound.
 * @param {object} ctx
 */
function buildPredictionHash(ctx) {
  const payload = {
    exam: ctx?.exam ?? null,
    rank: ctx?.rank ?? null,
    percentile: ctx?.percentile ?? null,
    categoryN: ctx?.categoryN ?? null,
    categoryLabel: ctx?.categoryLabel ?? null,
    gender: ctx?.gender ?? null,
    quota: ctx?.quota ?? null,
    admission_category_name_enum: ctx?.admission_category_name_enum ?? null,
    reservation_category_codes: ctx?.reservation_category_codes ?? null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

/**
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.inboundId
 * @param {object} params.ctx
 * @param {string} params.cachedReply
 * @param {number} params.collegeCount
 */
function buildPredictionCompletion({ inboundId, ctx, cachedReply, collegeCount }) {
  const now = new Date();
  return {
    lastPredictionInboundId: String(inboundId),
    predictionCompleted: true,
    predictionTimestamp: now.toISOString(),
    predictionHash: buildPredictionHash(ctx),
    cachedReply,
    predictorExam: ctx?.exam ?? null,
    rank: ctx?.rank ?? ctx?.percentile ?? null,
    category: ctx?.categoryLabel ?? null,
    collegeCount: collegeCount ?? 0,
  };
}

/**
 * @param {object|null|undefined} record — bot context or inbound completion
 * @param {string|import('mongoose').Types.ObjectId} inboundId
 * @param {string} [predictionHash]
 */
function findCompletedPrediction(record, inboundId, predictionHash = null) {
  if (!record || !record.predictionCompleted) return null;
  if (String(record.lastPredictionInboundId) !== String(inboundId)) return null;
  if (predictionHash && record.predictionHash && record.predictionHash !== predictionHash) {
    return null;
  }
  if (!record.cachedReply) return null;
  return record;
}

module.exports = {
  buildPredictionHash,
  buildPredictionCompletion,
  findCompletedPrediction,
};
