'use strict';

/**
 * Flow V3 — B5 · CHECKLIST (★ NEW).
 *
 * One bubble, zero taps, no college names. Sets checklistSent=true.
 * Never re-sends when checklistSent is already true (R13 return).
 * Same-turn advance to B6 PERMISSION.
 */

const { mergeFlowV2Profile } = require('../flowV2ProfileMerge');
const { emptyFlowV2Profile } = require('../../../../constants/careerCounsellingFlowV2Profile');
const { withMergedProfile } = require('../flowV2NodeUtils');
const { handleB6PermissionEntry } = require('./b6Permission');

const INTEREST_PHRASE = Object.freeze({
  software: "so you're leaning towards software",
  data_ai: 'so AI and data is where your head is',
  infra_security: 'so cloud and security interests you',
  core: "so you're coming at this from mechanical",
  undecided: "so you're still weighing it up — completely normal at this stage",
});

const PRIORITY_LINE = Object.freeze({
  placements:
    'Since placements matter most to you: ask for the median package and the percentage placed, not the highest package. One student with a ₹40L offer can carry a whole brochure.',
  placement:
    'Since placements matter most to you: ask for the median package and the percentage placed, not the highest package. One student with a ₹40L offer can carry a whole brochure.',
  internships:
    'Since internships matter most to you: ask which companies took interns last year, by name, and how many converted to jobs.',
  internship:
    'Since internships matter most to you: ask which companies took interns last year, by name, and how many converted to jobs.',
  curriculum:
    'Since curriculum matters most to you: ask to see the actual syllabus PDF for year 1. If it takes more than a day to produce, that tells you something.',
  faculty:
    'Since faculty matter most to you: ask how many are PhD-holders versus industry-experienced. You want both, in different subjects.',
  campus:
    'Since campus life matters most to you: ask to visit on a normal working day, not an open day. Ask a second-year student, not a guide.',
  fees:
    'Since fees matter most to you: ask for the full four-year cost — tuition, hostel, exam fees, everything — and get the scholarship criteria in writing before you pay a deposit.',
  affordable:
    'Since fees matter most to you: ask for the full four-year cost — tuition, hostel, exam fees, everything — and get the scholarship criteria in writing before you pay a deposit.',
  location:
    'Since staying close to home matters most to you: check the actual commute at 8am on a weekday, not on Google Maps at midnight.',
  higher_studies:
    "Since you're thinking MS or MBA later: ask what percentage of their grads go on to postgrad, and whether faculty write recommendation letters that carry weight.",
  startup:
    "Since you want to build something: ask whether there's an incubator you can actually access as an undergrad, and how many student companies came out of it last year.",
  entrepreneurship:
    "Since you want to build something: ask whether there's an incubator you can actually access as an undergrad, and how many student companies came out of it last year.",
});

function resolveInterestPhrase(profile) {
  const cluster = profile?.interestCluster || 'undecided';
  if (INTEREST_PHRASE[cluster]) return INTEREST_PHRASE[cluster];
  const branch = String(profile?.branchInterest || '').toLowerCase();
  if (branch.includes('cse') || branch.includes('software') || branch === 'cse_ai' || branch === 'it') {
    return INTEREST_PHRASE.software;
  }
  if (branch.includes('data') || branch.includes('ai')) return INTEREST_PHRASE.data_ai;
  if (['mechanical', 'civil', 'ece', 'eee', 'core'].includes(branch)) return INTEREST_PHRASE.core;
  return INTEREST_PHRASE.undecided;
}

function resolvePriorityLine(profile) {
  const priorities = Array.isArray(profile?.goalPriority) ? profile.goalPriority : [];
  const first = String(priorities[0] || '').toLowerCase().replace(/\s+/g, '_');
  return PRIORITY_LINE[first] || PRIORITY_LINE[priorities[0]] || '';
}

function resolvePriorityPhrase(profile) {
  const priorities = Array.isArray(profile?.goalPriority) ? profile.goalPriority : [];
  if (!priorities.length) return 'finding a solid fit';
  return String(priorities[0]).replace(/_/g, ' ');
}

function buildChecklistBody(profile) {
  const interestPhrase = resolveInterestPhrase(profile);
  const priorityPhrase = resolvePriorityPhrase(profile);
  const priorityLine = resolvePriorityLine(profile);
  const lines = [
    `Got it — ${interestPhrase}, and ${priorityPhrase} is what matters most.`,
    '',
    "Before I get to any college names, here's the part most students skip.",
    '',
    "Whatever college you're looking at — ours, someone else's, or one your relatives recommend — check these seven before you say yes:",
    '',
    '✅ When was the curriculum last updated?',
    '✅ Do students get real internships, or just certificates?',
    '✅ Does coding start in year 1, or year 3?',
    '✅ Are industry tools part of the syllabus, or extra classes you pay for?',
    '✅ What percentage got placed — and at what median salary, not the highest one?',
    '✅ How many faculty have actually worked in the industry?',
    '✅ Is there an alumni network you can reach today?',
  ];
  if (priorityLine) {
    lines.push('', priorityLine);
  }
  lines.push('', "Ask these at every campus visit. They'll tell you more than any brochure.");
  return lines.join('\n');
}

function handleB5ChecklistEntry(ctx) {
  const profile = ctx?.flowV2?.profile || emptyFlowV2Profile();

  // Never re-send checklist once delivered (R13 / return).
  if (profile.checklistSent === true) {
    return handleB6PermissionEntry(withMergedProfile(ctx, profile));
  }

  const merged = mergeFlowV2Profile(profile, { checklistSent: true });
  const body = buildChecklistBody(merged);

  // Same turn: checklist bubble + permission gate.
  const permission = handleB6PermissionEntry(withMergedProfile(ctx, merged));
  return {
    replyText: null,
    replyParts: [body, ...(permission.replyText ? [permission.replyText] : []), ...(permission.replyParts || [])],
    interactive: permission.interactive,
    contextPatch: {
      ...(permission.contextPatch || {}),
      profile: permission.contextPatch?.profile || merged,
    },
    nextState: 'career_counselling_flow_v2',
    intent: 'career_counselling_flow_v2',
  };
}

module.exports = {
  handleB5ChecklistEntry,
  buildChecklistBody,
  resolveInterestPhrase,
  resolvePriorityLine,
};
