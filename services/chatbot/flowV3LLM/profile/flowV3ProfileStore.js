'use strict';

/**
 * Flow V3 — durable profile store (FLOW_V3_LLM_ARCHITECTURE §5.1, §5.3).
 *
 * ONE WRITE PATH. Flow V2 has two profile writers and one of them
 * (processBookingFollowups) bypasses the version lock with a raw `updateOne`,
 * so a concurrent turn can silently lose slots. In V3 every write goes through
 * `applyProfilePatch()`, which is a compare-and-swap on `__v` with bounded
 * retry: read, merge, write only if the version still matches, otherwise re-read
 * and re-merge against the newer document. Merging again on retry (rather than
 * replaying the computed result) is what makes a lost update impossible.
 *
 * Retries are BOUNDED. An unbounded retry loop under contention turns one slow
 * turn into a stampede against the 12s wall budget; after the last attempt the
 * caller gets an error and can fall back deterministically (P-8).
 */

const {
  FLOW_V3_PROFILE_SCHEMA_VERSION,
  emptyFlowV3Profile,
} = require('../../../../constants/flowV3/flowV3LeadProfileSchema');

const { deriveAcademicYear } = require('../../../../constants/flowV3/flowV3SlotMetaContract');
const {
  LLM_WRITE_CHANNEL,
  isAuthoritativeSource,
  isNonAuthoritativeSource,
} = require('../../../../constants/flowV3/flowV3ProfileEnums');

const { mergeFlowV3Profile } = require('./flowV3ProfileMerge');
const { validateProfilePatch } = require('./flowV3ProfileWritePolicy');
const { applySlotMetaUpdates, serializeSlotMetaStore, normalizeSlotMetaStore } = require('./flowV3SlotMeta');

const DEFAULT_MAX_CAS_ATTEMPTS = 3;

class FlowV3CasConflictError extends Error {
  constructor({ phone, attempts, lastVersion }) {
    super(`FlowV3LeadProfile CAS conflict for ${phone} after ${attempts} attempt(s)`);
    this.name = 'FlowV3CasConflictError';
    this.code = 'FLOW_V3_PROFILE_CAS_CONFLICT';
    this.phone = phone;
    this.attempts = attempts;
    this.lastVersion = lastVersion;
  }
}

/** Lazy require so importing this module never registers a model as a side effect. */
function getModel() {
  return require('../../../../models/FlowV3LeadProfile');
}

function nowOr(value) {
  return value instanceof Date ? value : new Date();
}

async function loadProfileDoc(phone) {
  return getModel().findOne({ phone }).lean();
}

/**
 * Read the profile as the pipeline wants it: plain profile object plus a decoded
 * slotMeta store.
 */
async function loadProfile(phone) {
  const doc = await loadProfileDoc(phone);
  if (!doc) return null;
  return {
    phone: doc.phone,
    schemaVersion: doc.schemaVersion,
    profile: doc.profile || {},
    slotMeta: normalizeSlotMetaStore(doc.slotMeta),
    academicYear: doc.academicYear ?? null,
    conversations: doc.conversations || [],
    summary: doc.summary ?? null,
    summaryTurnCount: doc.summaryTurnCount ?? 0,
    version: doc.__v ?? 0,
    createdAt: doc.createdAt ?? null,
    updatedAt: doc.updatedAt ?? null,
  };
}

async function ensureProfileDoc(phone, options = {}) {
  const Model = getModel();
  const existing = await Model.findOne({ phone }).lean();
  if (existing) return existing;

  const now = nowOr(options.now);
  try {
    await Model.create({
      phone,
      schemaVersion: FLOW_V3_PROFILE_SCHEMA_VERSION,
      profile: { ...emptyFlowV3Profile(), phone },
      slotMeta: {},
      academicYear: deriveAcademicYear(now),
      conversations: [],
      summary: null,
      summaryTurnCount: 0,
    });
  } catch (err) {
    // 11000: another turn created it first — the unique phone index is the lock.
    if (!err || err.code !== 11000) throw err;
  }
  return Model.findOne({ phone }).lean();
}

/**
 * Generic bounded-retry CAS runner.
 *
 * @param {string} phone
 * @param {(doc: object, now: Date) => { set: object, result?: object }} mutate
 *        called fresh on every attempt against the latest document
 */
async function withCas(phone, mutate, options = {}) {
  const Model = getModel();
  const maxAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
    ? options.maxAttempts
    : DEFAULT_MAX_CAS_ATTEMPTS;

  let lastVersion = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const now = nowOr(options.now);
    const doc = await ensureProfileDoc(phone, { now });
    const expectedVersion = doc.__v ?? 0;
    lastVersion = expectedVersion;

    const mutation = mutate(doc, now) || {};
    const set = mutation.set || {};
    const result = mutation.result || {};

    if (!Object.keys(set).length) {
      return { ...result, written: false, version: expectedVersion, attempts: attempt };
    }

    const updateResult = await Model.updateOne(
      { _id: doc._id, __v: expectedVersion },
      { $set: set, $inc: { __v: 1 } }
    );

    if (updateResult.modifiedCount === 1) {
      return { ...result, written: true, version: expectedVersion + 1, attempts: attempt };
    }
  }

  throw new FlowV3CasConflictError({ phone, attempts: maxAttempts, lastVersion });
}

/**
 * The single profile write path.
 *
 * Order of operations, and why:
 *   1. write policy (channel allowlist + capture meta) — a rejected key never
 *      reaches the merge, so a blocked field cannot be written and then undone
 *   2. V3 merge (delegates flat legacy slots to the frozen flowV2 merge) +
 *      one-way legacy mirrors
 *   3. slot meta, using profileBefore/profileAfter so a superseded value is
 *      archived with the value it actually held
 *   4. CAS write
 *
 * @param {{
 *   phone: string, patch?: object, meta?: object, channel?: string, turnId?: string,
 *   now?: Date, maxAttempts?: number, requireAllAccepted?: boolean
 * }} input
 */
async function applyProfilePatch(input = {}) {
  const {
    phone,
    patch = {},
    meta = {},
    channel = LLM_WRITE_CHANNEL,
    turnId = null,
    requireAllAccepted = false,
  } = input;

  if (!phone) throw new Error('applyProfilePatch requires a phone');

  const validation = validateProfilePatch({ patch, meta, channel, turnId, now: input.now });
  if (requireAllAccepted && validation.rejected.length) {
    return {
      ok: false,
      written: false,
      rejected: validation.rejected,
      dropped: validation.dropped,
      applied: [],
      profile: null,
      slotMeta: null,
      version: null,
      attempts: 0,
    };
  }

  const casResult = await withCas(
    phone,
    (doc, now) => {
      const profileBefore = doc.profile || {};

      // AUTHORITY DOWNGRADE GUARD (S-1 hardening): a non-authoritative write
      // (source 'inferred' — e.g. an LLM envelope patch or tool call) can
      // NEVER replace a value that was captured from an authoritative source
      // (button / typed / extracted / counsellor). Without this, a
      // hallucinated `examType` could overwrite the student's own
      // "I wrote AP EAMCET" and silently un-arm the AP-OC-male gate.
      const existingMeta = normalizeSlotMetaStore(doc.slotMeta);
      const accepted = { ...validation.accepted };
      const acceptedMeta = { ...validation.acceptedMeta };
      const downgradeRejected = [];
      for (const field of Object.keys(accepted)) {
        const incoming = acceptedMeta[field];
        const current = existingMeta[field];
        const existingValue = profileBefore[field];
        if (
          incoming &&
          isNonAuthoritativeSource(incoming.source) &&
          current &&
          isAuthoritativeSource(current.source) &&
          existingValue !== null &&
          existingValue !== undefined
        ) {
          downgradeRejected.push({
            field,
            code: 'WRITE_AUTHORITY_DOWNGRADE',
            message: `${field} was captured from authoritative source '${current.source}' — an inferred write cannot replace it`,
          });
          delete accepted[field];
          delete acceptedMeta[field];
        }
      }

      const merge = mergeFlowV3Profile(profileBefore, accepted);

      const metaUpdates = {};
      for (const field of merge.applied) {
        if (acceptedMeta[field]) metaUpdates[field] = acceptedMeta[field];
      }
      // Mirrored legacy slots are code-written derivations, not captures: they
      // are recorded with source='system' so a counsellor never sees a joined
      // string presented as the student's own words.
      for (const field of Object.keys(merge.mirrored)) {
        metaUpdates[field] = {
          source: 'system',
          turnId: turnId || `mirror:${now.toISOString()}`,
          setAt: now,
        };
      }

      const metaResult = applySlotMetaUpdates(doc.slotMeta, metaUpdates, {
        turnId,
        now,
        profileBefore,
        profileAfter: merge.profile,
      });

      return {
        set: {
          profile: merge.profile,
          slotMeta: serializeSlotMetaStore(metaResult.slotMeta),
          academicYear: deriveAcademicYear(now),
          schemaVersion: FLOW_V3_PROFILE_SCHEMA_VERSION,
        },
        result: {
          ok:
            validation.rejected.length === 0 &&
            metaResult.rejected.length === 0 &&
            downgradeRejected.length === 0,
          profile: merge.profile,
          slotMeta: metaResult.slotMeta,
          applied: merge.applied,
          mirrored: merge.mirrored,
          droppedByMerge: merge.dropped,
          warnings: merge.warnings,
          rejected: [...validation.rejected, ...downgradeRejected, ...metaResult.rejected],
          dropped: validation.dropped,
        },
      };
    },
    { maxAttempts: input.maxAttempts, now: input.now }
  );

  return casResult;
}

/** Append a conversation to the durable profile (§5.1), deduped by id. */
async function appendConversation(input = {}) {
  const { phone, conversationId, engine = null, promptVersion = null } = input;
  if (!phone) throw new Error('appendConversation requires a phone');
  if (!conversationId) throw new Error('appendConversation requires a conversationId');

  return withCas(
    phone,
    (doc, now) => {
      const conversations = Array.isArray(doc.conversations) ? [...doc.conversations] : [];
      const existing = conversations.find(
        (entry) => String(entry.conversationId) === String(conversationId)
      );
      if (existing) return { set: {}, result: { conversations, added: false } };

      conversations.push({
        conversationId,
        startedAt: input.startedAt instanceof Date ? input.startedAt : now,
        engine,
        promptVersion,
      });
      return { set: { conversations }, result: { conversations, added: true } };
    },
    { maxAttempts: input.maxAttempts, now: input.now }
  );
}

/** Rolling summary write (§9.2 — regenerated every 6 turns, not every turn). */
async function updateRollingSummary(input = {}) {
  const { phone, summary, summaryTurnCount } = input;
  if (!phone) throw new Error('updateRollingSummary requires a phone');

  return withCas(
    phone,
    () => ({
      set: {
        summary: summary ?? null,
        summaryTurnCount: Number.isInteger(summaryTurnCount) ? summaryTurnCount : 0,
      },
      result: { summary: summary ?? null, summaryTurnCount },
    }),
    { maxAttempts: input.maxAttempts, now: input.now }
  );
}

module.exports = {
  DEFAULT_MAX_CAS_ATTEMPTS,
  FlowV3CasConflictError,
  loadProfile,
  loadProfileDoc,
  ensureProfileDoc,
  withCas,
  applyProfilePatch,
  appendConversation,
  updateRollingSummary,
};
