'use strict';

const { logChatbotEvent } = require('../chatbotStructuredLog');

const PIPELINE = 'career_counselling_journey';

function logCareerCounsellingEvent(event, fields = {}) {
  logChatbotEvent(event, {
    pipeline: PIPELINE,
    careerPhase: fields.phase ?? null,
    careerStep: fields.step ?? null,
    ...fields,
  });
}

function logCareerPhaseStarted(fields) {
  logCareerCounsellingEvent('career_phase_started', fields);
}

function logCareerStepCompleted(fields) {
  logCareerCounsellingEvent('career_step_completed', fields);
}

function logCareerPhaseCompleted(fields) {
  logCareerCounsellingEvent('career_phase_completed', fields);
}

function logCareerDropoff(fields) {
  logCareerCounsellingEvent('career_dropoff', fields);
}

function logCareerResume(fields) {
  logCareerCounsellingEvent('career_resume', fields);
}

function logCareerInterruption(fields) {
  logCareerCounsellingEvent('career_interruption', fields);
}

module.exports = {
  logCareerPhaseStarted,
  logCareerStepCompleted,
  logCareerPhaseCompleted,
  logCareerDropoff,
  logCareerResume,
  logCareerInterruption,
};
