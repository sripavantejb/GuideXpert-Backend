/** Clears rank/college predictor and assistant session flags. */
function emptySubflows() {
  return {
    college: {},
    rank: {},
    careerCounselling: {},
    knowledgeAssistantActive: false,
    counsellorProgramAssistantActive: false,
    counsellorProgramSessionLanguage: null,
    iitCounsellingExpertActive: false,
    iitCounsellingExpertSessionLanguage: null,
    iitCounsellingStrategyActive: false,
    iitCounsellingStrategySessionLanguage: null,
  };
}

module.exports = { emptySubflows };
