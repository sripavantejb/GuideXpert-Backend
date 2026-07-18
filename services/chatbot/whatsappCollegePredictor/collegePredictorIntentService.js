'use strict';

/**
 * Scored College Predictor entry (1A).
 * Clear college-prediction semantics only — never steals Rank Predictor / bare help / counselling.
 */

const { normalizeText } = require('../intentTextUtils');

const NAMED_COLLEGE_ALIASES = [
  { re: /\b(cbit|chaitanya\s*bharathi)\b/i, name: 'CBIT' },
  { re: /\b(vasavi)\b/i, name: 'Vasavi' },
  { re: /\b(vnr|vnrvjiet)\b/i, name: 'VNR' },
  { re: /\b(griet)\b/i, name: 'GRIET' },
  { re: /\b(cvr)\b/i, name: 'CVR' },
  { re: /\b(mgit)\b/i, name: 'MGIT' },
  { re: /\b(snist|sreenidhi)\b/i, name: 'Sreenidhi' },
  { re: /\b(vjit)\b/i, name: 'VJIT' },
  { re: /\b(jntu|jntuh|jntuk)\b/i, name: 'JNTU' },
  { re: /\b(ou|osmania)\b/i, name: 'Osmania' },
  { re: /\b(iit\s*[a-z]+|nit\s*[a-z]+|iiit\s*[a-z]+)\b/i, name: null },
];

const HARD_NEGATIVE_BARE_HELP_RE =
  /^(guide me|help me|help|counselling help|counseling help|admission guidance|please help|i need help)\s*[.!?]?$/i;

/** Career Counselling owns vague college-choice guidance (1A — do not steal). */
const COUNSELLING_OWNED_RE = [
  /\bhelp me choose (a |my |an )?college\b/i,
  /\bsuggest (a |some )?college\b/i,
  /\bwhich college should i join\b/i,
  /\b(which|what) college (is|would be) (good|best|right|better)\b/i,
  /\bi don't know which college\b/i,
  /\bdon't know which college\b/i,
  /\bhow (do i|to) choose (a |the |my )?college\b/i,
  /\bchoose (the )?right college\b/i,
  /\bneed help choosing\b/i,
  /\bcollege (selection|choosing) help\b/i,
];

const RANK_PREDICTOR_RE =
  /\b(rank\s+predictor|rank\s+prediction|predict(?:ing)?\s+(?:my\s+)?rank|estimate(?:ing)?\s+(?:my\s+)?rank|can you predict(?:\s+my)?\s+rank)\b/i;

const STRONG_ENTRY_EXACT_RE =
  /^(college predictor|college prediction|predict colleges?|predict my colleges?|need college prediction|show colleges|college list|college options|college suggestions?|college recommendation|need colleges|need seat|need admission|i want colleges|good colleges|best colleges|which colleges|my rank|where can i get seat|where should i join|engineering admission|ts eamcet|ap eamcet|eamcet|jee main|jee advanced|kcet|keam|tnea|wbjee|mht cet|mhtcet)\s*[.!?]?$/i;

const STRONG_ENTRY_PHRASE_RE =
  /\b(college predictor|college prediction|predict(?:ing)?\s+(?:my\s+)?colleges?|need college prediction|show colleges|suggest(?:ing)?\s+(?:engineering\s+)?colleges|college suggestions?|college recommendation|recommendation for colleges|suitable colleges|eligible colleges|possible colleges|expected colleges|my college options|admission chances|engineering colleges|best colleges for my rank|top colleges for my rank|which engineering colleges|suggest colleges for my rank|which colleges(?:\s+(?:can|will|should)\s+i\s+get)?|which college(?:s)? (?:can|will|should) i get|can you predict (?:my )?colleges?|i want to know which colleges|help me with (?:eamcet|colleges)|guide me with (?:eamcet|colleges)|college list|need seat|need admission|where can i get (?:a )?seat|where should i join|engineering admission|my rank|ts eamcet|ap eamcet)\b/i;

function hasCollegePredictionSignals(text) {
  const t = String(text || '');
  if (/\b(rank|percentile|predictor|prediction|predict colleges?|eligible colleges|college list|college options)\b/i.test(t)) {
    return true;
  }
  if (/\b(eamcet|jee|kcet|keam|tnea|wbjee|mht\s*cet|mhtcet)\b/i.test(t)) return true;
  if (/\b(can|will) i get\b/i.test(t)) return true;
  if (/\b\d{3,7}\b/.test(t)) return true;
  return false;
}

const BRANCH_GET_RE =
  /\b(?:can i get|will i get|want|need)\s+(cse|ece|eee|mechanical|civil|ai|aiml|it|government colleges|private colleges|govt colleges)\b/i;

const TYPO_NORMALIZE = [
  [/eamset|eamct|eamcetr|eamcet\s*rank/gi, 'eamcet'],
  [/colage|collage|clg/gi, 'college'],
  [/predction|prediciton|predicton/gi, 'prediction'],
  [/admisson|admision/gi, 'admission'],
  [/enginering|engeneering/gi, 'engineering'],
];

function candidates(text, originalText) {
  const raw = [String(text || '').trim(), String(originalText || '').trim()].filter(Boolean);
  const out = [];
  for (const r of raw) {
    let n = normalizeText(r);
    for (const [re, rep] of TYPO_NORMALIZE) {
      n = n.replace(re, rep);
    }
    if (n) out.push(n);
    // Also keep lightly normalized original for romanized cues
    const soft = String(r)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (soft && soft !== n) out.push(soft);
  }
  return [...new Set(out)];
}

function extractPreferredCollege(text) {
  const t = String(text || '');
  for (const alias of NAMED_COLLEGE_ALIASES) {
    if (alias.re.test(t)) {
      const match = t.match(alias.re);
      return alias.name || (match ? match[0] : null);
    }
  }
  return null;
}

function isNamedCollegeAdmissionQuery(text) {
  const t = String(text || '');
  if (!/\b(can i get|will i get|chance|admission|seat|join)\b/i.test(t)) return false;
  return Boolean(extractPreferredCollege(t));
}

function isHardNegative(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (RANK_PREDICTOR_RE.test(t)) return true;
  if (HARD_NEGATIVE_BARE_HELP_RE.test(t)) return true;
  // Bare counselling without college outcome
  if (
    /^(counselling help|counseling help|i need counselling|i need counseling|admission guidance)\s*[.!?]?$/i.test(
      t
    )
  ) {
    return true;
  }
  // Vague college-choice guidance → Career Counselling (unless prediction signals present)
  if (COUNSELLING_OWNED_RE.some((re) => re.test(t)) && !hasCollegePredictionSignals(t)) {
    return true;
  }
  return false;
}

function isBlockedByOtherJourney(botState) {
  if (!botState) return false;
  const state = botState.state;
  if (
    state === 'rank_predictor' ||
    state === 'career_counselling_v2' ||
    state === 'iit_counselling_expert' ||
    state === 'iit_counselling_strategy'
  ) {
    return true;
  }
  const ctx = botState.context || {};
  if (ctx.iitCounsellingExpertActive || ctx.iitCounsellingStrategyActive) return true;
  if (ctx.counsellorProgramAssistantActive) return true;
  if (ctx.currentJourney === 'CAREER_COUNSELLING' || ctx.currentJourney === 'RANK_PREDICTOR') {
    return true;
  }
  return false;
}

/**
 * @returns {{
 *   enter: boolean,
 *   confidence: 'high'|'medium'|'low',
 *   reason: string|null,
 *   preferredCollege: string|null,
 *   score: number
 * }}
 */
function resolveCollegePredictorEntry({
  englishText = '',
  originalText = '',
  botState = null,
} = {}) {
  if (isBlockedByOtherJourney(botState)) {
    return { enter: false, confidence: 'low', reason: 'other_journey_active', preferredCollege: null, score: 0 };
  }

  const list = candidates(englishText, originalText);
  if (!list.length) {
    return { enter: false, confidence: 'low', reason: null, preferredCollege: null, score: 0 };
  }

  for (const t of list) {
    if (isHardNegative(t)) {
      const counsellingOwned =
        COUNSELLING_OWNED_RE.some((re) => re.test(t)) && !hasCollegePredictionSignals(t);
      return {
        enter: false,
        confidence: 'high',
        reason: RANK_PREDICTOR_RE.test(t)
          ? 'rank_predictor_negative'
          : counsellingOwned
            ? 'counselling_owned'
            : 'bare_help_negative',
        preferredCollege: null,
        score: 0,
      };
    }
  }

  let best = { enter: false, confidence: 'low', reason: null, preferredCollege: null, score: 0 };

  for (const t of list) {
    const preferredCollege = extractPreferredCollege(t);

    if (STRONG_ENTRY_EXACT_RE.test(t)) {
      return {
        enter: true,
        confidence: 'high',
        reason: 'college_predictor_exact',
        preferredCollege,
        score: 100,
      };
    }

    if (STRONG_ENTRY_PHRASE_RE.test(t) || BRANCH_GET_RE.test(t)) {
      if (best.score < 90) {
        best = {
          enter: true,
          confidence: 'high',
          reason: 'college_predictor_phrase',
          preferredCollege,
          score: 90,
        };
      }
      continue;
    }

    if (isNamedCollegeAdmissionQuery(t)) {
      if (best.score < 85) {
        best = {
          enter: true,
          confidence: 'high',
          reason: 'named_college_admission',
          preferredCollege: preferredCollege || extractPreferredCollege(t),
          score: 85,
        };
      }
      continue;
    }

  // Soft college outcome — plural / list phrasing only (singular "suggest a college" → counselling)
  if (/^(want|need|show|suggest|predict)\s+(colleges|college list|college options|engineering colleges)\b/i.test(t)) {
    if (best.score < 88) {
      best = {
        enter: true,
        confidence: 'high',
        reason: 'college_outcome_verb',
        preferredCollege,
        score: 88,
      };
    }
  }

    // Soft: help/guide with exam or plural colleges (not vague "choose a college")
    if (
      /\b(help me with|guide me with|need)\b/i.test(t) &&
      /\b(eamcet|colleges|engineering colleges)\b/i.test(t) &&
      !HARD_NEGATIVE_BARE_HELP_RE.test(t) &&
      !COUNSELLING_OWNED_RE.some((re) => re.test(t))
    ) {
      if (best.score < 75) {
        best = {
          enter: true,
          confidence: 'high',
          reason: 'help_with_exam_or_colleges',
          preferredCollege,
          score: 75,
        };
      }
    }

    // Typo exam + college outcome — require exam/typo cue, not bare "college"
    if (
      /\b(eamcet|eamset|eamct|jee|kcet|keam|tnea|wbjee|mht|percentile|colage|collage|clg)\b/i.test(t) &&
      /\b(college|colleges|colage|collage|clg|predict|suggest|list|options|admission|seat)\b/i.test(t)
    ) {
      if (best.score < 72) {
        best = {
          enter: true,
          confidence: 'high',
          reason: 'exam_college_outcome',
          preferredCollege,
          score: 72,
        };
      }
    }

    // Bare "I got NNNNN" / "secured N" with large rank-like number → college predictor (rank-only style)
    if (/\b(i\s+got|secured|scored)\s+\d{3,7}\b/i.test(t) && !/\b(marks|percentile|score|percent)\b/i.test(t)) {
      if (best.score < 68) {
        best = {
          enter: true,
          confidence: 'medium',
          reason: 'got_rank_number',
          preferredCollege,
          score: 68,
        };
      }
    }

    // Romanized / mixed cues with college outcome
    if (
      /\b(na rank|eamcet lo|colleges kavali|college kavali|seat vastunda)\b/i.test(t) &&
      /\b(college|colleges|seat|eamcet|rank)\b/i.test(t)
    ) {
      if (best.score < 70) {
        best = {
          enter: true,
          confidence: 'medium',
          reason: 'romanized_college_outcome',
          preferredCollege,
          score: 70,
        };
      }
    }
  }

  return best;
}

function isCollegePredictorEntryQuery(text, originalText = null) {
  return resolveCollegePredictorEntry({
    englishText: text,
    originalText,
  }).enter;
}

function isHighConfidenceCollegePredictorEntry(text, originalText = null, botState = null) {
  const r = resolveCollegePredictorEntry({
    englishText: text,
    originalText,
    botState,
  });
  return r.enter && (r.confidence === 'high' || r.score >= 75);
}

module.exports = {
  resolveCollegePredictorEntry,
  isCollegePredictorEntryQuery,
  isHighConfidenceCollegePredictorEntry,
  extractPreferredCollege,
  isNamedCollegeAdmissionQuery,
  isHardNegative,
  NAMED_COLLEGE_ALIASES,
};
