'use strict';

/**
 * WhatsApp response optimizer for Career Counselling V2.
 * Presentation only — does not change counseling logic or state.
 */

const MAX_WORDS_SOFT = 50;
const MAX_WORDS_HARD = 80;
const MAX_BULLETS = 4;
const MAX_LINES_NORMAL = 5;
/** Educational teaching turns (Phases 3–5) — idea → why → example → transition. */
const MAX_LINES_EDUCATIONAL = 10;

const FILLER_PATTERNS = [
  /\bbased on your (goals|profile|interests|preferences)\b[,.]?\s*/gi,
  /\bi understand your interests\b[,.]?\s*/gi,
  /\bthank you for (sharing that information|answering)\b[,.]?\s*/gi,
  // Whole-line only — never strip mid-sentence phrases like "what else matters".
  /^What would you like to know next\??\s*$/gim,
  /^Anything else\??\s*$/gim,
  /^What else\??\s*$/gim,
  /^How can I help\??\s*$/gim,
];

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function nonEmptyLines(text) {
  return String(text || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
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
  const bullets = lines.filter((l) => /^\s*[•✅\-*\d.]+\s+/.test(l));
  if (bullets.length <= MAX_BULLETS) return block;

  let kept = 0;
  const out = [];
  for (const line of lines) {
    if (/^\s*[•✅\-*\d.]+\s+/.test(line)) {
      kept += 1;
      if (kept <= MAX_BULLETS) out.push(line);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Hard-cap non-empty lines for counselor replies (keeps last question if present).
 */
function capLines(text, maxLines = MAX_LINES_NORMAL) {
  const lines = nonEmptyLines(text);
  if (lines.length <= maxLines) return lines.join('\n');

  const questionIdx = [...lines].map((l, i) => (/\?/.test(l) ? i : -1)).filter((i) => i >= 0);
  const lastQ = questionIdx.length ? lines[questionIdx[questionIdx.length - 1]] : null;
  const bodyBudget = lastQ ? maxLines - 1 : maxLines;
  const body = lines.filter((l) => l !== lastQ).slice(0, bodyBudget);
  if (lastQ && !body.includes(lastQ)) body.push(lastQ);
  return body.slice(0, maxLines).join('\n');
}

/**
 * Split a long block into sentence-ish chunks under the soft word target.
 */
function splitOversizedBlock(block) {
  const text = String(block || '').trim();
  if (!text) return [];
  if (wordCount(text) <= MAX_WORDS_HARD) return [text];

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
 * @param {string} rawReply
 * @param {{ allowExtendedPrediction?: boolean, skipLineCap?: boolean, educationalContent?: boolean, keepIntact?: boolean }} [opts]
 * @returns {{ reply: string, replyParts: string[] }}
 */
function optimizeCareerCounsellingReply(rawReply, opts = {}) {
  const keepIntact = Boolean(opts.keepIntact);
  const allowExtended = Boolean(opts.allowExtendedPrediction || opts.skipLineCap || keepIntact);
  const educational = Boolean(opts.educationalContent) && !allowExtended;
  const maxLines = educational ? MAX_LINES_EDUCATIONAL : MAX_LINES_NORMAL;

  // Stage 3 framework expand must stay one WhatsApp bubble — no bullet trim, no split.
  if (keepIntact) {
    const cleaned = stripFiller(rawReply);
    if (!cleaned) return { reply: '', replyParts: [] };
    return { reply: cleaned, replyParts: [cleaned] };
  }

  let cleaned = limitBulletsInBlock(stripFiller(rawReply));
  if (!cleaned) {
    return { reply: '', replyParts: [] };
  }

  if (!allowExtended) {
    cleaned = capLines(cleaned, maxLines);
  }

  const blocks = cleaned
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map(limitBulletsInBlock);

  const replyParts = [];
  for (const block of blocks) {
    if (!allowExtended) {
      const capped = capLines(block, maxLines);
      if (capped) replyParts.push(capped);
      continue;
    }
    for (const part of splitOversizedBlock(block)) {
      const trimmed = String(part || '').trim();
      if (trimmed) replyParts.push(trimmed);
    }
  }

  const deduped = [];
  for (const part of replyParts) {
    if (deduped.length && deduped[deduped.length - 1] === part) continue;
    deduped.push(part);
  }

  let reply = deduped.join('\n\n');
  if (!allowExtended) {
    reply = capLines(reply, maxLines);
  }

  return {
    reply,
    replyParts: allowExtended ? deduped : nonEmptyLines(reply).length ? [reply] : [],
  };
}

module.exports = {
  MAX_WORDS_SOFT,
  MAX_WORDS_HARD,
  MAX_BULLETS,
  MAX_LINES_NORMAL,
  MAX_LINES_EDUCATIONAL,
  optimizeCareerCounsellingReply,
  wordCount,
  stripFiller,
  capLines,
  nonEmptyLines,
};
