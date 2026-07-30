'use strict';

/**
 * FlowV3LeadProfile — the durable lead profile (FLOW_V3_LLM_ARCHITECTURE §5.1).
 *
 * Fixes G-2: Flow V2 keeps the profile in `WhatsAppBotState.context.flowV2`,
 * which is TTL-swept after 30 minutes, so all 75 slots are destroyed and the
 * bot re-asks everything. This collection is keyed on phone, survives
 * conversations, and HAS NO TTL. That absence is a hard requirement, not an
 * oversight: there is no `stateExpiresAt`, no `expires`, and no
 * `expireAfterSeconds` index anywhere in this file, and a test asserts it.
 *
 * `WhatsAppBotState.context.flowV3` keeps ephemeral per-turn routing only
 * (inboundId, repair state, idempotency keys) and may expire freely.
 * `WhatsAppLeadProfile` is a different, flag-gated collection and is untouched.
 *
 * CONCURRENCY: `__v` is the CAS token. Every write goes through
 * `flowV3ProfileStore.applyProfilePatch()`, which matches on `__v` and
 * increments it, so the two-writer bypass Flow V2 has (processBookingFollowups
 * writing with a raw updateOne) cannot be reproduced here.
 */

const mongoose = require('mongoose');

const {
  FLOW_V3_PROFILE_SCHEMA_VERSION,
  emptyFlowV3Profile,
} = require('../constants/flowV3/flowV3LeadProfileSchema');

const flowV3ConversationSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
    },
    startedAt: { type: Date, default: null },
    engine: { type: String, trim: true, maxlength: 64, default: null },
    promptVersion: { type: String, trim: true, maxlength: 64, default: null },
  },
  { _id: false }
);

const flowV3LeadProfileSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      match: [/^\d{10}$/, 'Phone must be 10 digits'],
    },
    schemaVersion: {
      type: Number,
      required: true,
      default: FLOW_V3_PROFILE_SCHEMA_VERSION,
      min: 1,
    },
    /**
     * The full profile object: the 75 legacy slots plus the V3 extension.
     * Mixed because the schema of record is `constants/flowV3` — restating 167
     * fields here would create a second, drifting definition, and Mongoose
     * casting would silently reshape values the frozen merge relies on.
     */
    profile: {
      type: mongoose.Schema.Types.Mixed,
      default: () => emptyFlowV3Profile(),
    },
    /**
     * slotMeta keyed by field path with dots escaped (see
     * flowV3SlotMetaContract.encodeSlotMetaKey) — `examResults.0.rank` cannot be
     * a raw Map key.
     */
    slotMeta: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: () => new Map(),
    },
    /** Derived admission-cycle year; drives volatile-slot staleness (§5.2). */
    academicYear: {
      type: Number,
      default: null,
    },
    conversations: {
      type: [flowV3ConversationSchema],
      default: () => [],
    },
    /** Rolling LLM conversation summary, regenerated every 6 turns (§9.2). */
    summary: {
      type: String,
      default: null,
    },
    summaryTurnCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    minimize: false,
    // `__v` is used as the compare-and-swap token by flowV3ProfileStore.
    versionKey: '__v',
    optimisticConcurrency: false,
  }
);

flowV3LeadProfileSchema.index({ updatedAt: -1 });
flowV3LeadProfileSchema.index({ 'conversations.conversationId': 1 });

module.exports = mongoose.model('FlowV3LeadProfile', flowV3LeadProfileSchema);
