'use strict';

/**
 * Ordered gate runner (architecture §3 / §4).
 *
 * Gate ORDER is the safety property, not an implementation detail:
 * "book a session, my life is over" must be a crisis, never a booking
 * conversion. No gate may be reordered below the LLM call.
 *
 * Every gate is deterministic and reuses existing frozen code. No gate calls an
 * LLM. This module is provider-agnostic: it decides only whether the turn may
 * proceed to the (M-2) LLM loop, and with what deterministic reply if not.
 */

const { isTier2Crisis } = require('../../flowV2/router/crisisClassifier');
const scopeFirewall = require('../../scopeFirewall/scopeFirewallService');
const { evaluateDemographicGate } = require('./demographicGate');

const GATES = Object.freeze([
  'G-CRISIS-LOCKED',
  'G-CRISIS',
  'G-OPTOUT',
  'G-SCOPE',
  'G-DEMOGRAPHIC',
  'G-BUDGET',
]);

const GATE_VERDICTS = Object.freeze({
  PASS: 'pass',
  TERMINATE: 'terminate',
  SILENT: 'silent',
});

function verdict(gate, value, extra = {}) {
  return {
    gate,
    verdict: value,
    terminatedTurn: value !== GATE_VERDICTS.PASS,
    reason: extra.reason || null,
    ...extra,
  };
}

/**
 * @param {{
 *   text?: string,
 *   englishMessage?: string,
 *   profile?: object,
 *   budget?: { llmCallsUsed?: number, maxLlmCalls?: number, spendUsed?: number, maxSpend?: number },
 * }} input
 * @param {{ deps?: object }} [options]
 * @returns {{ passed: boolean, verdicts: Array, terminal: object|null }}
 */
function runGateChain(input = {}, options = {}) {
  const deps = options.deps || {};
  const crisisCheck = deps.isTier2Crisis || isTier2Crisis;
  const scope = deps.scopeFirewall || scopeFirewall;
  const demographic = deps.evaluateDemographicGate || evaluateDemographicGate;

  const profile = input.profile || {};
  const text = String(input.text || '');
  const verdicts = [];

  const stop = (v, terminal) => {
    verdicts.push(v);
    return { passed: false, verdicts, terminal };
  };

  // 1. Permanent crisis lock — never unset once true.
  if (profile.crisisLocked === true) {
    return stop(
      verdict('G-CRISIS-LOCKED', GATE_VERDICTS.TERMINATE, { reason: 'crisis_locked' }),
      { kind: 'crisis_locked', route: 'human_handoff' }
    );
  }
  verdicts.push(verdict('G-CRISIS-LOCKED', GATE_VERDICTS.PASS));

  // 2. Tier-2 crisis text — before slot extraction, before any LLM call.
  if (text && crisisCheck(text)) {
    return stop(
      verdict('G-CRISIS', GATE_VERDICTS.TERMINATE, { reason: 'tier2_crisis' }),
      {
        kind: 'crisis',
        route: 'human_handoff',
        setCrisisLocked: true,
        // Handoff is fired eagerly and deliberately NOT awaited by the caller,
        // so a DB outage cannot suppress the safety reply.
        handoffEager: true,
      }
    );
  }
  verdicts.push(verdict('G-CRISIS', GATE_VERDICTS.PASS));

  // 3. Opt-out — silence, not a reply.
  if (profile.optedOut === true) {
    return stop(verdict('G-OPTOUT', GATE_VERDICTS.SILENT, { reason: 'opted_out' }), {
      kind: 'silent',
      route: 'none',
    });
  }
  verdicts.push(verdict('G-OPTOUT', GATE_VERDICTS.PASS));

  // 4. Scope firewall — policy/prompt-injection categories deny unconditionally.
  if (text) {
    const scopeResult = scope.evaluateScope({
      originalText: text,
      englishMessage: input.englishMessage || null,
    });
    if (scope.shouldBlockLlm(scopeResult)) {
      return stop(
        verdict('G-SCOPE', GATE_VERDICTS.TERMINATE, {
          reason: scopeResult.category || 'out_of_scope',
        }),
        { kind: 'out_of_scope', route: 'deterministic_refusal', scope: scopeResult }
      );
    }
    verdicts.push(verdict('G-SCOPE', GATE_VERDICTS.PASS));
  } else {
    verdicts.push(verdict('G-SCOPE', GATE_VERDICTS.PASS, { reason: 'no_text' }));
  }

  // 5. S-1 demographic block — post-merge, every turn, verbatim refusal copy.
  const demo = demographic(profile);
  if (demo.blocked) {
    return stop(
      verdict('G-DEMOGRAPHIC', GATE_VERDICTS.TERMINATE, { reason: 'ap_oc_male_blocked' }),
      {
        kind: 'demographic_blocked',
        route: 'human_agent',
        copy: demo.copy,
        buttons: demo.buttons,
      }
    );
  }
  verdicts.push(verdict('G-DEMOGRAPHIC', GATE_VERDICTS.PASS));

  // 6. Budget — per-turn tool cap and per-conversation LLM spend cap.
  const budget = input.budget || {};
  const overCalls =
    budget.maxLlmCalls != null && Number(budget.llmCallsUsed || 0) >= Number(budget.maxLlmCalls);
  const overSpend =
    budget.maxSpend != null && Number(budget.spendUsed || 0) >= Number(budget.maxSpend);
  if (overCalls || overSpend) {
    return stop(
      verdict('G-BUDGET', GATE_VERDICTS.TERMINATE, {
        reason: overCalls ? 'llm_call_budget' : 'spend_budget',
      }),
      { kind: 'budget_exhausted', route: 'fallback_ladder' }
    );
  }
  verdicts.push(verdict('G-BUDGET', GATE_VERDICTS.PASS));

  return { passed: true, verdicts, terminal: null };
}

module.exports = {
  GATES,
  GATE_VERDICTS,
  runGateChain,
};
