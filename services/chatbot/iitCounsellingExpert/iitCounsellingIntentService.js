'use strict';

const { isIitCounsellingExpertEnabled } = require('./iitCounsellingFlags');

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const IIT_LEAD_SUPPORT_EXCLUSIONS = [
  /\bmy (session|slot|counselling|counseling|booking|meeting)\b/i,
  /\bassigned expert\b/i,
  /\bmy counsellor\b/i,
  /\bmy counselor\b/i,
  /\bmy bda\b/i,
  /\bmeeting link\b/i,
  /\bwhen is my\b/i,
];

const CPA_SERVICE_EXCLUSIONS = [
  /\bdo you provide\b.*\b(counselling|counseling|iit counselling|iit counseling)\b/i,
  /\bwhat (counselling|counseling) (programs?|services?|packages?)\b/i,
  /\bguidexpert (program|services|fees|benefits)\b/i,
  /\bhow (can i join|do i join)\b/i,
  /\b(program|package) fees\b/i,
];

/** Explicit entry → IIT Expert (Priority 1 over CPA / booking). */
const IIT_COUNSELLING_ENTRY_PATTERNS = [
  /\bi need iit (counselling|counseling)\b/i,
  /\bhelp me with iit (counselling|counseling)\b/i,
  /\b(guide me|guide) (for |with |about )?iit\b/i,
  /\bi want iit admission\b/i,
  /\biit admission\b/i,
  /\bneed iit admission\b/i,
  /\bi cracked jee\b/i,
  /\bi qualified (jee )?advanced\b/i,
  /\bqualified advanced\b/i,
  /\bi wrote (jee )?advanc(ed)?\b/i,
  /\bi wrote jee mains?\b/i,
  /\bcleared jee mains?\b/i,
  /\bcleared (jee )?advanc(ed)?\b/i,
  /\bjosaa help\b/i,
  /\bneed (iit )?counselling\b/i,
  /\bneed (iit )?counseling\b/i,
  /\bneed nit (counselling|counseling|guidance)\b/i,
  /\bcan you guide me\b/i,
  /^iit (counselling|counseling)\s*[.!?]?$/i,
  /\biit (counselling|counseling)\b/i,
  /\bnit (counselling|counseling)\b/i,
  /\bjee advanced\b/i,
  /\bjee mains?\b/i,
  /\bmain result\b/i,
  /\badvanc(ed)? result\b/i,
  /\bchoice filling\b/i,
  /\bseat allotment\b/i,
  /\bseat acceptance\b/i,
];

const IIT_COUNSELLING_EXPERT_PATTERNS = [
  /\bjos+a+a?\b/i,
  /\bcsab\b/i,
  /\bwhat is jos+a+a?\b/i,
  /\bwhat is csab\b/i,
  /\bdifference between iit and nit\b/i,
  /\biit vs nit\b/i,
  /\bwhich iit is best\b/i,
  /\bbranch slid(e|ing)\b/i,
  /\bfreez(e|ing)\b/i,
  /\bfloat(ing)?\b/i,
  /\bopening (and )?closing ranks?\b/i,
  /\bhow many rounds\b/i,
  /\bhome state quota\b/i,
  /\bother state quota\b/i,
  /\bcrl rank\b/i,
  /\bobc-?ncl rank\b/i,
  /\bseat allocation\b/i,
  /\bcounselling round\b/i,
  /\bcounseling round\b/i,
  /\bjosaa kya hai\b/i,
  /\bcsab kya hai\b/i,
  /\brounds kitne\b/i,
  /\bfloat ante enti\b/i,
  /\bslide ante enti\b/i,
  /\bfreeze ante enti\b/i,
  /\bquota enti\b/i,
  /^(rounds?|float|slide|freeze|quota)\s*[.!?]?$/i,
  /\bwhat is float\b/i,
  /\bwhat is slide\b/i,
  /\bwhat is freeze\b/i,
  /\bmock allotments?\b/i,
  /\bchoice locking\b/i,
  /\bchoice filling\b/i,
  /\bseat (acceptance|allotment)\b/i,
  /\bwithdraw(al|ing)?\b/i,
  /\b(documents?|document list)\b.*(josaa|iit|counsell)/i,
  /\bregistration process\b/i,
  /\breporting\b/i,
  // JEE eligibility / reservation / exam structure (Section C)
  /\bage limit\b/i,
  /\bmaximum age\b/i,
  /\battempt limits?\b/i,
  /\b(how many|number of) attempts\b/i,
  /\beligibility\b/i,
  /\bwho can write\b/i,
  /\bcan everyone write\b/i,
  /\bcan i write again\b/i,
  /\bdrop year\b/i,
  /\bgap year\b/i,
  /\breservation( policy)?\b/i,
  /\bfemale quota\b/i,
  /\bgender quota\b/i,
  /\bwhy are there two exams\b/i,
  /\bdifference between (jee )?main and (jee )?advanced\b/i,
  /\bwho conducts jee\b/i,
  /\bwrite advanced without main\b/i,
  /\b(general|obc|sc|st|ews|pwd)\s*(female|girl)\b/i,
  /\b(can i get (iit|nit|iiit)|iiit or nit|better branch|best option)\b/i,
];

/**
 * Short / ambiguous IIT vocabulary — owned by sticky session / cold IIT product path.
 * Used for context expansion + firewall bypass (not allow-list spam: fixed IIT lexicon).
 */
const IIT_IN_SESSION_TOPIC_RE = new RegExp(
  [
    '^(rounds?|round\\s*[1-6]|final round|special round|missed round)\\s*[.!?]?$',
    '^(freeze|float|slide|quota|registration|choice|reporting|medical|hostel|admission)\\s*[.!?]?$',
    '^(documents?|docs|paperwork)\\s*[.!?]?$',
    '^(fees?|fee|saf|payment|payment failed|payment pending|payment successful)\\s*[.!?]?$',
    '^(withdrawal|withdraw|exit counselling|exit counseling|refund( policy)?)\\s*[.!?]?$',
    '^(mock allotments?|mock)\\s*[.!?]?$',
    '^(choice filling|choice locking|seat allotment|seat acceptance)\\s*[.!?]?$',
    '^(air\\s*\\d{2,6}|rank\\s*\\d{2,6}|\\d{3,6}\\s*rank|\\d{4,6})\\s*[.!?]?$',
    '^(general|obc|sc|st|ews|pwd|female|home state|other state|minority)\\s*[.!?]?$',
    '^(general|obc|sc|st|ews|pwd)\\s*(female|girl|woman|women)\\s*[.!?]?$',
    '^(female|girl)\\s*(quota|general|obc|sc|st|ews)?\\s*[.!?]?$',
    '^(exam|main|advanced|nta|marks?|percentile|eligibility|reservation|reservation policy|age limit|maximum age|attempt limits?|attempts?|drop year|gap year|female quota|gender quota)\\s*[.!?]?$',
    '^(why are there two exams|can everyone write|can i write again|who can write)\\??$',
    '^(can i get (iit|nit|iiit)|any better colleges|what about iiit)\\??$',
    '^(income|category|transfer|migration)\\s*certificate\\s*[.!?]?$',
    '^(10th|12th)\\s*memo\\s*[.!?]?$',
    '^(aadhaar|aadhar|passport photo)\\s*[.!?]?$',
    '^who (can participate|is eligible)\\??$',
    '^what institutes participate\\??$',
    '^explain every step\\.?$',
    '^which should i choose\\??$',
    '^how (much is the fee|to pay)\\??$',
    '^can i (pay later|withdraw|join again)\\??$',
    '^can i get iit\\??$',
    '^jee (main|advanced) only\\.?$',
  ].join('|'),
  'i'
);

const CONTEXT_EXPANSIONS = [
  { re: /^rounds?\s*[.!?]?$/i, text: 'How many JoSAA counselling rounds are there?' },
  { re: /^round\s*1\s*[.!?]?$/i, text: 'Explain JoSAA Round 1 counselling' },
  { re: /^round\s*2\s*[.!?]?$/i, text: 'Explain JoSAA Round 2 counselling' },
  { re: /^round\s*3\s*[.!?]?$/i, text: 'Explain JoSAA Round 3 counselling' },
  { re: /^round\s*4\s*[.!?]?$/i, text: 'Explain JoSAA Round 4 counselling' },
  { re: /^round\s*5\s*[.!?]?$/i, text: 'Explain JoSAA Round 5 counselling' },
  { re: /^round\s*6\s*[.!?]?$/i, text: 'Explain JoSAA Round 6 counselling' },
  { re: /^final round\s*[.!?]?$/i, text: 'Explain the JoSAA final counselling round' },
  { re: /^special round\s*[.!?]?$/i, text: 'Explain JoSAA or CSAB special rounds' },
  { re: /^missed round\s*[.!?]?$/i, text: 'What happens if I miss a JoSAA counselling round?' },
  { re: /^freeze\s*[.!?]?$/i, text: 'What does Freeze mean in JoSAA counselling?' },
  { re: /^float\s*[.!?]?$/i, text: 'What does Float mean in JoSAA counselling?' },
  { re: /^slide\s*[.!?]?$/i, text: 'What does Slide mean in JoSAA counselling?' },
  { re: /^documents?\s*[.!?]?$/i, text: 'What documents are required for JoSAA / IIT counselling?' },
  { re: /^docs\s*[.!?]?$/i, text: 'What documents are required for JoSAA / IIT counselling?' },
  { re: /^fees?\s*[.!?]?$/i, text: 'What is the JoSAA seat acceptance fee and how is payment done?' },
  { re: /^saf\s*[.!?]?$/i, text: 'What is the JoSAA seat acceptance fee (SAF)?' },
  { re: /^withdrawal\s*[.!?]?$/i, text: 'How does withdrawal from JoSAA counselling work?' },
  { re: /^withdraw\s*[.!?]?$/i, text: 'How does withdrawal from JoSAA counselling work?' },
  { re: /^refund( policy)?\s*[.!?]?$/i, text: 'What is the JoSAA counselling refund policy?' },
  { re: /^registration\s*[.!?]?$/i, text: 'Explain the JoSAA registration process' },
  { re: /^choice\s*[.!?]?$/i, text: 'Explain JoSAA choice filling' },
  { re: /^choice filling\s*[.!?]?$/i, text: 'Explain JoSAA choice filling' },
  { re: /^choice locking\s*[.!?]?$/i, text: 'Explain JoSAA choice locking' },
  { re: /^seat allotment\s*[.!?]?$/i, text: 'Explain JoSAA seat allotment' },
  { re: /^seat acceptance\s*[.!?]?$/i, text: 'Explain JoSAA seat acceptance process and fee' },
  { re: /^reporting\s*[.!?]?$/i, text: 'Explain JoSAA reporting after seat allotment' },
  { re: /^mock( allotments?)?\s*[.!?]?$/i, text: 'What is JoSAA mock allotment and how does it work?' },
  { re: /^payment( failed|pending|successful)?\s*[.!?]?$/i, text: 'Explain JoSAA seat acceptance payment status and next steps' },
  { re: /^which should i choose\??$/i, text: 'In JoSAA, which should I choose between Freeze, Float, and Slide?' },
  { re: /^general\s*[.!?]?$/i, text: 'How does General category affect JoSAA / IIT counselling seat chances?' },
  { re: /^obc\s*[.!?]?$/i, text: 'How does OBC category affect JoSAA / IIT counselling?' },
  { re: /^sc\s*[.!?]?$/i, text: 'How does SC category affect JoSAA / IIT counselling?' },
  { re: /^st\s*[.!?]?$/i, text: 'How does ST category affect JoSAA / IIT counselling?' },
  { re: /^ews\s*[.!?]?$/i, text: 'How does EWS category affect JoSAA / IIT counselling?' },
  { re: /^pwd\s*[.!?]?$/i, text: 'How does PwD category affect JoSAA / IIT counselling?' },
  { re: /^female\s*[.!?]?$/i, text: 'How does female / gender-based seat allotment work in JoSAA?' },
  {
    re: /^(general|obc|sc|st|ews|pwd)\s*(female|girl)\s*[.!?]?$/i,
    text: 'How does category + female / gender seat quota work in JoSAA counselling?',
  },
  { re: /^home state\s*[.!?]?$/i, text: 'What is home state quota in JoSAA counselling?' },
  { re: /^other state\s*[.!?]?$/i, text: 'What is other state quota in JoSAA counselling?' },
  { re: /^age limit\s*[.!?]?$/i, text: 'What is the age limit / maximum age for JEE Main and JEE Advanced eligibility?' },
  { re: /^attempt limits?\s*[.!?]?$/i, text: 'What is the attempt limit for JEE Main and JEE Advanced?' },
  { re: /^eligibility\s*[.!?]?$/i, text: 'Who is eligible for JEE Main and JEE Advanced?' },
  {
    re: /^reservation( policy)?\s*[.!?]?$/i,
    text: 'Explain the reservation policy for JEE / JoSAA counselling (OBC, SC, ST, EWS, PwD, female).',
  },
  { re: /^female quota\s*[.!?]?$/i, text: 'What is female / gender-based quota in JoSAA / IIT-NIT counselling?' },
  { re: /^why are there two exams\??$/i, text: 'Why are there two exams — JEE Main and JEE Advanced?' },
  { re: /^admission\s*[.!?]?$/i, text: 'Explain IIT / JoSAA admission counselling steps' },
  { re: /^hostel\s*[.!?]?$/i, text: 'What should I know about hostel during IIT counselling / reporting?' },
  { re: /^medical\s*[.!?]?$/i, text: 'What medical documents or checks are needed for JoSAA reporting?' },
  { re: /^(income|category|transfer|migration)\s*certificate\s*[.!?]?$/i, text: 'Which certificates are required for JoSAA document verification?' },
  { re: /^(10th|12th)\s*memo\s*[.!?]?$/i, text: 'Are 10th and 12th marksheets required for JoSAA document verification?' },
  { re: /^(aadhaar|aadhar|passport photo)\s*[.!?]?$/i, text: 'Is Aadhaar and passport photo required for JoSAA document verification?' },
];

function intentTextCandidates(text, originalText) {
  const candidates = [];
  const normalized = normalizeText(text);
  if (normalized) candidates.push(normalized);
  const original = String(originalText || '').trim();
  if (original && normalizeText(original) !== normalized) {
    candidates.push(normalizeText(original));
    candidates.push(original.toLowerCase());
  }
  return candidates;
}

function isExcludedFromIitExpert(text, originalText) {
  const candidates = intentTextCandidates(text, originalText);
  return candidates.some(
    (t) =>
      t &&
      (IIT_LEAD_SUPPORT_EXCLUSIONS.some((p) => p.test(t)) ||
        CPA_SERVICE_EXCLUSIONS.some((p) => p.test(t)))
  );
}

function isIitCounsellingExpertSessionActive(botState) {
  return Boolean(botState?.context?.iitCounsellingExpertActive);
}

function matchesAnyCandidate(text, originalText, patterns) {
  return intentTextCandidates(text, originalText).some(
    (t) => t && patterns.some((pattern) => pattern.test(t))
  );
}

function isIitCounsellingEntryRequest(text, originalText = null) {
  if (!isIitCounsellingExpertEnabled()) return false;
  if (isExcludedFromIitExpert(text, originalText)) return false;
  return matchesAnyCandidate(text, originalText, IIT_COUNSELLING_ENTRY_PATTERNS);
}

function isIitCounsellingInSessionTopic(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => t && IIT_IN_SESSION_TOPIC_RE.test(t));
}

function isIitRankOrCategoryUtterance(text, originalText = null) {
  return intentTextCandidates(text, originalText).some((t) => {
    if (!t) return false;
    if (/^(air\s*)?\d{3,6}$/i.test(t)) return true;
    if (/^air\s*\d{2,6}/i.test(t)) return true;
    if (/^rank\s*\d{2,6}/i.test(t)) return true;
    if (/^\d{3,6}\s*(rank|air)/i.test(t)) return true;
    if (/^(air\s*\d{2,6})\s+(general|obc|sc|st|ews|pwd|female)/i.test(t)) return true;
    if (/^(female\s+)?air\s*\d{2,6}/i.test(t)) return true;
    if (/^(general|obc|sc|st|ews|pwd|female|home state)$/i.test(t)) return true;
    return false;
  });
}

function resolveIitContextExpansion(text, originalText = null) {
  for (const candidate of intentTextCandidates(text, originalText)) {
    if (!candidate) continue;
    for (const row of CONTEXT_EXPANSIONS) {
      if (row.re.test(candidate)) return row.text;
    }
    // Rank forms
    let m = candidate.match(/^air\s*(\d{2,6})$/i);
    if (m) return `AIR ${m[1]} for IIT / JoSAA counselling — what colleges are possible? Ask for category if needed.`;
    m = candidate.match(/^rank\s*(\d{2,6})$/i);
    if (m) return `Rank ${m[1]} for IIT / JoSAA counselling — what are realistic options? Ask for category if needed.`;
    m = candidate.match(/^(\d{3,6})\s*rank$/i);
    if (m) return `Rank ${m[1]} for IIT / JoSAA counselling — what are realistic options? Ask for category if needed.`;
    m = candidate.match(/^(air\s*)?(\d{2,6})\s+(general|obc|sc|st|ews|pwd|female)$/i);
    if (m) return `AIR ${m[2]} ${m[3]} category for IIT / JoSAA counselling guidance`;
    m = candidate.match(/^female\s+air\s*(\d{2,6})$/i);
    if (m) return `Female candidate AIR ${m[1]} for IIT / JoSAA counselling guidance`;
    // Bare 4–5 digit ranks often mean AIR in IIT session
    if (/^\d{4,5}$/.test(candidate)) {
      return `AIR ${candidate} for IIT / JoSAA counselling — ask category if needed before naming colleges`;
    }
  }
  return null;
}

function isIitCounsellingShortFollowUp(text, originalText = null) {
  if (isIitCounsellingInSessionTopic(text, originalText)) return true;
  if (isIitRankOrCategoryUtterance(text, originalText)) return true;
  const candidates = intentTextCandidates(text, originalText);
  return candidates.some((t) => {
    if (!t) return false;
    if (/^(rounds?|float|slide|freeze|quota)\s*[.!?]?$/i.test(t)) return true;
    return /\b(how many rounds|what is float|what is slide|what is freeze|rounds kitne|float ante enti|slide ante enti)\b/i.test(
      t
    );
  });
}

function isIitCounsellingExpertQuestion(text, originalText = null) {
  if (!isIitCounsellingExpertEnabled()) {
    return false;
  }
  if (isExcludedFromIitExpert(text, originalText)) {
    return false;
  }
  if (isIitCounsellingEntryRequest(text, originalText)) return true;
  if (matchesAnyCandidate(text, originalText, IIT_COUNSELLING_EXPERT_PATTERNS)) return true;
  if (isIitCounsellingInSessionTopic(text, originalText)) return true;
  if (isIitRankOrCategoryUtterance(text, originalText)) return true;
  return false;
}

module.exports = {
  isIitCounsellingExpertSessionActive,
  isIitCounsellingExpertQuestion,
  isIitCounsellingShortFollowUp,
  isIitCounsellingEntryRequest,
  isIitCounsellingInSessionTopic,
  isIitRankOrCategoryUtterance,
  resolveIitContextExpansion,
  isExcludedFromIitExpert,
};
