'use strict';

/**
 * Flow V3 M-1 tool broker — fixed allowlist, DI, call IDs, side-effect idempotency, budget.
 * No LLM provider loop (M-2). No check_guardrails tool.
 */

const crypto = require('crypto');

const nextQuestion = require('./nextQuestion');
const getCuratedCatalog = require('./getCuratedCatalog');
const getPredictorMatches = require('./getPredictorMatches');
const getBookingSlots = require('./getBookingSlots');
const searchKnowledge = require('./searchKnowledge');
const updateLeadProfile = require('./updateLeadProfile');
const createBookingLink = require('./createBookingLink');
const escalateToHuman = require('./escalateToHuman');

/** Fixed allowlist — exactly 8 tools, snake_case names for turn-log / M-2. */
const FLOW_V3_TOOL_ALLOWLIST = Object.freeze([
  'next_question',
  'get_curated_catalog',
  'get_predictor_matches',
  'get_booking_slots',
  'search_knowledge',
  'update_lead_profile',
  'create_booking_link',
  'escalate_to_human',
]);

/** Side-effecting tools — idempotency keys dedupe within a broker session. */
const SIDE_EFFECT_TOOLS = Object.freeze(
  new Set(['update_lead_profile', 'create_booking_link', 'escalate_to_human'])
);

const DEFAULT_BUDGET = Object.freeze({
  maxCallsPerTurn: 12,
  maxSideEffectsPerTurn: 3,
});

const DEFAULT_HANDLERS = Object.freeze({
  next_question: nextQuestion.run,
  get_curated_catalog: getCuratedCatalog.run,
  get_predictor_matches: getPredictorMatches.run,
  get_booking_slots: getBookingSlots.run,
  search_knowledge: searchKnowledge.run,
  update_lead_profile: updateLeadProfile.run,
  create_booking_link: createBookingLink.run,
  escalate_to_human: escalateToHuman.run,
});

function stableArgsKey(value) {
  try {
    return crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex').slice(0, 16);
  } catch {
    return '0';
  }
}

function generateCallId(prefix = 'flowv3_tc') {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * @param {string} toolName
 * @param {object} args
 * @param {{ conversationId?: string, phone?: string, turnId?: string, inboundId?: string }} context
 */
function buildSideEffectIdempotencyKey(toolName, args = {}, context = {}) {
  switch (toolName) {
    case 'update_lead_profile':
      return `ulp:${context.phone || ''}:v${args.expectedVersion}:${stableArgsKey(args.profilePatch)}:${stableArgsKey(args.metaByPath)}`;
    case 'create_booking_link':
      return `cbl:${context.conversationId || context.phone || ''}:${args.serviceKey || ''}`;
    case 'escalate_to_human':
      return args.crisis === true
        ? `eth:crisis:${context.conversationId || context.phone || ''}:${stableArgsKey({ msg: args.userLastMessage })}`
        : `eth:${context.conversationId || context.phone || ''}`;
    default:
      return null;
  }
}

function createToolBroker(options = {}) {
  const handlers = { ...DEFAULT_HANDLERS, ...(options.handlers || {}) };
  const deps = options.deps || {};
  const budgetLimit = { ...DEFAULT_BUDGET, ...(options.budget || {}) };
  const executedSideEffects = new Set(options.executedSideEffects || []);
  let callCount = 0;
  let sideEffectCount = 0;

  function budgetSnapshot() {
    return {
      callCount,
      sideEffectCount,
      remainingCalls: Math.max(0, budgetLimit.maxCallsPerTurn - callCount),
      remainingSideEffects: Math.max(0, budgetLimit.maxSideEffectsPerTurn - sideEffectCount),
      limits: { ...budgetLimit },
    };
  }

  function resetBudget() {
    callCount = 0;
    sideEffectCount = 0;
  }

  /**
   * @param {string} toolName
   * @param {object} [args]
   * @param {object} [context]
   */
  async function invokeTool(toolName, args = {}, context = {}) {
    const name = String(toolName || '').trim();
    if (!FLOW_V3_TOOL_ALLOWLIST.includes(name)) {
      return {
        ok: false,
        callId: null,
        error: 'tool_not_allowed',
        allowed: [...FLOW_V3_TOOL_ALLOWLIST],
      };
    }

    if (callCount >= budgetLimit.maxCallsPerTurn) {
      return {
        ok: false,
        callId: null,
        error: 'budget_exhausted',
        budget: budgetSnapshot(),
      };
    }

    const isSideEffect = SIDE_EFFECT_TOOLS.has(name);
    if (isSideEffect && sideEffectCount >= budgetLimit.maxSideEffectsPerTurn) {
      return {
        ok: false,
        callId: null,
        error: 'side_effect_budget_exhausted',
        budget: budgetSnapshot(),
      };
    }

    const idempotencyKey = buildSideEffectIdempotencyKey(name, args, context);
    if (isSideEffect && idempotencyKey && executedSideEffects.has(idempotencyKey)) {
      return {
        ok: true,
        callId: generateCallId('flowv3_tc_idem'),
        idempotentReplay: true,
        idempotencyKey,
        result: { skipped: true, reason: 'idempotent_replay' },
        budget: budgetSnapshot(),
      };
    }

    const handler = handlers[name];
    if (typeof handler !== 'function') {
      return { ok: false, callId: null, error: 'handler_missing', tool: name };
    }

    const callId = generateCallId();
    const startedAt = Date.now();
    callCount += 1;
    if (isSideEffect) sideEffectCount += 1;

    try {
      const result = await handler(args, {
        ...context,
        callId,
        toolName: name,
        deps,
        broker: { budgetSnapshot },
      });
      if (isSideEffect && idempotencyKey && result && result.ok !== false) {
        executedSideEffects.add(idempotencyKey);
      }
      return {
        ok: result && result.ok === false ? false : true,
        callId,
        idempotencyKey,
        latencyMs: Date.now() - startedAt,
        result,
        budget: budgetSnapshot(),
      };
    } catch (err) {
      return {
        ok: false,
        callId,
        idempotencyKey,
        latencyMs: Date.now() - startedAt,
        error: err && err.message ? err.message : String(err),
        budget: budgetSnapshot(),
      };
    }
  }

  return {
    invokeTool,
    budgetSnapshot,
    resetBudget,
    allowlist: FLOW_V3_TOOL_ALLOWLIST,
    executedSideEffects,
  };
}

module.exports = {
  FLOW_V3_TOOL_ALLOWLIST,
  SIDE_EFFECT_TOOLS,
  DEFAULT_BUDGET,
  DEFAULT_HANDLERS,
  stableArgsKey,
  generateCallId,
  buildSideEffectIdempotencyKey,
  createToolBroker,
};
