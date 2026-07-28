'use strict';

const {
  FLOW_ID,
  AWAITING,
  initialContext,
  processJourneyTurn,
} = require('./careerCounsellingJourneyEngine');

function handleCareerCounsellingMessage(text, context = {}, opts = {}) {
  return processJourneyTurn(text, context, opts);
}

module.exports = {
  FLOW_ID,
  AWAITING,
  initialContext,
  handleCareerCounsellingMessage,
};
