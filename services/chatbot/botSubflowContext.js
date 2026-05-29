/** Clears rank and college predictor slot-filling state while preserving other context keys. */
function emptySubflows() {
  return { college: {}, rank: {} };
}

module.exports = { emptySubflows };
