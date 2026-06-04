'use strict';

function buildKnowledgeContext(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return '';
  }

  return results
    .map((entry, index) => {
      const question = String(entry.question || '').trim();
      const answer = String(entry.answer || '').trim();
      return [
        `Knowledge Entry ${index + 1}`,
        '',
        'Question:',
        question,
        '',
        'Answer:',
        answer,
      ].join('\n');
    })
    .join('\n\n');
}

module.exports = { buildKnowledgeContext };
