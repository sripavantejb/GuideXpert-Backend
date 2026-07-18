'use strict';

/**
 * College Predictor conversation ownership (Section D V2).
 * Sticky journey + follow-ups + OOS detection. Does not change predictor math/API mapping.
 */

const { normalizeText } = require('../intentTextUtils');

const PAGE_SIZE = 5;

const RESTART_RE =
  /^(restart|start over|start again|again|reset|new prediction|new predict)$/i;

const FOLLOWUP_SHOW_MORE_RE =
  /^(show more|more|next|next page|any more|any more colleges|more colleges)\s*[.!?]?$/i;

const FOLLOWUP_TOP_RE =
  /\b(top colleges|top\s*10|top\s*20|best option|better colleges|higher colleges|best colleges)\b/i;

const OWNERSHIP_GOV_RE =
  /\b(government only|govt only|only government|only govt|government colleges|govt colleges)\b/i;
const OWNERSHIP_PRIVATE_RE =
  /\b(private only|only private|private colleges)\b/i;

const BRANCH_FILTER_RULES = [
  { re: /\b(only\s+)?cse\b|\bcomputer science\b|\bcan i get cse\b/i, code: 'CSE', label: 'CSE' },
  { re: /\b(only\s+)?ece\b|\belectronics\b|\bcan i get ece\b/i, code: 'ECE', label: 'ECE' },
  { re: /\b(only\s+)?eee\b|\belectrical\b/i, code: 'EEE', label: 'EEE' },
  { re: /\b(only\s+)?(mech|mechanical)\b/i, code: 'MECH', label: 'Mechanical' },
  { re: /\b(only\s+)?civil\b/i, code: 'CIVIL', label: 'Civil' },
  { re: /\b(only\s+)?(ai|artificial intelligence|aiml|ml)\b/i, code: 'AI', label: 'AI' },
  { re: /\b(only\s+)?it\b|\binformation technology\b/i, code: 'IT', label: 'IT' },
];

/** True OOS — must never be answered inside predictor journey. */
const PREDICTOR_OOS_RE =
  /\b(python|javascript|java code|teach me code|write (a |some )?code|ipl|cricket|who won|movie|bollywood|politics|weather|bitcoin|crypto|amazon|flipkart|shopping|shop on|medical|mbbs|neet ug|recipe|cooking|football|instagram|tiktok|homework math|solve this equation)\b/i;

const DISTRICT_FILTER_RULES = [
  { re: /\b(hyderabad|hyd)\b/i, label: 'Hyderabad', districts: ['Hyderabad', 'Ranga Reddy', 'Medchal'] },
  { re: /\b(warangal)\b/i, label: 'Warangal', districts: ['Warangal'] },
  { re: /\b(vijayawada|bezawada)\b/i, label: 'Vijayawada', districts: ['Krishna', 'NTR'] },
  { re: /\b(visakhapatnam|vizag)\b/i, label: 'Visakhapatnam', districts: ['Visakhapatnam'] },
  { re: /\b(tirupati)\b/i, label: 'Tirupati', districts: ['Tirupati', 'Chittoor'] },
  { re: /\b(guntur)\b/i, label: 'Guntur', districts: ['Guntur'] },
  { re: /\b(kakinada)\b/i, label: 'Kakinada', districts: ['East Godavari', 'Kakinada'] },
  { re: /\b(nellore)\b/i, label: 'Nellore', districts: ['Nellore', 'SPSR Nellore'] },
];

const GIRLS_COLLEGE_RE = /\b(girls?\s+colleges?|only\s+girls|women'?s?\s+colleges?)\b/i;

/**
 * Natural-language College Predictor entry — delegates to scored intent service (1A).
 */
function isCollegePredictorEntryQuery(text, originalText = null) {
  const {
    isCollegePredictorEntryQuery: resolveEntry,
  } = require('./collegePredictorIntentService');
  return resolveEntry(text, originalText);
}

function isPredictorRestartRequest(text, originalText = null) {
  return [normalizeText(text), normalizeText(originalText || '')]
    .filter(Boolean)
    .some((t) => RESTART_RE.test(t));
}

function isPredictorSessionActive(botState) {
  const college = botState?.context?.college || {};
  return (
    botState?.state === 'college_predictor' ||
    Boolean(botState?.context?.collegePredictorActive) ||
    college.flow === 'college_predictor' ||
    botState?.context?.currentJourney === 'COLLEGE_PREDICTOR'
  );
}

function isObviousOutOfPredictorDomain(text, originalText = null) {
  const hay = `${text || ''} ${originalText || ''}`.toLowerCase();
  return PREDICTOR_OOS_RE.test(hay);
}

function resolveBranchFilter(text) {
  const t = String(text || '');
  for (const rule of BRANCH_FILTER_RULES) {
    if (rule.re.test(t)) return { code: rule.code, label: rule.label };
  }
  return null;
}

function resolveOwnershipFilter(text) {
  const t = String(text || '');
  if (OWNERSHIP_GOV_RE.test(t)) return 'government';
  if (OWNERSHIP_PRIVATE_RE.test(t)) return 'private';
  if (/^government\s*[.!?]?$/i.test(t.trim())) return 'government';
  if (/^private\s*[.!?]?$/i.test(t.trim())) return 'private';
  return null;
}

function isShowMoreRequest(text) {
  const t = normalizeText(text);
  return FOLLOWUP_SHOW_MORE_RE.test(t) || /^more\s*[.!?]?$/i.test(t);
}

function isTopCollegesRequest(text) {
  return FOLLOWUP_TOP_RE.test(String(text || ''));
}

function resolveDistrictFilter(text) {
  const t = String(text || '');
  for (const rule of DISTRICT_FILTER_RULES) {
    if (rule.re.test(t)) return { label: rule.label, districts: rule.districts };
  }
  return null;
}

function resolveGirlsFilter(text) {
  return GIRLS_COLLEGE_RE.test(String(text || ''));
}

function resolveNamedCollegeFilter(text, preferredCollege = null) {
  try {
    const { extractPreferredCollege } = require('./collegePredictorIntentService');
    const fromText = extractPreferredCollege(text);
    if (fromText) return fromText;
  } catch (_) {
    /* ignore */
  }
  if (preferredCollege && String(text || '').trim()) {
    // "show cbit" style — preferred already known
    if (new RegExp(String(preferredCollege).replace(/\s+/g, '\\s*'), 'i').test(text)) {
      return preferredCollege;
    }
  }
  return preferredCollege && /^(show|filter|only|check)\b/i.test(String(text || '').trim())
    ? preferredCollege
    : null;
}

function collegeMatchesNamedCollege(college, name) {
  if (!name) return true;
  const n = String(name).toLowerCase();
  const hay = `${college?.college_name || ''} ${college?.college_code || ''}`.toLowerCase();
  return hay.includes(n.toLowerCase()) || new RegExp(n.replace(/\s+/g, '\\s*'), 'i').test(hay);
}

function collegeMatchesDistrict(college, districtFilter) {
  if (!districtFilter?.districts?.length) return true;
  const loc = `${college?.district || ''} ${college?.city || ''} ${college?.college_name || ''}`.toLowerCase();
  return districtFilter.districts.some((d) => loc.includes(String(d).toLowerCase()));
}

function collegeMatchesGirls(college) {
  const n = String(college?.college_name || '');
  return /\b(women|girls|ladies)\b/i.test(n);
}

function isPredictorFollowUpAction(text, collegeCtx = {}) {
  if (!text) return false;
  if (isShowMoreRequest(text)) return true;
  if (isTopCollegesRequest(text)) return true;
  if (resolveBranchFilter(text)) return true;
  if (resolveOwnershipFilter(text)) return true;
  if (resolveGirlsFilter(text)) return true;
  if (resolveDistrictFilter(text)) return true;
  if (resolveNamedCollegeFilter(text, collegeCtx.preferredCollege)) return true;
  if (/\b(lower colleges|higher colleges|any more colleges)\b/i.test(text)) return true;
  if (collegeCtx.step === 'results') {
    if (/^(cse|ece|eee|mechanical|civil|ai|government|private)\s*[.!?]?$/i.test(normalizeText(text))) {
      return true;
    }
  }
  return false;
}

/** Messages that are valid in-flow (slots / greetings / follow-ups) — not OOS. */
function isPredictorInFlowMessage(text, collegeCtx = {}) {
  if (isPredictorRestartRequest(text)) return true;
  if (isNeutralLookingSlotOrFollowUp(text, collegeCtx)) return true;
  if (isPredictorFollowUpAction(text, collegeCtx)) return true;
  return false;
}

function isNeutralLookingSlotOrFollowUp(text, collegeCtx = {}) {
  const t = normalizeText(text);
  if (!t) return true;
  if (isCollegePredictorEntryQuery(t)) return true;
  if (/^(hi|hello|hey|ok|okay|yes|no|thanks|thank you)$/i.test(t)) return true;
  if (/^\d{1,8}$/.test(t)) return true;
  if (/\b(rank|percentile|air)\b/i.test(t)) return true;
  if (
    /\b(jee|eamcet|mht|kcet|general|obc|sc|st|ews|pwd|oc|bc-?[a-d]?|male|female|boy|girl|au|svu|home state|all india)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (collegeCtx.step === 'results' && isPredictorFollowUpAction(text, collegeCtx)) return true;
  return false;
}

function isLikelyGovernmentCollege(name) {
  const n = String(name || '');
  return /\b(iit|nit|iiit|gfti|govt\.?|government|iiests|nsut|dtu|jadavpur|anna university|jntu|university college of engineering)\b/i.test(
    n
  );
}

function collegeMatchesBranch(college, branchCode) {
  if (!branchCode) return true;
  const code = String(branchCode).toUpperCase();
  const branches = Array.isArray(college?.branches) ? college.branches : [];
  const patterns = {
    CSE: /cse|computer|c\.?s\.?e|cs\b/i,
    ECE: /ece|electronics|communication/i,
    EEE: /eee|electrical/i,
    MECH: /mech|mechanical/i,
    CIVIL: /civil/i,
    AI: /\bai\b|artificial|aiml|machine learning|data science/i,
    IT: /\bit\b|information technology/i,
  };
  const re = patterns[code] || new RegExp(code, 'i');
  if (!branches.length) {
    return re.test(String(college?.college_name || ''));
  }
  return branches.some((b) => re.test(`${b.branch_name || ''} ${b.branch_code || ''}`));
}

function filterCollegesLocally(
  colleges,
  {
    ownership = null,
    branchCode = null,
    namedCollege = null,
    districtFilter = null,
    girlsOnly = false,
  } = {}
) {
  let list = Array.isArray(colleges) ? [...colleges] : [];
  if (branchCode) {
    list = list.filter((c) => collegeMatchesBranch(c, branchCode));
  }
  if (ownership === 'government') {
    list = list.filter((c) => isLikelyGovernmentCollege(c.college_name));
  } else if (ownership === 'private') {
    list = list.filter((c) => !isLikelyGovernmentCollege(c.college_name));
  }
  if (namedCollege) {
    list = list.filter((c) => collegeMatchesNamedCollege(c, namedCollege));
  }
  if (districtFilter) {
    list = list.filter((c) => collegeMatchesDistrict(c, districtFilter));
  }
  if (girlsOnly) {
    list = list.filter((c) => collegeMatchesGirls(c));
  }
  return list;
}

function slicePage(colleges, pageOffset = 0, pageSize = PAGE_SIZE) {
  const list = Array.isArray(colleges) ? colleges : [];
  return list.slice(pageOffset, pageOffset + pageSize);
}

module.exports = {
  PAGE_SIZE,
  isCollegePredictorEntryQuery,
  isPredictorRestartRequest,
  isPredictorSessionActive,
  isObviousOutOfPredictorDomain,
  isPredictorFollowUpAction,
  isPredictorInFlowMessage,
  isShowMoreRequest,
  isTopCollegesRequest,
  resolveBranchFilter,
  resolveOwnershipFilter,
  resolveDistrictFilter,
  resolveGirlsFilter,
  resolveNamedCollegeFilter,
  isLikelyGovernmentCollege,
  collegeMatchesBranch,
  collegeMatchesNamedCollege,
  filterCollegesLocally,
  slicePage,
};
