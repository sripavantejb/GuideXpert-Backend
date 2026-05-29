/** Upper bound for college predictor cutoff_to (matches frontend collegePredictorOptions). */
const CUTOFF_UPPER_BOUND = 500000;

/**
 * Convert a student rank into [cutoff_from, cutoff_to] for the upstream API.
 * Ported from frontend collegePredictorOptions.js.
 * @param {number|string} rank
 * @returns {[number, number]|null}
 */
function rankToCutoff(rank) {
  const r = Number(rank);
  if (!Number.isFinite(r) || r <= 0) return null;
  let buffer;
  if (r <= 50) buffer = 3;
  else if (r <= 100) buffer = 10;
  else if (r <= 1000) buffer = 30;
  else if (r <= 5000) buffer = 50;
  else if (r <= 10000) buffer = 100;
  else if (r <= 16000) buffer = 500;
  else if (r <= 30000) buffer = 800;
  else if (r <= 50000) buffer = 1000;
  else if (r <= 100000) buffer = 1200;
  else buffer = 2000;
  return [Math.max(1, r - buffer), CUTOFF_UPPER_BOUND];
}

module.exports = {
  CUTOFF_UPPER_BOUND,
  rankToCutoff,
};
