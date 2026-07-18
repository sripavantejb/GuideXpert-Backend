'use strict';

/**
 * WhatsApp response optimizer for Career Counselling V2.
 * Presentation only — does not change counseling logic or state.
 */

const MAX_WORDS_SOFT = 50;
const MAX_WORDS_HARD = 80;
const MAX_BULLETS = 4;

const FILLER_PATTERNS = [
  /\bbased on your (goals|profile|interests|preferences)\b[,.]?\s*/gi,
  /\bi understand your interests\b[,.]?\s*/gi,
  /\bthank you for (sharing that information|answering)\b[,.]?\s*/gi,
];

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function stripFiller(text) {
  let out = String(text || '');
  for (const re of FILLER_PATTERNS) {
    out = out.replace(re, '');
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function limitBulletsInBlock(block) {
  const lines = String(block || '').split('\n');
  const bullets = lines.filter((l) => /^\s*[•✅\-]\s+/.test(l));
  if (bullets.length <= MAX_BULLETS) return block;

  let kept = 0;
  const out = [];
  for (const line of lines) {
    if (/^\s*[•✅\-]\s+/.test(line)) {
      kept += 1;
      if (kept <= MAX_BULLETS) out.push(line);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Split a long block into sentence-ish chunks under the soft word target.
 */
function splitOversizedBlock(block) {
  const text = String(block || '').trim();
  if (!text) return [];
  if (wordCount(text) <= MAX_WORDS_HARD) return [text];

  // Prefer existing newlines
  const byLine = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (byLine.length > 1) {
    const parts = [];
    let buf = '';
    for (const line of byLine) {
      const next = buf ? `${buf}\n${line}` : line;
      if (buf && wordCount(next) > MAX_WORDS_SOFT) {
        parts.push(buf);
        buf = line;
      } else {
        buf = next;
      }
    }
    if (buf) parts.push(buf);
    return parts.flatMap((p) => (wordCount(p) > MAX_WORDS_HARD ? splitBySentences(p) : [p]));
  }

  return splitBySentences(text);
}

function splitBySentences(text) {
  const sentences = String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) {
    // Hard truncate by words only as last resort — keep meaning head
    const words = text.split(/\s+/);
    if (words.length <= MAX_WORDS_HARD) return [text];
    const parts = [];
    for (let i = 0; i < words.length; i += MAX_WORDS_SOFT) {
      parts.push(words.slice(i, i + MAX_WORDS_SOFT).join(' '));
    }
    return parts;
  }

  const parts = [];
  let buf = '';
  for (const sentence of sentences) {
    const next = buf ? `${buf} ${sentence}` : sentence;
    if (buf && wordCount(next) > MAX_WORDS_SOFT) {
      parts.push(buf);
      buf = sentence;
    } else {
      buf = next;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

/**
 * Optimize a counseling reply for WhatsApp.
 * @returns {{ reply: string, replyParts: string[] }}
 */
function optimizeCareerCounsellingReply(rawReply) {
  const cleaned = limitBulletsInBlock(stripFiller(rawReply));
  if (!cleaned) {
    return { reply: '', replyParts: [] };
  }

  // Split on blank lines first (natural message boundaries authors already use)
  const blocks = cleaned
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map(limitBulletsInBlock);

  const replyParts = [];
  for (const block of blocks) {
    for (const part of splitOversizedBlock(block)) {
      const trimmed = String(part || '').trim();
      if (trimmed) replyParts.push(trimmed);
    }
  }

  // Deduplicate consecutive identical parts
  const deduped = [];
  for (const part of replyParts) {
    if (deduped.length && deduped[deduped.length - 1] === part) continue;
    deduped.push(part);
  }

  return {
    reply: deduped.join('\n\n'),
    replyParts: deduped,
  };
}

module.exports = {
  MAX_WORDS_SOFT,
  MAX_WORDS_HARD,
  MAX_BULLETS,
  optimizeCareerCounsellingReply,
  wordCount,
  stripFiller,
};
