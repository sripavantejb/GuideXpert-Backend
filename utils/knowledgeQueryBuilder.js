'use strict';

function cleanText(value) {
  return String(value || '').trim();
}

function getLastUserTurn(history = []) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role !== 'user') continue;
    const content = cleanText(message.content);
    if (content) return content;
  }

  return null;
}

function buildRetrievalQuery({ currentMessage, history } = {}) {
  const current = cleanText(currentMessage);
  const lastUserTurn = getLastUserTurn(history);

  if (!current) {
    return lastUserTurn || '';
  }

  if (!lastUserTurn || lastUserTurn === current) {
    return current;
  }

  return `${lastUserTurn}\n${current}`;
}

module.exports = {
  buildRetrievalQuery,
  getLastUserTurn,
};
