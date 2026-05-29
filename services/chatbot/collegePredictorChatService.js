const { normalizeText } = require('./intentClassifierService');

/**
 * Phase 2: slot-filling for college predictor. Phase 1 returns guidance message.
 */
function handleCollegePredictorMessage(text, context = {}) {
  const t = normalizeText(text);

  if (context.step === 'awaiting_rank' && !Number.isNaN(Number(t))) {
    return {
      reply:
        'College predictor needs exam, rank, and category via our website for full results.\n\nVisit the College Predictor on GuideXpert and enter your details, or reply MENU.',
      context: { step: 'done' },
    };
  }

  const rankMatch = t.match(/\brank\s*(\d+)/i) || t.match(/^(\d{3,6})$/);
  if (rankMatch) {
    return {
      reply:
        `For rank ${rankMatch[1]}, use our College Predictor tool on the website with your exam and category for accurate college lists.\n\nReply MENU for other options.`,
      context: { step: 'done' },
    };
  }

  return {
    reply:
      'College predictor works best on our website with your exam, rank, and reservation category.\n\nSend "rank 15000" for a short note, or reply MENU.',
    context: { step: 'awaiting_rank' },
  };
}

module.exports = { handleCollegePredictorMessage };
