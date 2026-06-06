'use strict';

function isMultilingualEnabled() {
  return String(process.env.CHATBOT_MULTILINGUAL_ENABLED || '').trim() === '1';
}

module.exports = {
  isMultilingualEnabled,
};
