'use strict';

const {
  getPhase10Message,
  GUARANTEE_FORBIDDEN,
} = require('../../../constants/careerCounsellingV2FuturePathVision');

function pickBestMatch(profile = {}) {
  const list = Array.isArray(profile.phase9Recommendations)
    ? profile.phase9Recommendations
    : [];
  const best = list.find((r) => r.rankLabel === 'Best Match') || list[0];
  if (best?.collegeName) return best.collegeName;

  const recommended = Array.isArray(profile.recommendedColleges)
    ? profile.recommendedColleges
    : [];
  const tierBest = recommended.find((c) => c.tier === 'best_match');
  return tierBest?.collegeName || null;
}

function learningCue(profile = {}) {
  const style = profile.learningStyle || profile.identifiedLearningStyle || null;
  const prefs = Array.isArray(profile.learningPreferences)
    ? profile.learningPreferences
    : [];
  const raw = String(profile.learningPreferenceText || prefs.join(' ') || style || '').toLowerCase();

  if (/project|hands-?on|practical|build|internship/.test(raw)) {
    return 'hands-on projects and practice';
  }
  if (/mentor|guidance|coach/.test(raw)) {
    return 'guided mentoring and structured practice';
  }
  if (/industry|intern/.test(raw)) {
    return 'industry-linked practice where available';
  }
  if (style) return String(style).slice(0, 60);
  if (prefs[0]) return String(prefs[0]).slice(0, 60);
  return null;
}

function interestCue(profile = {}) {
  const bits = [];
  if (profile.careerPriority) bits.push(String(profile.careerPriority).slice(0, 50));
  if (Array.isArray(profile.studentPriorities) && profile.studentPriorities[0]) {
    bits.push(String(profile.studentPriorities[0]).slice(0, 40));
  }
  if (Array.isArray(profile.evaluationPriorities) && profile.evaluationPriorities[0]) {
    bits.push(String(profile.evaluationPriorities[0]).slice(0, 40));
  }
  return bits[0] || null;
}

function assertNoGuarantees(text) {
  const t = String(text || '');
  for (const re of GUARANTEE_FORBIDDEN) {
    if (re.test(t)) {
      throw new Error(`Phase 10 guardrail violation: ${re}`);
    }
  }
  return t;
}

/**
 * Build 2–3 short WhatsApp-style vision blocks (joined with blank lines).
 */
function synthesizeFuturePathVision(profile = {}) {
  const bestMatch = pickBestMatch(profile);
  const course = profile.preferredCourse ? String(profile.preferredCourse).slice(0, 80) : null;
  const goal = profile.careerGoal
    ? String(profile.careerGoal).slice(0, 80)
    : profile.careerPriority
      ? String(profile.careerPriority).slice(0, 80)
      : null;
  const learning = learningCue(profile);
  const interest = interestCue(profile);

  const hasSignal = Boolean(bestMatch || course || goal || learning || interest);
  if (!hasSignal) {
    const reply = getPhase10Message('empty_profile');
    assertNoGuarantees(reply);
    return {
      bestMatch: null,
      bubbles: reply.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean),
      reply,
      personalized: false,
    };
  }

  const bubbles = [];

  // Bubble 1 — path anchor / confidence (no re-list of colleges)
  if (bestMatch && (course || goal)) {
    bubbles.push(
      [
        `On the path toward *${bestMatch}*, your direction already fits what you’ve shared`,
        course ? ` (${course})` : '',
        goal ? ` and where you want to go (${goal})` : '',
        '.',
      ].join('')
    );
  } else if (bestMatch) {
    bubbles.push(
      `On the path toward *${bestMatch}*, you already have a clearer direction from counseling so far.`
    );
  } else if (course || goal) {
    bubbles.push(
      [
        'Your counseling path already lines up with',
        course ? ` ${course}` : '',
        goal ? `${course ? ' and' : ''} ${goal}` : '',
        '.',
      ].join('')
    );
  } else {
    bubbles.push('You’ve already narrowed a direction — next is picturing how learning could unfold.');
  }

  // Bubble 2 — future learning possibilities
  let learnMsg = learning
    ? `Early on, you could lean into ${learning}`
    : 'Early on, you could build fundamentals step by step';
  if (interest) {
    learnMsg += `, with room to explore ${interest}`;
  }
  learnMsg +=
    '. Over time, projects and practice can help you test what fits — possibilities, not promises.';
  bubbles.push(learnMsg);

  // Bubble 3 — continue only (no CTA)
  bubbles.push(getPhase10Message('ask_continue'));

  const reply = bubbles.slice(0, 3).join('\n\n');
  assertNoGuarantees(reply);

  // Soft bans on sales language
  if (/\bcounsellor\b|\bcounselor\b|\bbook(ing)?\b|\bwhatsapp\b/i.test(reply)) {
    throw new Error('Phase 10 guardrail: counseling/booking language leaked');
  }

  return {
    bestMatch,
    bubbles: bubbles.slice(0, 3),
    reply,
    personalized: true,
  };
}

module.exports = {
  pickBestMatch,
  learningCue,
  interestCue,
  assertNoGuarantees,
  synthesizeFuturePathVision,
};
