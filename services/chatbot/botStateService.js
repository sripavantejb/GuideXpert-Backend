const WhatsAppBotState = require('../../models/WhatsAppBotState');
const { emptySubflows } = require('./botSubflowContext');
const { logChatbotEvent } = require('./chatbotStructuredLog');

const SUBFLOW_TTL_MS = 30 * 60 * 1000;
const MAX_OPTIMISTIC_LOCK_RETRIES = 3;

class OptimisticLockConflictError extends Error {
  constructor(meta = {}) {
    super('optimistic_lock_conflict');
    this.name = 'OptimisticLockConflictError';
    this.meta = meta;
  }
}

class OptimisticLockFailedError extends Error {
  constructor(meta = {}) {
    super('optimistic_lock_failed');
    this.name = 'OptimisticLockFailedError';
    this.meta = meta;
  }
}

const lockMetrics = {
  conflicts: 0,
  resolved: 0,
  failed: 0,
  retryCounts: [],
  updateLatenciesMs: [],
};

function normalizeVersion(doc) {
  if (!doc) return 0;
  const version = Number(doc.version);
  return Number.isFinite(version) ? version : 0;
}

function resetOptimisticLockMetrics() {
  lockMetrics.conflicts = 0;
  lockMetrics.resolved = 0;
  lockMetrics.failed = 0;
  lockMetrics.retryCounts = [];
  lockMetrics.updateLatenciesMs = [];
}

function getOptimisticLockMetrics() {
  const latencies = [...lockMetrics.updateLatenciesMs];
  latencies.sort((a, b) => a - b);
  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
      : 0;
  const percentile = (p) => {
    if (!latencies.length) return 0;
    const idx = Math.ceil((p / 100) * latencies.length) - 1;
    return latencies[Math.max(0, idx)];
  };

  return {
    conflicts: lockMetrics.conflicts,
    resolved: lockMetrics.resolved,
    failed: lockMetrics.failed,
    retryCounts: [...lockMetrics.retryCounts],
    maxRetries: lockMetrics.retryCounts.length ? Math.max(...lockMetrics.retryCounts) : 0,
    avgRetryCount:
      lockMetrics.retryCounts.length > 0
        ? lockMetrics.retryCounts.reduce((sum, value) => sum + value, 0) /
          lockMetrics.retryCounts.length
        : 0,
    conflictRate:
      lockMetrics.updateLatenciesMs.length > 0
        ? lockMetrics.conflicts / lockMetrics.updateLatenciesMs.length
        : 0,
    avgUpdateLatencyMs: avgLatency,
    p95UpdateLatencyMs: percentile(95),
    updateCount: lockMetrics.updateLatenciesMs.length,
  };
}

function logOptimisticLockConflict(fields) {
  lockMetrics.conflicts += 1;
  if (fields.resolvedSuccessfully) {
    lockMetrics.resolved += 1;
  }
  logChatbotEvent('optimistic_lock_conflict', fields);
}

function logOptimisticLockFailed(fields) {
  lockMetrics.failed += 1;
  logChatbotEvent('optimistic_lock_failed', fields);
}

function isStateExpired(botState, now = new Date()) {
  if (!botState || !botState.stateExpiresAt) return false;
  const expiresAt = new Date(botState.stateExpiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= now.getTime();
}

const DEEP_MERGE_CONTEXT_KEYS = new Set(['college', 'rank']);
const ATOMIC_REPLACE_CONTEXT_KEYS = new Set(['predictionIdempotency']);

function mergeContext(existingContext, contextPatch) {
  const base =
    existingContext && typeof existingContext === 'object' ? { ...existingContext } : {};
  const patch = contextPatch && typeof contextPatch === 'object' ? contextPatch : {};

  for (const [key, value] of Object.entries(patch)) {
    if (ATOMIC_REPLACE_CONTEXT_KEYS.has(key)) {
      base[key] = value === undefined ? base[key] : value;
      continue;
    }
    if (DEEP_MERGE_CONTEXT_KEYS.has(key)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (Object.keys(value).length === 0) {
          base[key] = {};
        } else {
          const prev = base[key] && typeof base[key] === 'object' ? base[key] : {};
          base[key] = { ...prev, ...value };
        }
      } else {
        base[key] = value;
      }
      continue;
    }
    base[key] = value;
  }

  return base;
}

async function getBotState(conversationId) {
  return WhatsAppBotState.findOne({ conversationId }).lean();
}

/**
 * Compare-and-swap bot state update. Reads current doc, applies buildUpdate, writes only if
 * version still matches. Throws OptimisticLockConflictError on lost race.
 *
 * @param {import('mongoose').Types.ObjectId|string} conversationId
 * @param {string} phone10
 * @param {(existing: object|null, now: Date) => object} buildUpdate — returns { nextState, context, stateExpiresAt, previousState }
 * @param {object} [opts]
 */
async function updateBotStateCas(conversationId, phone10, buildUpdate, opts = {}) {
  const startedAt = Date.now();
  const now = opts.now instanceof Date ? opts.now : new Date();
  const existing = await WhatsAppBotState.findOne({ conversationId }).lean();
  const expectedVersion = normalizeVersion(existing);
  const built = buildUpdate(existing, now);

  if (!existing) {
    try {
      await WhatsAppBotState.create({
        conversationId,
        phone: phone10,
        state: built.nextState,
        previousState: built.previousState,
        context: built.context,
        stateEnteredAt: now,
        stateExpiresAt: built.stateExpiresAt,
        version: 1,
      });
      const latencyMs = Date.now() - startedAt;
      lockMetrics.updateLatenciesMs.push(latencyMs);
      return {
        state: built.nextState,
        context: built.context,
        version: 1,
      };
    } catch (err) {
      if (err && err.code === 11000) {
        const latest = await WhatsAppBotState.findOne({ conversationId }).lean();
        throw new OptimisticLockConflictError({
          conversationId: String(conversationId),
          phone10,
          previousVersion: 0,
          currentVersion: normalizeVersion(latest),
          retryAttempt: opts.retryAttempt ?? null,
        });
      }
      throw err;
    }
  }

  const updateResult = await WhatsAppBotState.updateOne(
    { conversationId, version: expectedVersion },
    {
      $set: {
        state: built.nextState,
        previousState: built.previousState,
        context: built.context,
        stateEnteredAt: now,
        stateExpiresAt: built.stateExpiresAt,
        updatedAt: now,
      },
      $inc: { version: 1 },
    },
    { runValidators: true }
  );

  const latencyMs = Date.now() - startedAt;
  lockMetrics.updateLatenciesMs.push(latencyMs);

  if (updateResult.modifiedCount !== 1) {
    const latest = await WhatsAppBotState.findOne({ conversationId }).lean();
    throw new OptimisticLockConflictError({
      conversationId: String(conversationId),
      phone10,
      previousVersion: expectedVersion,
      currentVersion: normalizeVersion(latest),
      retryAttempt: opts.retryAttempt ?? null,
    });
  }

  return {
    state: built.nextState,
    context: built.context,
    version: expectedVersion + 1,
  };
}

async function transitionState(conversationId, phone10, nextState, contextPatch = {}, opts = {}) {
  return updateBotStateCas(
    conversationId,
    phone10,
    (existing, now) => {
      const prev = existing ? existing.state : null;
      const context = mergeContext(
        existing && existing.context && typeof existing.context === 'object' ? existing.context : {},
        contextPatch
      );
      const stateExpiresAt =
        opts.stateExpiresAt || new Date(now.getTime() + (opts.ttlMs || SUBFLOW_TTL_MS));
      return {
        nextState,
        context,
        stateExpiresAt,
        previousState: prev,
      };
    },
    opts
  );
}

async function resetToMainMenu(conversationId, phone10, opts = {}) {
  return transitionState(conversationId, phone10, 'main_menu', emptySubflows(), {
    ttlMs: SUBFLOW_TTL_MS,
    ...opts,
  });
}

/**
 * Retry an operation when optimistic lock conflicts occur. Re-invokes operation with fresh
 * state reads on each attempt so the inbound message is fully replayed.
 */
async function runWithOptimisticLockRetry({
  conversationId,
  phone10,
  operation,
  maxAttempts = MAX_OPTIMISTIC_LOCK_RETRIES,
}) {
  const startedAt = Date.now();
  let lastConflict = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await operation(attempt);
      if (attempt > 1) {
        logOptimisticLockConflict({
          conversationId: String(conversationId),
          phone10,
          previousVersion: lastConflict?.previousVersion ?? null,
          currentVersion: lastConflict?.currentVersion ?? null,
          retryAttempt: attempt - 1,
          durationMs: Date.now() - startedAt,
          resolvedSuccessfully: true,
        });
        lockMetrics.retryCounts.push(attempt - 1);
      }
      return result;
    } catch (err) {
      if (!(err instanceof OptimisticLockConflictError)) {
        throw err;
      }
      lastConflict = err.meta || {};
      logOptimisticLockConflict({
        conversationId: String(conversationId),
        phone10,
        previousVersion: lastConflict.previousVersion ?? null,
        currentVersion: lastConflict.currentVersion ?? null,
        retryAttempt: attempt,
        durationMs: Date.now() - startedAt,
        resolvedSuccessfully: false,
      });

      if (attempt >= maxAttempts) {
        logOptimisticLockFailed({
          conversationId: String(conversationId),
          phone10,
          previousVersion: lastConflict.previousVersion ?? null,
          currentVersion: lastConflict.currentVersion ?? null,
          retryAttempt: attempt,
          durationMs: Date.now() - startedAt,
        });
        throw new OptimisticLockFailedError({
          conversationId: String(conversationId),
          phone10,
          previousVersion: lastConflict.previousVersion ?? null,
          currentVersion: lastConflict.currentVersion ?? null,
          retryAttempt: attempt,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 5 * attempt));
    }
  }

  throw new OptimisticLockFailedError({
    conversationId: String(conversationId),
    phone10,
  });
}

module.exports = {
  getBotState,
  mergeContext,
  DEEP_MERGE_CONTEXT_KEYS,
  transitionState,
  resetToMainMenu,
  updateBotStateCas,
  runWithOptimisticLockRetry,
  isStateExpired,
  OptimisticLockConflictError,
  OptimisticLockFailedError,
  getOptimisticLockMetrics,
  resetOptimisticLockMetrics,
  MAX_OPTIMISTIC_LOCK_RETRIES,
  SUBFLOW_TTL_MS,
};
