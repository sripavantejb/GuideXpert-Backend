'use strict';

function isCounsellorProgramAssistantEnabled() {
  return String(process.env.CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED || '').trim() === '1';
}

module.exports = {
  isCounsellorProgramAssistantEnabled,
};
