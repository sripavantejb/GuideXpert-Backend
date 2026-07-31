'use strict';

/**
 * Flow V3 LLM loop — tool rounds then JSON envelope (architecture §3 step 9).
 * 12s wall · max 3 tool iterations · JSON response_format + parse/repair.
 */

const { OpenAiCompatibleProvider } = require('../../../ai/providers/OpenAiCompatibleProvider');
const { createToolBroker } = require('../tools/toolBroker');
const { openaiToolDefinitions } = require('../tools/openaiToolSchemas');
const { parseEnvelope } = require('./parseEnvelope');
const { loadPrompt } = require('./promptLoader');

const DEFAULT_WALL_MS = 12000;
const MAX_TOOL_ITERATIONS = 3;
const JSON_RESPONSE_FORMAT = Object.freeze({ type: 'json_object' });

function elapsed(startedAt) {
  return Date.now() - startedAt;
}

function remainingMs(startedAt, wallMs) {
  return Math.max(0, wallMs - elapsed(startedAt));
}

/**
 * @param {{
 *   messages: Array,
 *   promptVersion?: string,
 *   toolContext?: object,
 *   broker?: object,
 *   provider?: { chatCompletion: Function },
 *   wallMs?: number,
 *   maxToolIterations?: number,
 *   repairFeedback?: string|null,
 * }} input
 */
async function runLlmLoop(input = {}) {
  const startedAt = Date.now();
  const wallMs = Number(input.wallMs) || DEFAULT_WALL_MS;
  const maxToolIterations = Number(input.maxToolIterations) || MAX_TOOL_ITERATIONS;
  const provider = input.provider || new OpenAiCompatibleProvider();
  const broker = input.broker || createToolBroker({ deps: input.deps || {} });
  const tools = openaiToolDefinitions();

  let messages = Array.isArray(input.messages) ? [...input.messages] : [];
  if (input.repairFeedback) {
    messages.push({
      role: 'user',
      content: `Your previous envelope failed validation: ${input.repairFeedback}. Return a corrected JSON envelope only.`,
    });
  }

  const toolTrace = [];
  let toolIterations = 0;

  while (toolIterations < maxToolIterations) {
    const left = remainingMs(startedAt, wallMs);
    if (left < 500) {
      return {
        ok: false,
        reason: 'wall_budget',
        envelope: null,
        parse: null,
        toolTrace,
        latencyMs: elapsed(startedAt),
      };
    }

    const completion = await provider.chatCompletion({
      messages,
      tools,
      toolChoice: 'auto',
      responseFormat: null,
      temperature: 0.4,
      maxTokens: 1200,
      // Up to 8s of the remaining wall, no SDK retries: a cold first call can
      // take >4s, and a 4s timeout retried twice burned the whole 12s wall,
      // forcing Tier A fallback on every cold start. The fallback ladder is
      // the retry policy here — an SDK retry never fits the remaining budget.
      timeoutMs: Math.min(8000, left),
      maxRetries: 0,
    });

    if (completion.toolCalls && completion.toolCalls.length) {
      toolIterations += 1;
      messages.push({
        role: 'assistant',
        content: completion.text || null,
        tool_calls: completion.toolCalls,
      });
      for (const tc of completion.toolCalls) {
        // F-9: NEVER execute a tool with guessed args. A malformed tool_call
        // fails closed — the failure is logged, recorded in the trace, and
        // fed back to the model as an explicit { failed } result.
        let args = null;
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch (err) {
          console.error('[flowV3] TOOL_ARGS_PARSE_FAILED', {
            tool: tc.function.name,
            error: err && err.message ? err.message : String(err),
          });
          toolTrace.push({
            name: tc.function.name,
            callId: tc.id || null,
            ok: false,
            result: null,
            error: 'malformed_tool_args',
          });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ failed: 'malformed_tool_args' }),
          });
          continue;
        }
        const invoked = await broker.invokeTool(tc.function.name, args, input.toolContext || {});
        toolTrace.push({
          name: tc.function.name,
          callId: invoked.callId,
          ok: invoked.ok,
          result: invoked.result,
          error: invoked.error || null,
        });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(invoked.result != null ? invoked.result : { error: invoked.error }),
        });
      }
      continue;
    }

    // Final JSON envelope pass — force json_object when no more tools.
    const finalLeft = remainingMs(startedAt, wallMs);
    if (finalLeft < 500 && !completion.text) {
      return {
        ok: false,
        reason: 'wall_budget',
        envelope: null,
        parse: null,
        toolTrace,
        latencyMs: elapsed(startedAt),
      };
    }

    let finalText = completion.text;
    if (!finalText || !String(finalText).trim().startsWith('{')) {
      const forced = await provider.chatCompletion({
        messages: [
          ...messages,
          {
            role: 'user',
            content:
              'Return ONLY the reply envelope JSON object now (intent, parts, grounding, profile_patch, booking_url_slot). No prose.',
          },
        ],
        responseFormat: JSON_RESPONSE_FORMAT,
        temperature: 0.2,
        maxTokens: 1200,
        // 4s was too tight for a full envelope (large prompt + parts): the
        // forced pass timed out and the whole turn fell back. 8s still fits
        // the wall after a ~2-3s first call.
        timeoutMs: Math.min(8000, remainingMs(startedAt, wallMs) || 1000),
        maxRetries: 0,
      });
      finalText = forced.text;
      messages.push({ role: 'assistant', content: finalText });
    }

    let parsed = parseEnvelope(finalText);
    if (!parsed.ok) {
      const repairLeft = remainingMs(startedAt, wallMs);
      if (repairLeft >= 800) {
        const repaired = await provider.chatCompletion({
          messages: [
            ...messages,
            {
              role: 'user',
              content: `Malformed envelope (${parsed.error}). Return corrected JSON envelope only.`,
            },
          ],
          responseFormat: JSON_RESPONSE_FORMAT,
          temperature: 0.1,
          maxTokens: 1200,
          timeoutMs: Math.min(8000, repairLeft),
          maxRetries: 0,
        });
        parsed = parseEnvelope(repaired.text);
        finalText = repaired.text;
      }
    }

    return {
      ok: parsed.ok,
      reason: parsed.ok ? null : 'parse_failed',
      envelope: parsed.envelope,
      parse: parsed,
      rawText: finalText,
      toolTrace,
      latencyMs: elapsed(startedAt),
      messages,
    };
  }

  return {
    ok: false,
    reason: 'tool_iteration_cap',
    envelope: null,
    parse: null,
    toolTrace,
    latencyMs: elapsed(startedAt),
  };
}

/**
 * Build the initial messages array for a turn.
 */
function buildTurnMessages({ promptVersion, systemExtra = '', userText, turnContext }) {
  const prompt = loadPrompt(promptVersion || null);
  const system = [prompt.text, systemExtra, turnContext ? `TURN_CONTEXT_JSON:\n${JSON.stringify(turnContext)}` : '']
    .filter(Boolean)
    .join('\n\n');
  return {
    prompt,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: String(userText || '') },
    ],
  };
}

module.exports = {
  DEFAULT_WALL_MS,
  MAX_TOOL_ITERATIONS,
  JSON_RESPONSE_FORMAT,
  runLlmLoop,
  buildTurnMessages,
};
