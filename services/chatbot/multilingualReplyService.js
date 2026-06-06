/**
 * Phase 3/6: localized strings for Telugu/Hindi IIT users.
 */

const { normalizeLanguageCode } = require('../../constants/languageConstants');

function getLocalizedStrings(leadContext) {
  const langCode = normalizeLanguageCode(
    leadContext?.iit?.preferredLanguage || leadContext?.conversation?.preferredLanguage
  );

  const en = {
    mainMenuGreeting: (ctx) => {
      const name = ctx.iit?.fullName || ctx.gx?.fullName;
      return name ? `Hello ${name}! Welcome to GuideXpert.` : 'Hello! Welcome to GuideXpert.';
    },
  };

  if (langCode === 'te') {
    return {
      mainMenuGreeting: (ctx) => {
        const name = ctx.iit?.fullName || ctx.gx?.fullName;
        return name
          ? `నమస్కారం ${name}! GuideXpert కు స్వాగతం.`
          : 'నమస్కారం! GuideXpert కు స్వాగతం.';
      },
    };
  }

  if (langCode === 'hi') {
    return {
      mainMenuGreeting: (ctx) => {
        const name = ctx.iit?.fullName || ctx.gx?.fullName;
        return name
          ? `नमस्ते ${name}! GuideXpert में आपका स्वागत है।`
          : 'नमस्ते! GuideXpert में आपका स्वागत है।';
      },
    };
  }

  return en;
}

module.exports = { getLocalizedStrings };
