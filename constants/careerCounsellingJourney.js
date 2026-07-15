'use strict';

/**
 * AI Career Counselling Journey — configuration-driven phases and copy.
 * Add new phases/sections here; the engine reads this config at runtime.
 */

const FLOW_ID = 'career_counselling_journey';

const MESSAGES = Object.freeze({
  welcome: [
    "I'm glad you're thinking carefully about this — choosing a college is one of the most important decisions you'll make.",
    '',
    'Instead of naming a college right away, I would first like to explain how experienced counsellors evaluate colleges properly.',
    '',
    'That way, you can judge any option with confidence.',
  ].join('\n'),

  checkpoint_after_welcome:
    'Before we go further — does it help to look at college choice this way?',

  common_mistakes: [
    'Many students regret their choice later. Common reasons include:',
    '',
    '• Choosing because friends are joining',
    '• Picking a college only for brand name or rankings',
    '• Going to whatever is nearby',
    '• Deciding based on advertisements alone',
    '',
    'These shortcuts rarely tell you whether a college will actually prepare you for your career.',
  ].join('\n'),

  checkpoint_after_mistakes:
    'Have you noticed any of these patterns around you — among friends or family?',

  evaluation: [
    'A college worth joining is usually evaluated on:',
    '',
    '• Curriculum relevance to today\'s industry',
    '• Practical and project-based learning',
    '• Industry exposure and internships',
    '• Placement preparation — not just placement claims',
    '• Career mentoring and guidance',
    '• Real projects you build',
    '• Faculty quality and teaching approach',
    '• A learning environment that helps you grow',
    '',
    'These factors matter more than hype or peer pressure.',
  ].join('\n'),

  checkpoint_after_evaluation:
    'Which of these factors feels most important for your future?',

  modern_colleges: [
    'You may also hear about modern or "new-age" colleges.',
    '',
    'Many focus on industry-aligned curriculum, project-based learning, emerging technologies like AI, career mentoring, and practical exposure.',
    '',
    'This does not mean traditional colleges are always wrong, or modern ones are always better.',
    '',
    'What matters is whether a college\'s approach fits your goals and learning needs.',
  ].join('\n'),

  checkpoint_after_modern:
    'Does this help you see the difference between hype and a genuinely practical learning approach?',

  permission: [
    'I can now suggest some modern colleges that match these qualities.',
    '',
    'Would you like me to suggest them?',
  ].join('\n'),

  phase1_transition:
    "Great! Now that we've covered how to evaluate colleges, let's explore some colleges that match these qualities.",

  permission_no: [
    'No problem at all.',
    '',
    'Take your time. Whenever you feel ready, just say yes and we can explore colleges that fit these qualities.',
  ].join('\n'),

  permission_clarify:
    'Would you like me to suggest some modern colleges that match the qualities we discussed?\n\nReply Yes or No.',

  awaiting_ack_nudge:
    'Take your time. Reply when you are ready to continue, or ask me anything about choosing a college.',

  resume_checkpoint_prefix: 'Coming back to where we were —',

  phase2_hold:
    'We will explore matching colleges in the next part of this journey. For now, you have a solid framework to evaluate any college you consider.',

  phase1_declined_reengage:
    'Whenever you are ready to explore colleges that match these qualities, just say yes.',
});

/** Pattern-matched brief answers for in-journey counselling questions (no brand names). */
const COUNSELLING_QA = Object.freeze([
  {
    patterns: [/\bplacement(s)?\b/i, /\bjob(s)? after college\b/i],
    answer:
      'Placements depend on many factors — curriculum quality, projects, internships, and interview preparation. Look at how a college trains students, not just the final placement brochure.',
  },
  {
    patterns: [/\bcurriculum\b/i, /\bsyllabus\b/i],
    answer:
      'A strong curriculum stays updated with industry needs, includes hands-on projects, and connects theory to real applications — not just exam-oriented chapters.',
  },
  {
    patterns: [/\binternship(s)?\b/i],
    answer:
      'Internships matter because they show you how workplaces actually function. Colleges that integrate internships early usually produce more confident graduates.',
  },
  {
    patterns: [/\bbranch\b/i, /\bcse\b/i, /\bece\b/i, /\bwhich course\b/i],
    answer:
      'Branch choice should match your interests and career direction. A college that supports practical learning in your chosen branch often matters more than the branch name alone.',
  },
  {
    patterns: [/\branking(s)?\b/i, /\bnirf\b/i, /\btier\b/i],
    answer:
      'Rankings can be a starting point, but they rarely show teaching quality, project exposure, or mentoring. Use rankings as one input — not the only one.',
  },
  {
    patterns: [/\bfriend(s)?\b/i, /\bpeer pressure\b/i],
    answer:
      'Friends can influence your choice, but your career path is personal. What suits someone else may not suit your goals or learning style.',
  },
]);

const GENERIC_COUNSELLING_FALLBACK =
  'That is a thoughtful question. The key is to look at whether a college genuinely prepares you — through curriculum, projects, exposure, and mentoring — rather than marketing claims alone.';

const BREAKOUT_DEFLECTION = [
  'I can help with that separately.',
  '',
  'For now, let me finish walking you through how to evaluate colleges — it will make any later recommendation much more meaningful.',
  '',
  'Reply when you are ready to continue.',
].join('\n');

/**
 * Journey topology — add Phase 2+ sections here without changing engine logic.
 *
 * Section types:
 *   - section: content + checkpoint, advance on acknowledgment
 *   - permission: yes/no gate; yes advances to nextPhase/nextStep
 *   - hold: terminal placeholder until next phase is implemented
 */
const JOURNEY_PHASES = Object.freeze([
  Object.freeze({
    id: 1,
    sections: Object.freeze([
      Object.freeze({
        step: 'welcome',
        type: 'section',
        contentKey: 'welcome',
        checkpointKey: 'checkpoint_after_welcome',
        next: Object.freeze({ phase: 1, step: 'common_mistakes' }),
      }),
      Object.freeze({
        step: 'common_mistakes',
        type: 'section',
        contentKey: 'common_mistakes',
        checkpointKey: 'checkpoint_after_mistakes',
        next: Object.freeze({ phase: 1, step: 'evaluation' }),
      }),
      Object.freeze({
        step: 'evaluation',
        type: 'section',
        contentKey: 'evaluation',
        checkpointKey: 'checkpoint_after_evaluation',
        next: Object.freeze({ phase: 1, step: 'modern_colleges' }),
      }),
      Object.freeze({
        step: 'modern_colleges',
        type: 'section',
        contentKey: 'modern_colleges',
        checkpointKey: 'checkpoint_after_modern',
        next: Object.freeze({ phase: 1, step: 'phase1_permission' }),
      }),
      Object.freeze({
        step: 'phase1_permission',
        type: 'permission',
        contentKey: 'permission',
        yesNext: Object.freeze({ phase: 2, step: 'phase2_ready' }),
        yesReplyKey: 'phase1_transition',
        noNext: Object.freeze({ phase: 1, step: 'phase1_declined' }),
        noReplyKey: 'permission_no',
        clarifyKey: 'permission_clarify',
      }),
      Object.freeze({
        step: 'phase1_declined',
        type: 'hold',
        contentKey: 'permission_no',
        reengageKey: 'phase1_declined_reengage',
      }),
    ]),
  }),
  Object.freeze({
    id: 2,
    sections: Object.freeze([
      Object.freeze({
        step: 'phase2_ready',
        type: 'hold',
        contentKey: 'phase2_hold',
      }),
    ]),
  }),
]);

function isCareerCounsellingJourneyEnabled() {
  const raw = String(process.env.CHATBOT_CAREER_COUNSELLING_JOURNEY_ENABLED ?? '1').trim();
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

function getMessage(key) {
  return MESSAGES[key] || '';
}

function getPhaseConfig(phaseId) {
  return JOURNEY_PHASES.find((p) => p.id === Number(phaseId)) || null;
}

function getSectionConfig(phaseId, stepId) {
  const phase = getPhaseConfig(phaseId);
  if (!phase) return null;
  return phase.sections.find((s) => s.step === stepId) || null;
}

function getFirstSection(phaseId = 1) {
  const phase = getPhaseConfig(phaseId);
  return phase?.sections?.[0] || null;
}

module.exports = {
  FLOW_ID,
  MESSAGES,
  COUNSELLING_QA,
  GENERIC_COUNSELLING_FALLBACK,
  BREAKOUT_DEFLECTION,
  JOURNEY_PHASES,
  isCareerCounsellingJourneyEnabled,
  getMessage,
  getPhaseConfig,
  getSectionConfig,
  getFirstSection,
};
