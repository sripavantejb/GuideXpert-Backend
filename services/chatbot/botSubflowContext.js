/** Clears rank/college predictor and knowledge-assistant session flags. */
function emptySubflows() {
  return { college: {}, rank: {}, knowledgeAssistantActive: false };
}

module.exports = { emptySubflows };
