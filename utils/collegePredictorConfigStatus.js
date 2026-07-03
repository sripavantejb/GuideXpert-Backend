'use strict';

function isCollegePredictorEnabled() {
  return true;
}

function getCollegePredictorConfigStatus() {
  const enabled = isCollegePredictorEnabled();
  const nwTokenPresent = Boolean(String(process.env.NW_PREDICTORS_ACCESS_TOKEN || '').trim());
  return {
    enabled,
    nwTokenPresent,
    ready: enabled && nwTokenPresent,
  };
}

function logCollegePredictorConfigStatus() {
  const s = getCollegePredictorConfigStatus();
  if (s.enabled && !s.ready) {
    console.warn('[env] College predictor is enabled but NW_PREDICTORS_ACCESS_TOKEN is missing.');
  }
}

module.exports = {
  isCollegePredictorEnabled,
  getCollegePredictorConfigStatus,
  logCollegePredictorConfigStatus,
};
