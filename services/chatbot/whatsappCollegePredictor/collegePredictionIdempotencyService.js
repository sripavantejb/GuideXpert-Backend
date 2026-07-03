'use strict';

const WhatsAppInboundMessage = require('../../../models/WhatsAppInboundMessage');

let inboundModel = WhatsAppInboundMessage;
let getFn = null;
let claimFn = null;

function setCollegePredictionIdempotencyDeps(deps = {}) {
  inboundModel = deps.WhatsAppInboundMessage || WhatsAppInboundMessage;
  getFn = deps.getInboundPredictionCompletion ?? null;
  claimFn = deps.claimInboundPredictionCompletion ?? null;
}

/**
 * @param {string|import('mongoose').Types.ObjectId} inboundId
 */
async function getInboundPredictionCompletion(inboundId) {
  if (getFn) {
    return getFn(inboundId);
  }
  if (!inboundId) return null;
  const row = await inboundModel
    .findById(inboundId)
    .select('collegePrediction')
    .lean();
  if (!row?.collegePrediction?.predictionCompleted) return null;
  return row.collegePrediction;
}

/**
 * Atomically record completion for an inbound.
 * @returns {Promise<{ record: object|null, isNewClaim: boolean }>}
 */
async function claimInboundPredictionCompletion(inboundId, completion) {
  if (claimFn) {
    return claimFn(inboundId, completion);
  }
  if (!inboundId || !completion) {
    return { record: null, isNewClaim: false };
  }

  const updated = await inboundModel
    .findOneAndUpdate(
      {
        _id: inboundId,
        'collegePrediction.predictionCompleted': { $ne: true },
      },
      {
        $set: {
          collegePrediction: {
            ...completion,
            predictionCompleted: true,
          },
        },
      },
      { new: true }
    )
    .select('collegePrediction')
    .lean();

  if (updated?.collegePrediction) {
    return { record: updated.collegePrediction, isNewClaim: true };
  }

  const existing = await getInboundPredictionCompletion(inboundId);
  return { record: existing, isNewClaim: false };
}

module.exports = {
  getInboundPredictionCompletion,
  claimInboundPredictionCompletion,
  setCollegePredictionIdempotencyDeps,
};
