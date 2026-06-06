'use strict';

const LanguageRequestAnalytics = require('../../models/LanguageRequestAnalytics');
const { normalizeLanguageCode } = require('../../constants/languageConstants');

function todayDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function incrementLanguageRequest({ language, translated = false, now = new Date() } = {}) {
  const code = normalizeLanguageCode(language);
  const date = todayDateKey(now);

  try {
    await LanguageRequestAnalytics.findOneAndUpdate(
      { date, language: code },
      {
        $inc: {
          totalRequests: 1,
          translatedRequests: translated ? 1 : 0,
        },
        $setOnInsert: { date, language: code },
      },
      { upsert: true, new: true }
    );
  } catch (e) {
    console.warn('[analytics] language request increment failed', e.message);
  }
}

module.exports = {
  incrementLanguageRequest,
  todayDateKey,
};
