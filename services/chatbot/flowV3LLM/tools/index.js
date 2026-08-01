'use strict';

const toolBroker = require('./toolBroker');
const nextQuestion = require('./nextQuestion');
const getCuratedCatalog = require('./getCuratedCatalog');
const getPredictorMatches = require('./getPredictorMatches');
const getBookingSlots = require('./getBookingSlots');
const updateLeadProfile = require('./updateLeadProfile');
const createBookingLink = require('./createBookingLink');
const escalateToHuman = require('./escalateToHuman');

module.exports = {
  ...toolBroker,
  tools: Object.freeze({
    next_question: nextQuestion,
    get_curated_catalog: getCuratedCatalog,
    get_predictor_matches: getPredictorMatches,
    get_booking_slots: getBookingSlots,
    update_lead_profile: updateLeadProfile,
    create_booking_link: createBookingLink,
    escalate_to_human: escalateToHuman,
  }),
  nextQuestion,
  getCuratedCatalog,
  getPredictorMatches,
  getBookingSlots,
  updateLeadProfile,
  createBookingLink,
  escalateToHuman,
};
