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

const AUTHORITATIVE_LLM_CLAIMS = Object.freeze(['typed', 'button']);

/**
 * The model may claim an authoritative source ONLY when it can prove it: the
 * verbatimQuote must actually appear in the student's message this turn.
 * Unproven claims (and 'extracted'/'counsellor', which the model can never
 * be) are downgraded to 'inferred' — non-authoritative by contract. This is
 * what lets goal/interests advance the beat walk when the student really
 * answered, while closing the source-spoofing hole (a model cannot mint a
 * rank the student never typed).
 */
function verifyClaimedSources(metaByPath = {}, inboundText) {
  if (typeof inboundText !== 'string') return { metaByPath, downgraded: [] };
  const haystack = inboundText.toLowerCase();
  const verified = {};
  const downgraded = [];
  for (const [path, meta] of Object.entries(metaByPath)) {
    if (!meta || typeof meta !== 'object') {
      verified[path] = meta;
      continue;
    }
    const source = String(meta.source || '');
    const quote = String(meta.verbatimQuote || '').trim().toLowerCase();
    const quoteProven = quote.length >= 2 && haystack.includes(quote);
    if (AUTHORITATIVE_LLM_CLAIMS.includes(source) && quoteProven) {
      verified[path] = meta;
      continue;
    }
    if (source === 'inferred') {
      verified[path] = meta;
      continue;
    }
    downgraded.push({ path, claimed: source, reason: quoteProven ? 'source_not_claimable' : 'quote_not_in_message' });
    verified[path] = {
      ...meta,
      source: 'inferred',
      confidence: typeof meta.confidence === 'number' ? meta.confidence : 0.6,
      verbatimQuote: meta.verbatimQuote || inboundText,
    };
  }
  return { metaByPath: verified, downgraded };
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
 * @param {{ phone?: string, casVersion?: number, inboundText?: string, deps?: { casUpdateLeadProfile?: Function, loadLeadProfile?: Function } }} [_ctx]
 */
async function run(args = {}, _ctx = {}) {
  const casUpdate =
    (_ctx.deps && _ctx.deps.casUpdateLeadProfile) || defaultProfileStore.casUpdateLeadProfile;

  // Server context wins over model args: the model was never a reliable
  // carrier for phone or the CAS version (conformance finding G-2 — the
  // version was never exposed, so every faithful write failed).
  const phone = String(_ctx.phone || args.phone || '').trim();
  if (!phone) return { ok: false, error: 'missing_phone' };

  let expectedVersion = args.expectedVersion;
  if (expectedVersion == null || Number.isNaN(Number(expectedVersion))) {
    // Fresh server-side read first (correct even after an earlier write this
    // turn), then the turn-start version from the dispatcher context. The
    // model is never asked to know the version.
    try {
      const load = (_ctx.deps && _ctx.deps.loadLeadProfile) || defaultProfileStore.loadLeadProfile;
      const loaded = await load(phone);
      if (loaded && loaded.casVersion != null) expectedVersion = loaded.casVersion;
    } catch (_) {
      // fall through to the context version below
    }
  }
  if (expectedVersion == null || Number.isNaN(Number(expectedVersion))) {
    expectedVersion = _ctx.casVersion;
  }
  if (expectedVersion == null || Number.isNaN(Number(expectedVersion))) {
    return { ok: false, error: 'missing_expected_version' };
  }

  const profilePatch = args.profilePatch || {};
  const sourceCheck = verifyClaimedSources(args.metaByPath || {}, _ctx.inboundText);
  const metaByPath = sourceCheck.metaByPath;
  if (sourceCheck.downgraded.length) {
    console.warn('[flowV3] LLM_SOURCE_CLAIM_DOWNGRADED', {
      turnId: args.turnId || _ctx.turnId || null,
      downgraded: sourceCheck.downgraded,
    });
  }
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
    expectedVersion: Number(expectedVersion),
    profilePatch,
    metaByPath,
    enforceLlmAllowlist: true,
    turnId: args.turnId || _ctx.turnId || null,
    academicYear: args.academicYear,
    conversationPins: args.conversationPins || null,
  });

  if (!outcome.ok) {
    // Never return the full document to the model: cas_conflict responses
    // leaked the whole profile including casVersion (conformance E-5 note).
    return {
      ok: false,
      reason: outcome.reason,
      rejected: outcome.rejected || [],
      currentVersion: outcome.doc ? outcome.doc.casVersion ?? null : null,
    };
  }

  const inferredNote = buildInferredLimitationNote(
    args.slotMeta || {},
    metaByPath,
    outcome.rejected || []
  );

  return {
    ok: true,
    applied: outcome.applied || Object.keys(profilePatch),
    rejected: outcome.rejected || [],
    casVersion: outcome.doc ? outcome.doc.casVersion : null,
    ...(sourceCheck.downgraded.length ? { sourceDowngraded: sourceCheck.downgraded } : {}),
    ...(inferredNote ? { inferredNote } : {}),
  };
}

module.exports = {
  run,
  buildInferredLimitationNote,
  ROUTING_PREDICTOR_FIELDS,
};
