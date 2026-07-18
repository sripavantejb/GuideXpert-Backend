'use strict';

/**
 * Personalized recovery copy by last completed phase.
 * Never includes booking URLs. Never restarts from Phase 1.
 */

function displayName(name) {
  const n = String(name || '').trim();
  if (!n) return 'there';
  return n.split(/\s+/)[0].slice(0, 40);
}

function buildRecoveryMessage({ lastPhase, studentName } = {}) {
  const name = displayName(studentName);
  const phase = Number(lastPhase) || 1;

  if (phase >= 13) {
    return [
      `Hi ${name},`,
      '',
      "Your booking wasn't completed.",
      'You can continue whenever you\'re ready.',
      '',
      'Reply to continue where you left off, or reply STOP to opt out.',
    ].join('\n');
  }

  if (phase >= 12) {
    return [
      `Hi ${name},`,
      '',
      'You were exploring counseling options.',
      'Would you like to continue where you left off?',
      '',
      'Reply to continue, or reply STOP to opt out.',
    ].join('\n');
  }

  if (phase >= 11) {
    return [
      `Hi ${name},`,
      '',
      'Last time we were clarifying your final decision.',
      'Would you like to continue?',
      '',
      'Reply to continue, or reply STOP to opt out.',
    ].join('\n');
  }

  if (phase >= 10) {
    return [
      `Hi ${name},`,
      '',
      'We were mapping your future learning path.',
      'Would you like to continue where you left off?',
      '',
      'Reply to continue, or reply STOP to opt out.',
    ].join('\n');
  }

  if (phase >= 9) {
    return [
      `Hi ${name},`,
      '',
      'Last time we were discussing college recommendations.',
      'Would you like to continue?',
      '',
      'Reply to continue, or reply STOP to opt out.',
    ].join('\n');
  }

  return [
    `Hi ${name},`,
    '',
    'You started a GuideXpert counseling conversation.',
    'Would you like to continue where you left off?',
    '',
    'Reply to continue, or reply STOP to opt out.',
  ].join('\n');
}

/** Template params for Gupshup — keep short; body text also stored on attempt. */
function buildTemplateParams({ lastPhase, studentName } = {}) {
  const name = displayName(studentName);
  const phase = Number(lastPhase) || 1;
  let topic = 'your counseling journey';
  if (phase >= 13) topic = 'booking';
  else if (phase >= 12) topic = 'counseling options';
  else if (phase >= 11) topic = 'your decision';
  else if (phase >= 10) topic = 'your future path';
  else if (phase >= 9) topic = 'college recommendations';
  return [name, topic];
}

/**
 * Admin preview — same body as production generator, plus resolved variable map.
 * Does not change send-path copy.
 */
function previewRecoveryMessage({
  lastPhase,
  studentName,
  examName = null,
  collegeName = null,
  counselingService = null,
} = {}) {
  const message = buildRecoveryMessage({ lastPhase, studentName });
  const params = buildTemplateParams({ lastPhase, studentName });
  return {
    message,
    templateParams: params,
    variables: {
      studentName: displayName(studentName),
      lastPhase: Number(lastPhase) || 1,
      exam: examName || null,
      college: collegeName || null,
      counselingService: counselingService || null,
      topic: params[1] || null,
    },
  };
}

module.exports = {
  buildRecoveryMessage,
  buildTemplateParams,
  previewRecoveryMessage,
  displayName,
};
