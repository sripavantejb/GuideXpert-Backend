'use strict';

/** In-memory + Mongo-backed lightweight system metrics for Recovery ops. */

const samples = [];
const MAX_SAMPLES = 500;

function recordSystemMetricSample(sample = {}) {
  samples.push({
    ...sample,
    at: sample.at || new Date().toISOString(),
  });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

function getRecentSamples(limit = 100) {
  return samples.slice(-Math.max(1, limit));
}

function average(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function getSystemMetricsSummary() {
  const recent = getRecentSamples(200);
  const schedulerRuns = recent.filter((s) => s.type === 'scheduler_run');
  const resumes = recent.filter((s) => s.type === 'resume');
  const apis = recent.filter((s) => s.type === 'api');
  const lastHour = Date.now() - 60 * 60 * 1000;
  const failsLastHour = recent.filter(
    (s) => s.type === 'scheduler_run' && s.failed > 0 && new Date(s.at).getTime() >= lastHour
  );
  const sentLastMin = recent
    .filter((s) => s.type === 'scheduler_run' && Date.now() - new Date(s.at).getTime() <= 60_000)
    .reduce((acc, s) => acc + (s.sent || 0), 0);

  return {
    schedulerExecutions: schedulerRuns.length,
    averageExecutionTimeMs: Math.round(
      average(schedulerRuns.map((s) => Number(s.durationMs) || 0))
    ),
    recoveryLatencyMs: Math.round(
      average(schedulerRuns.map((s) => Number(s.durationMs) || 0))
    ),
    queueLatencyMs: null,
    messagesPerMinute: sentLastMin,
    resumeLatencyMs: Math.round(average(resumes.map((s) => Number(s.durationMs) || 0))),
    apiLatencyMs: Math.round(average(apis.map((s) => Number(s.durationMs) || 0))),
    failuresPerHour: failsLastHour.reduce((acc, s) => acc + (s.failed || 0), 0),
    recentSampleCount: recent.length,
  };
}

module.exports = {
  recordSystemMetricSample,
  getRecentSamples,
  getSystemMetricsSummary,
};
