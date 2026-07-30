'use strict';

/**
 * FlowV3TurnLog — one document per turn (FLOW_V3_LLM_ARCHITECTURE §9.3).
 *
 * This is the eval store, and it is what makes P-9 (one turn = one replayable
 * unit) real: profileBefore + slotPatch + the exact prompt version, model,
 * llmCalls and toolCalls are everything needed to re-run a historical turn
 * against a new prompt offline.
 *
 * PHONE IS STORED HASHED, NEVER RAW. A 10-digit mobile number is a direct
 * identifier with a 10^10 keyspace, and this collection is exported, replayed and
 * read by engineers. `phoneHash` is a peppered sha256 produced by
 * flowV3PhoneHash.js, which refuses to hash at all when the pepper is missing
 * rather than writing a brute-forceable digest.
 *
 * NO TTL. Same rule as FlowV3LeadProfile: no `expires`, no `expireAfterSeconds`.
 * The eval corpus and the golden replay set are the point; a sweep that quietly
 * eats them takes the safety net with it. Retention is an explicit operation
 * (see flowV3RetentionPolicy).
 */

const mongoose = require('mongoose');

const { PHONE_HASH_PATTERN } = require('../services/chatbot/flowV3LLM/profile/flowV3PhoneHash');

const gateVerdictSchema = new mongoose.Schema(
  {
    gate: { type: String, required: true, trim: true, maxlength: 64 },
    verdict: { type: String, required: true, trim: true, maxlength: 32 },
    reason: { type: String, default: null },
    terminatedTurn: { type: Boolean, default: false },
    latencyMs: { type: Number, default: null },
  },
  { _id: false }
);

const llmCallSchema = new mongoose.Schema(
  {
    callIndex: { type: Number, default: null },
    messages: { type: mongoose.Schema.Types.Mixed, default: null },
    rawResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    tokensIn: { type: Number, default: null },
    tokensOut: { type: Number, default: null },
    latencyMs: { type: Number, default: null },
    timedOut: { type: Boolean, default: false },
    error: { type: String, default: null },
  },
  { _id: false }
);

const toolCallSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 64 },
    args: { type: mongoose.Schema.Types.Mixed, default: null },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    latencyMs: { type: Number, default: null },
    cached: { type: Boolean, default: false },
    refused: { type: Boolean, default: false },
    failed: { type: Boolean, default: false },
  },
  { _id: false }
);

const validationVerdictSchema = new mongoose.Schema(
  {
    /** V-1 … V-8 (§7.2). */
    check: { type: String, required: true, trim: true, maxlength: 32 },
    verdict: { type: String, required: true, enum: ['pass', 'block', 'clamp', 'warn'] },
    detail: { type: String, default: null },
  },
  { _id: false }
);

const sentPartSchema = new mongoose.Schema(
  {
    /** Part index is half of the G-2b dedupe key (inReplyToInboundId, partIndex). */
    partIndex: { type: Number, required: true, min: 0 },
    type: { type: String, required: true, trim: true, maxlength: 32 },
    body: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    sent: { type: Boolean, default: false },
    duplicatePrevented: { type: Boolean, default: false },
  },
  { _id: false }
);

const latencyBreakdownSchema = new mongoose.Schema(
  {
    gatesMs: { type: Number, default: null },
    profileLoadMs: { type: Number, default: null },
    llmCall1Ms: { type: Number, default: null },
    toolsMs: { type: Number, default: null },
    llmCall2Ms: { type: Number, default: null },
    validationMs: { type: Number, default: null },
    renderMs: { type: Number, default: null },
    totalMs: { type: Number, default: null },
    budgetExceeded: { type: Boolean, default: false },
  },
  { _id: false }
);

const flowV3TurnLogSchema = new mongoose.Schema(
  {
    turnId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WhatsAppConversation',
      required: true,
      index: true,
    },
    /**
     * NULLABLE, BUT NEVER WEAK. `flowV3PhoneHash` refuses to hash when the
     * pepper is unset, so this field is null on those turns rather than holding
     * a brute-forceable digest. The validator still rejects anything that is not
     * a 64-char sha256 hex — a raw phone can never land here.
     *
     * This is the reversible half of the open question in flowV3PhoneHash:
     * losing phone linkage on some eval rows is recoverable, losing the reply or
     * storing a reversible digest is not. TODO(decision) tracks whether a missing
     * pepper should instead fail the turn outright.
     */
    phoneHash: {
      type: String,
      required: false,
      default: null,
      trim: true,
      validate: {
        validator: (value) => value == null || PHONE_HASH_PATTERN.test(value),
        message: 'phoneHash must be a 64-char lowercase sha256 hex digest',
      },
      index: true,
    },
    inboundId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    promptVersion: { type: String, required: true, trim: true, maxlength: 64 },
    promptHash: { type: String, default: null, trim: true },
    model: { type: String, default: null, trim: true },

    inboundText: { type: String, default: null },
    gateVerdicts: { type: [gateVerdictSchema], default: () => [] },

    profileBefore: { type: mongoose.Schema.Types.Mixed, default: null },
    slotPatch: { type: mongoose.Schema.Types.Mixed, default: null },
    profileAfter: { type: mongoose.Schema.Types.Mixed, default: null },

    llmCalls: { type: [llmCallSchema], default: () => [] },
    toolCalls: { type: [toolCallSchema], default: () => [] },

    envelope: { type: mongoose.Schema.Types.Mixed, default: null },
    validationVerdicts: { type: [validationVerdictSchema], default: () => [] },
    blocked: { type: Boolean, default: false },
    regenerated: { type: Boolean, default: false },
    /** §7.3 ladder: A deterministic beat reply · B holding reply · C static ack. */
    fallbackTier: { type: String, enum: ['A', 'B', 'C', null], default: null },

    sentParts: { type: [sentPartSchema], default: () => [] },
    deliveryStatus: { type: String, default: null, trim: true, maxlength: 32 },

    latencyBreakdown: { type: latencyBreakdownSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

flowV3TurnLogSchema.index({ conversationId: 1, createdAt: -1 });
flowV3TurnLogSchema.index({ promptVersion: 1, createdAt: -1 });
flowV3TurnLogSchema.index({ fallbackTier: 1, createdAt: -1 });

module.exports = mongoose.model('FlowV3TurnLog', flowV3TurnLogSchema);
