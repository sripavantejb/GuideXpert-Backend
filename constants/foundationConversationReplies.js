'use strict';

/**
 * Deterministic Foundation Conversation replies (English base).
 * Multilingual pipeline may translate outbound after return.
 */

const FOUNDATION_REPLIES = Object.freeze({
  greeting: [
    'Hello! Welcome to GuideXpert.',
    '',
    "I'm here to help with college selection, counselling, JoSAA/JEE guidance, predictors, and more.",
    '',
    'How can I help you today?',
  ].join('\n'),

  identity: [
    "I'm GuideXpert — here to help with admissions and counselling.",
    '',
    'I help students and parents with college selection, admissions guidance, JoSAA/JEE questions, scholarships, documents, predictors, and booking counselling.',
  ].join('\n'),

  capability: [
    'I can help you with:',
    '',
    '• College & career counselling guidance',
    '• College Predictor and Rank Predictor',
    '• JoSAA / JEE / engineering admission questions',
    '• Scholarships, documents, and eligibility basics',
    '• Booking counselling sessions',
    '• Language support',
    '• Connecting you with a human counsellor when you ask',
    '',
    'Tell me what you need, or reply MENU for options.',
  ].join('\n'),

  navigation: null, // resolved to main-menu at runtime

  gratitude: [
    "You're welcome!",
    '',
    "Whenever you're ready, tell me what you'd like help with next.",
  ].join('\n'),

  goodbye: [
    'Take care! It was good talking with you.',
    '',
    'Whenever you need admissions or counselling help again, just message here.',
  ].join('\n'),

  small_talk: [
    "I'm doing well — thanks for asking.",
    '',
    'Whenever you are ready, I can help with admissions, college selection, counselling, or predictors.',
  ].join('\n'),

  language_switch: null, // dynamic

  clarification: null, // dynamic per topic
});

const CLARIFICATION_BY_TOPIC = Object.freeze({
  admission: 'Could you tell me what you\'d like to know about admissions?',
  fees: 'What would you like to know about fees — counselling fees, college fees, or something else?',
  documents: 'Which documents are you asking about — counselling documents, admission documents, or something specific?',
  scholarship: 'Could you tell me what you\'d like to know about scholarships?',
  hostel: 'What would you like to know about hostels — availability, safety, or fees?',
  placements: 'What would you like to know about placements — process, outcomes, or something else?',
  iit: 'Could you tell me what you\'d like to know about IITs?',
  nit: 'Could you tell me what you\'d like to know about NITs?',
  college: 'What would you like help with — predicting colleges, comparing options, or admissions counselling?',
  counselling: 'Could you tell me what you\'d like help with — booking counselling, session details, or general guidance?',
  default: 'Could you tell me a little more about what you need help with?',
});

module.exports = {
  FOUNDATION_REPLIES,
  CLARIFICATION_BY_TOPIC,
};
