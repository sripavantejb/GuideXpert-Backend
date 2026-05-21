const Bda = require('../models/Bda');
const { assignLeadToBda } = require('./iitCounsellingLeadAssignmentService');
const { BDA_LANGUAGES } = require('../constants/bdaLanguage');
const {
  parseBdaLeadFilterQuery,
  fetchDedupedUnassignedLeadIds: fetchFilteredUnassignedIds,
} = require('./bdaLeadFilterService');

function getLeadPreferredLanguage(sub) {
  const lang = sub?.iitCounselling?.section2Data?.preferredLanguage;
  return typeof lang === 'string' && BDA_LANGUAGES.includes(lang) ? lang : null;
}

async function fetchDedupedUnassignedLeadIds(language = null, filterQuery = {}) {
  const lang = language && BDA_LANGUAGES.includes(language) ? language : null;
  return fetchFilteredUnassignedIds(lang, filterQuery);
}

/** Unassigned leads with no Hindi/Telugu preferredLanguage (Section 2 incomplete or other value). */
async function fetchDedupedUnassignedOtherLanguageIds(filterQuery = {}) {
  const q = { ...filterQuery, hasPreferredLanguage: 'false' };
  return fetchFilteredUnassignedIds(null, q);
}

function emptyLangPreview(language) {
  return {
    language,
    unassignedLeads: 0,
    activeBdas: 0,
    bdas: [],
    perBdaEstimate: 0,
    remainder: 0,
  };
}

async function getAutoAssignPreview(filterQuery = {}) {
  const filtersApplied =
    filterQuery.filtersApplied === 'true' || filterQuery.filtersApplied === '1';

  if (!filtersApplied) {
    const preview = {};
    for (const language of BDA_LANGUAGES) {
      preview[language] = emptyLangPreview(language);
    }
    preview.summary = {
      totalInPool: 0,
      hindiTeluguUnassigned: 0,
      otherOrMissingLanguage: 0,
      filtersApplied: false,
      hasMeetFilter: false,
    };
    return preview;
  }

  const parsed = parseBdaLeadFilterQuery(filterQuery);
  const effectiveQuery = { ...filterQuery, filtersApplied: 'true' };

  const [allLeadIds, otherLeadIds, ...langResults] = await Promise.all([
    fetchDedupedUnassignedLeadIds(null, effectiveQuery),
    fetchDedupedUnassignedOtherLanguageIds(effectiveQuery),
    ...BDA_LANGUAGES.map(async (language) => {
      const [leadIds, bdas] = await Promise.all([
        fetchDedupedUnassignedLeadIds(language, effectiveQuery),
        Bda.find({ status: 'active', language }).sort({ name: 1 }).lean(),
      ]);
      const count = leadIds.length;
      const n = bdas.length;
      return {
        language,
        unassignedLeads: count,
        activeBdas: n,
        bdas: bdas.map((b) => ({ id: String(b._id), name: b.name })),
        perBdaEstimate: n > 0 ? Math.floor(count / n) : 0,
        remainder: n > 0 ? count % n : 0,
      };
    }),
  ]);

  const preview = {};
  for (const row of langResults) {
    preview[row.language] = row;
  }

  const hindiTeluguTotal =
    (preview.Hindi?.unassignedLeads ?? 0) + (preview.Telugu?.unassignedLeads ?? 0);

  preview.summary = {
    totalInPool: allLeadIds.length,
    hindiTeluguUnassigned: hindiTeluguTotal,
    otherOrMissingLanguage: otherLeadIds.length,
    filtersApplied: true,
    hasMeetFilter: Boolean(parsed.meetVariant || parsed.meetFrom || parsed.meetTo || parsed.meetPresence),
  };

  return preview;
}

/**
 * Round-robin assign all unassigned leads for a language across active BDAs with that language.
 */
async function autoAssignUnassignedByLanguage({ language, admin, reason, filterQuery = {} }) {
  if (!BDA_LANGUAGES.includes(language)) {
    return { error: 'Invalid language. Use Hindi or Telugu.', status: 400 };
  }

  const bdas = await Bda.find({ status: 'active', language }).sort({ name: 1 }).lean();
  if (bdas.length === 0) {
    return {
      error: `No active BDAs with language ${language}. Create BDAs and set their language first.`,
      status: 400,
    };
  }

  const leadIds = await fetchDedupedUnassignedLeadIds(language, {
    ...filterQuery,
    filtersApplied: 'true',
  });
  if (leadIds.length === 0) {
    return {
      language,
      totalLeads: 0,
      assigned: 0,
      failed: [],
      byBda: bdas.map((b) => ({
        bdaId: String(b._id),
        bdaName: b.name,
        assigned: 0,
      })),
    };
  }

  const defaultReason =
    typeof reason === 'string' && reason.trim()
      ? reason.trim().slice(0, 500)
      : `Auto-assign ${language} leads (equal split)`;

  const byBdaCounts = new Map(bdas.map((b) => [String(b._id), { bdaId: String(b._id), bdaName: b.name, assigned: 0 }]));
  let assigned = 0;
  const failed = [];

  for (let i = 0; i < leadIds.length; i += 1) {
    const bda = bdas[i % bdas.length];
    const bdaId = bda._id;
    const out = await assignLeadToBda({
      leadId: leadIds[i],
      bdaId,
      admin,
      reason: defaultReason,
      isReassign: false,
    });
    if (out.error) {
      failed.push({ leadId: String(leadIds[i]), message: out.error });
    } else {
      assigned += 1;
      const row = byBdaCounts.get(String(bdaId));
      if (row) row.assigned += 1;
    }
  }

  return {
    language,
    totalLeads: leadIds.length,
    assigned,
    failed,
    byBda: Array.from(byBdaCounts.values()),
  };
}

async function autoAssignAllLanguages({ admin, reason, filterQuery = {} }) {
  const results = {};
  for (const language of BDA_LANGUAGES) {
    results[language] = await autoAssignUnassignedByLanguage({
      language,
      admin,
      reason,
      filterQuery,
    });
  }
  return results;
}

module.exports = {
  BDA_LANGUAGES,
  getLeadPreferredLanguage,
  fetchDedupedUnassignedLeadIds,
  getAutoAssignPreview,
  autoAssignUnassignedByLanguage,
  autoAssignAllLanguages,
};
