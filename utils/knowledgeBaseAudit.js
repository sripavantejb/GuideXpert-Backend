'use strict';

const path = require('path');

const KNOWLEDGE_BASE_PATH = path.join(__dirname, '../knowledge/knowledgeBase.json');

function loadKnowledgeBase(filePath = KNOWLEDGE_BASE_PATH) {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const entries = require(filePath);
  if (!Array.isArray(entries)) {
    throw new Error('knowledgeBase.json must be a JSON array');
  }
  return entries;
}

function auditKnowledgeBase(entries) {
  const errors = [];

  if (!Array.isArray(entries)) {
    return { ok: false, errors: ['entries must be an array'] };
  }

  const seenIds = new Set();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const prefix = `entry[${index}]`;

    if (!entry || typeof entry !== 'object') {
      errors.push(`${prefix}: must be an object`);
      continue;
    }

    const { id, category, question, answer } = entry;

    if (id == null || typeof id !== 'number' || !Number.isInteger(id)) {
      errors.push(`${prefix}: id must be an integer`);
    } else if (seenIds.has(id)) {
      errors.push(`${prefix}: duplicate id ${id}`);
    } else {
      seenIds.add(id);
    }

    if (typeof category !== 'string' || !category.trim()) {
      errors.push(`${prefix} id=${id}: category must be a non-empty string`);
    }

    if (typeof question !== 'string' || !question.trim()) {
      errors.push(`${prefix} id=${id}: question must be a non-empty string`);
    }

    if (typeof answer !== 'string' || !answer.trim()) {
      errors.push(`${prefix} id=${id}: answer must be a non-empty string`);
    } else if (answer.includes('\t')) {
      errors.push(`${prefix} id=${id}: answer contains tab character (merged Q&A sentinel)`);
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = {
  KNOWLEDGE_BASE_PATH,
  loadKnowledgeBase,
  auditKnowledgeBase,
};
