'use strict';

function buildEmbedText({ category, question, answer } = {}) {
  const categoryText = String(category || '').trim();
  const questionText = String(question || '').trim();
  const answerText = String(answer || '').trim();

  return [
    `Category: ${categoryText}`,
    `Question: ${questionText}`,
    `Answer: ${answerText}`,
  ].join('\n');
}

module.exports = { buildEmbedText };
