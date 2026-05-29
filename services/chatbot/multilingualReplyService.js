/**
 * Phase 3: localized strings for Telugu/Hindi IIT users.
 */

function getLocalizedStrings(leadContext) {
  const lang = leadContext?.iit?.preferredLanguage || null;

  const en = {
    mainMenuGreeting: (ctx) => {
      const name = ctx.iit?.fullName || ctx.gx?.fullName;
      return name ? `Hello ${name}! Welcome to GuideXpert.` : 'Hello! Welcome to GuideXpert.';
    },
  };

  if (lang === 'Telugu') {
    return {
      mainMenuGreeting: (ctx) => {
        const name = ctx.iit?.fullName || ctx.gx?.fullName;
        return name
          ? `నమస్కారం ${name}! GuideXpert కు స్వాగతం.`
          : 'నమస్కారం! GuideXpert కు స్వాగతం.';
      },
    };
  }

  if (lang === 'Hindi') {
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
