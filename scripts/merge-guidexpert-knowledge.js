#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  KNOWLEDGE_BASE_PATH,
  loadKnowledgeBase,
  auditKnowledgeBase,
} = require('../utils/knowledgeBaseAudit');

const IMPORT_PATH = process.argv[2];

function normalizeQuestion(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SEMANTIC_DUPLICATE_GROUPS = [
  [
    /how many hours should i work/i,
    /work at any time/i,
    /specific time frame during which we must work/i,
  ],
  [
    /what should i do after training/i,
    /what should i do after attending the training/i,
  ],
  [
    /what to do if they say ['"]?i will think about it/i,
    /follow up smartly without being pushy after they say ['"]?i will think about it/i,
  ],
  [
    /will i get growth opportunities/i,
    /what kind of career opportunities will we get/i,
  ],
];

function semanticGroupIndex(question) {
  const text = String(question || '');
  for (let index = 0; index < SEMANTIC_DUPLICATE_GROUPS.length; index += 1) {
    if (SEMANTIC_DUPLICATE_GROUPS[index].some((pattern) => pattern.test(text))) {
      return index;
    }
  }
  return null;
}

function tokenSet(value) {
  return new Set(
    normalizeQuestion(value)
      .split(' ')
      .filter((token) => token.length >= 3)
  );
}

function jaccardSimilarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function normalizeCategory(value) {
  const text = String(value || '').trim();
  if (text.toLowerCase() === 'guidexpert') return 'guidexpert';
  return text;
}

function scoreEntryQuality(entry) {
  const questionScore = String(entry.question || '').trim().length;
  const answerScore = String(entry.answer || '').trim().length;
  return questionScore + answerScore * 0.25;
}

function loadImportEntries(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) {
    throw new Error('Import file must be a JSON array');
  }
  return entries.map((entry) => ({
    category: normalizeCategory(entry.category),
    question: String(entry.question || '').trim(),
    answer: String(entry.answer || '').trim(),
  }));
}

function findDuplicate(existingEntries, candidate, importEntries, importIndex) {
  const normalizedCandidate = normalizeQuestion(candidate.question);
  const candidateAnswer = candidate.answer.trim();

  const pools = [
    ...existingEntries.map((entry) => ({ source: 'existing', entry })),
    ...importEntries
      .map((entry, index) => ({ source: 'import', entry, index }))
      .filter((item) => item.index < importIndex),
  ];

  for (const item of pools) {
    const existing = item.entry;
    const normalizedExisting = normalizeQuestion(existing.question);
    const existingAnswer = String(existing.answer || '').trim();

    if (normalizedCandidate === normalizedExisting) {
      return {
        reason: 'same_question',
        kept: scoreEntryQuality(existing) >= scoreEntryQuality(candidate) ? existing : candidate,
        removed: candidate,
        matched: existing,
        source: item.source,
      };
    }

    const similarity = jaccardSimilarity(candidate.question, existing.question);
    const sameAnswer = candidateAnswer === existingAnswer;

    if (sameAnswer) {
      return {
        reason: 'same_answer',
        kept: scoreEntryQuality(existing) >= scoreEntryQuality(candidate) ? existing : candidate,
        removed: candidate,
        matched: existing,
        source: item.source,
        similarity,
      };
    }

    if (similarity >= 0.65) {
      return {
        reason: 'highly_similar_question',
        kept: scoreEntryQuality(existing) >= scoreEntryQuality(candidate) ? existing : candidate,
        removed: candidate,
        matched: existing,
        source: item.source,
        similarity,
      };
    }
  }

  return null;
}

function collapseSemanticGroups(importEntries) {
  const duplicateReport = [];
  const grouped = new Map();
  const ungrouped = [];

  for (const entry of importEntries) {
    const groupIndex = semanticGroupIndex(entry.question);
    if (groupIndex == null) {
      ungrouped.push(entry);
      continue;
    }

    const existing = grouped.get(groupIndex);
    if (!existing) {
      grouped.set(groupIndex, entry);
      continue;
    }

    const keepEntry = scoreEntryQuality(entry) > scoreEntryQuality(existing) ? entry : existing;
    const removeEntry = keepEntry === entry ? existing : entry;
    duplicateReport.push({
      removedQuestion: removeEntry.question,
      matchedQuestion: keepEntry.question,
      reason: 'semantic_duplicate_group',
      similarity: null,
      keptQuestion: keepEntry.question,
    });
    grouped.set(groupIndex, keepEntry);
  }

  return { entries: [...ungrouped, ...grouped.values()], duplicateReport };
}

function dedupeImportEntries(existingEntries, importEntries) {
  const collapsed = collapseSemanticGroups(importEntries);
  const accepted = [];
  const duplicateReport = [...collapsed.duplicateReport];

  for (const candidate of collapsed.entries) {
    const duplicate = findDuplicate(existingEntries, candidate, accepted, accepted.length);

    if (duplicate) {
      if (
        duplicate.source === 'import' &&
        scoreEntryQuality(candidate) > scoreEntryQuality(duplicate.matched)
      ) {
        const replaceIndex = accepted.findIndex(
          (entry) => normalizeQuestion(entry.question) === normalizeQuestion(duplicate.matched.question)
        );
        if (replaceIndex >= 0) {
          accepted[replaceIndex] = candidate;
        }
      }

      duplicateReport.push({
        removedQuestion:
          scoreEntryQuality(candidate) > scoreEntryQuality(duplicate.kept)
            ? duplicate.matched.question
            : candidate.question,
        matchedQuestion:
          scoreEntryQuality(candidate) > scoreEntryQuality(duplicate.kept)
            ? candidate.question
            : duplicate.matched.question,
        reason: duplicate.reason,
        similarity: duplicate.similarity ?? null,
        keptQuestion: duplicate.kept.question,
      });
      continue;
    }

    accepted.push(candidate);
  }

  return { accepted, duplicateReport };
}

function main() {
  if (!IMPORT_PATH) {
    console.error('Usage: node scripts/merge-guidexpert-knowledge.js <import-json-path>');
    process.exit(1);
  }

  const resolvedImportPath = path.resolve(IMPORT_PATH);
  const existingEntries = loadKnowledgeBase();
  const importEntries = loadImportEntries(resolvedImportPath);
  const maxId = existingEntries.reduce((max, entry) => Math.max(max, entry.id || 0), 0);

  const { accepted, duplicateReport } = dedupeImportEntries(existingEntries, importEntries);
  const nextEntries = [...existingEntries];
  const assigned = [];

  let nextId = maxId + 1;
  for (const entry of accepted) {
    const record = {
      id: nextId,
      category: entry.category,
      question: entry.question,
      answer: entry.answer,
    };
    nextEntries.push(record);
    assigned.push(record);
    nextId += 1;
  }

  const audit = auditKnowledgeBase(nextEntries);
  if (!audit.ok) {
    console.error('Audit failed after merge:');
    for (const error of audit.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  fs.writeFileSync(KNOWLEDGE_BASE_PATH, `${JSON.stringify(nextEntries, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        existingCount: existingEntries.length,
        importedSourceCount: importEntries.length,
        duplicatesRemoved: duplicateReport.length,
        entriesAdded: assigned.length,
        finalCount: nextEntries.length,
        duplicateReport,
        addedIds: assigned.map((entry) => entry.id),
      },
      null,
      2
    )
  );
}

main();
