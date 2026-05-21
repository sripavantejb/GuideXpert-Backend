const mongoose = require('mongoose');
const Bda = require('../models/Bda');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const { IIT_SUB_DEDUP_PHONE_ADD_FIELDS } = require('../utils/iitCounsellingLeadDto');
const { assignLeadToBda } = require('./iitCounsellingLeadAssignmentService');
const { BDA_LANGUAGES } = require('../constants/bdaLanguage');

function getLeadPreferredLanguage(sub) {
  const lang = sub?.iitCounselling?.section2Data?.preferredLanguage;
  return typeof lang === 'string' && BDA_LANGUAGES.includes(lang) ? lang : null;
}

const UNASSIGNED_MATCH = {
  submissionType: 'iitCounselling',
  $or: [{ assignedBdaId: null }, { assignedBdaId: { $exists: false } }],
};

async function fetchDedupedUnassignedLeadIds(language = null) {
  const match = { ...UNASSIGNED_MATCH };
  if (language) {
    if (!BDA_LANGUAGES.includes(language)) return [];
    match['iitCounselling.section2Data.preferredLanguage'] = language;
  }

  const pipeline = [
    { $match: match },
    IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
    { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$phoneKey', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $project: { _id: 1 } },
  ];

  const rows = await IitCounsellingSubmission.aggregate(pipeline);
  return rows.map((r) => r._id).filter(Boolean);
}

/** Unassigned leads with no Hindi/Telugu preferredLanguage (Section 2 incomplete or other value). */
async function fetchDedupedUnassignedOtherLanguageIds() {
  const pipeline = [
    {
      $match: {
        $and: [
          UNASSIGNED_MATCH,
          {
            $or: [
              { 'iitCounselling.section2Data.preferredLanguage': { $exists: false } },
              { 'iitCounselling.section2Data.preferredLanguage': null },
              { 'iitCounselling.section2Data.preferredLanguage': '' },
              { 'iitCounselling.section2Data.preferredLanguage': { $nin: BDA_LANGUAGES } },
            ],
          },
        ],
      },
    },
    IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
    { $sort: { updatedAt: -1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$phoneKey', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $project: { _id: 1 } },
  ];
  const rows = await IitCounsellingSubmission.aggregate(pipeline);
  return rows.map((r) => r._id).filter(Boolean);
}

async function getAutoAssignPreview() {
  const [allLeadIds, otherLeadIds, ...langResults] = await Promise.all([
    fetchDedupedUnassignedLeadIds(),
    fetchDedupedUnassignedOtherLanguageIds(),
    ...BDA_LANGUAGES.map(async (language) => {
      const [leadIds, bdas] = await Promise.all([
        fetchDedupedUnassignedLeadIds(language),
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
  };

  return preview;
}

/**
 * Round-robin assign all unassigned leads for a language across active BDAs with that language.
 */
async function autoAssignUnassignedByLanguage({ language, admin, reason }) {
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

  const leadIds = await fetchDedupedUnassignedLeadIds(language);
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

async function autoAssignAllLanguages({ admin, reason }) {
  const results = {};
  for (const language of BDA_LANGUAGES) {
    results[language] = await autoAssignUnassignedByLanguage({ language, admin, reason });
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
