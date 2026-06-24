'use strict';

function isCollegePredictorEnabled() {
  return String(process.env.CHATBOT_COLLEGE_PREDICTOR_ENABLED || '').trim() === '1';
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
    console.warn('[env] CHATBOT_COLLEGE_PREDICTOR_ENABLED=1 but NW_PREDICTORS_ACCESS_TOKEN is missing.');
  }
}

module.exports = {
  isCollegePredictorEnabled,
  getCollegePredictorConfigStatus,
  logCollegePredictorConfigStatus,
};
