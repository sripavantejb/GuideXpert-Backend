#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  KNOWLEDGE_BASE_PATH,
  loadKnowledgeBase,
  auditKnowledgeBase,
} = require('../utils/knowledgeBaseAudit');

const MD_DIR = path.join(__dirname, '../knowledge-base/iit-counselling');
const CATEGORY = 'iit_counselling';

function normalizeQuestion(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMarkdownFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  const sections = raw.split(/^## /m).slice(1);

  for (const section of sections) {
    const newline = section.indexOf('\n');
    if (newline === -1) continue;
    const question = section.slice(0, newline).trim();
    const answer = section
      .slice(newline + 1)
      .trim()
      .replace(/\n{3,}/g, '\n\n');
    if (!question || !answer) continue;
    entries.push({ category: CATEGORY, question, answer });
  }

  return entries;
}

function loadMarkdownEntries() {
  if (!fs.existsSync(MD_DIR)) {
    throw new Error(`Missing directory: ${MD_DIR}`);
  }
  const files = fs
    .readdirSync(MD_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort();
  const entries = [];
  for (const file of files) {
    entries.push(...parseMarkdownFile(path.join(MD_DIR, file)));
  }
  return entries;
}

function mergeEntries(existing, incoming) {
  const seenQuestions = new Set(
    existing.map((entry) => normalizeQuestion(entry.question))
  );
  let nextId =
    existing.reduce((max, entry) => (entry.id > max ? entry.id : max), 0) + 1;
  const added = [];

  for (const entry of incoming) {
    const key = normalizeQuestion(entry.question);
    if (seenQuestions.has(key)) continue;
    seenQuestions.add(key);
    added.push({
      id: nextId,
      category: entry.category,
      question: entry.question,
      answer: entry.answer,
    });
    nextId += 1;
  }

  return [...existing, ...added];
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const incoming = loadMarkdownEntries();
  const existing = loadKnowledgeBase();
  const merged = mergeEntries(existing, incoming);
  const audit = auditKnowledgeBase(merged);

  console.log(`Parsed ${incoming.length} markdown Q&A entries`);
  console.log(`Merged total: ${merged.length} (was ${existing.length})`);

  if (!audit.ok) {
    console.error('Audit failed:');
    audit.errors.forEach((err) => console.error(' -', err));
    process.exit(1);
  }

  if (dryRun) {
    console.log('Dry run — no files written');
    process.exit(0);
  }

  fs.writeFileSync(KNOWLEDGE_BASE_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${KNOWLEDGE_BASE_PATH}`);
}

main();
