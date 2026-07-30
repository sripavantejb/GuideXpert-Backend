'use strict';

const { canLlmWriteField } = require('../../../../constants/flowV3/flowV3LeadProfileSchema');
const { isNonAuthoritativeSource } = require('../../../../constants/flowV3/flowV3ProfileEnums');
const defaultProfileStore = require('../profile');

const ROUTING_PREDICTOR_FIELDS = Object.freeze([
  'examType',
  'rank',
  'percentile',
  'category',
  'gender',
  'quota',
  'region',
  'admissionType',
]);

/**
 * Document fields that remain inferred-only after patch — cannot satisfy routing/predictor gates.
 */
function buildInferredLimitationNote(existingSlotMeta = {}, metaByPath = {}, rejected = []) {
  const touched = new Set([
    ...Object.keys(metaByPath || {}),
    ...Object.keys(existingSlotMeta || {}),
  ]);
  const inferredRouting = ROUTING_PREDICTOR_FIELDS.filter((field) => {
    if (!touched.has(field)) return false;
    const meta = (metaByPath && metaByPath[field]) || existingSlotMeta[field];
    return meta && isNonAuthoritativeSource(meta.source);
  });
  if (!inferredRouting.length) return null;
  return {
    inferredCannotSatisfy: {
      routing: inferredRouting,
      predictor: inferredRouting,
    },
    message:
      'Inferred slot meta cannot satisfy routing or predictor gates until replaced with button/typed/extracted/counsellor source.',
  };
}

/**
 * M-1 profile CAS update — enforce LLM write allowlist + slot meta contract.
 * @param {{
 *   phone?: string,
 *   expectedVersion?: number,
 *   profilePatch?: object,
 *   metaByPath?: object,
 *   turnId?: string,
 *   academicYear?: number|null,
 *   conversationPins?: object,
 *   slotMeta?: object,
 * }} args
 * @param {{ deps?: { casUpdateLeadProfile?: Function } }} [_ctx]
 */
async function run(args = {}, _ctx = {}) {
  const casUpdate =
    (_ctx.deps && _ctx.deps.casUpdateLeadProfile) || defaultProfileStore.casUpdateLeadProfile;

  const phone = String(args.phone || '').trim();
  if (!phone) return { ok: false, error: 'missing_phone' };
  if (args.expectedVersion == null || Number.isNaN(Number(args.expectedVersion))) {
    return { ok: false, error: 'missing_expected_version' };
  }

  const profilePatch = args.profilePatch || {};
  const metaByPath = args.metaByPath || {};
  const preflightRejected = [];

  for (const path of Object.keys(profilePatch)) {
    const gate = canLlmWriteField(path);
    if (!gate.allowed) {
      preflightRejected.push({ path, reason: gate.reason || 'not_allowed' });
    }
  }

  if (preflightRejected.length > 0) {
    return {
      ok: false,
      error: 'write_denied',
      rejected: preflightRejected,
      inferredNote: buildInferredLimitationNote(args.slotMeta || {}, metaByPath, preflightRejected),
    };
  }

  const outcome = await casUpdate({
    phone,
    expectedVersion: Number(args.expectedVersion),
    profilePatch,
    metaByPath,
    enforceLlmAllowlist: true,
    turnId: args.turnId || _ctx.turnId || null,
    academicYear: args.academicYear,
    conversationPins: args.conversationPins || null,
  });

  if (!outcome.ok) {
    return {
      ok: false,
      reason: outcome.reason,
      rejected: outcome.rejected || [],
      doc: outcome.doc || null,
    };
  }

  const inferredNote = buildInferredLimitationNote(
    args.slotMeta || {},
    metaByPath,
    outcome.rejected || []
  );

  return {
    ok: true,
    doc: outcome.doc,
    rejected: outcome.rejected || [],
    casVersion: outcome.doc ? outcome.doc.casVersion : null,
    ...(inferredNote ? { inferredNote } : {}),
  };
}

module.exports = {
  run,
  buildInferredLimitationNote,
  ROUTING_PREDICTOR_FIELDS,
};
