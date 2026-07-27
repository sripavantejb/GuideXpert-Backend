'use strict';

const { listExams, predictRank } = require('../rankPredictorService');

function getExamMap() {
  const rows = listExams();
  return Object.fromEntries(rows.map((e) => [e.id, e]));
}

const EXAM_ALIASES = [
  { id: 'jeemainmarks', patterns: [/\bjee\s*main\b(?!\s*percentile)/i, /\bjeemain\b/i, /\bjee\b/i] },
  { id: 'jeemainpercentile', patterns: [/\bjee\s*main\s*percentile\b/i, /\bpercentile\b/i] },
  { id: 'jeeadvanced', patterns: [/\bjee\s*advanced\b/i, /\badvanced\b/i] },
  { id: 'apeamcet', patterns: [/\bap\s*eamcet\b/i, /\bapeamcet\b/i] },
  { id: 'tseamcet', patterns: [/\bts\s*eamcet\b/i, /\btseamcet\b/i, /\btelangana\s*eamcet\b/i] },
  { id: 'kcet', patterns: [/\bkcet\b/i] },
  { id: 'keam', patterns: [/\bkeam\b/i] },
  { id: 'mhcet', patterns: [/\bmht\s*cet\b/i, /\bmhcet\b/i] },
  { id: 'tnea', patterns: [/\btnea\b/i] },
  { id: 'wbjee', patterns: [/\bwbjee\b/i] },
];

const DIFFICULTY_ALIASES = {
  easy: 'Easy',
  moderate: 'Moderate',
  difficult: 'Difficult',
  hard: 'Difficult',
};

function initialRankContext() {
  return { step: 'exam', examId: '', score: null, difficulty: '' };
}

function detectExamId(text) {
  const raw = String(text || '').trim();
  for (const row of EXAM_ALIASES) {
    if (row.patterns.some((p) => p.test(raw))) return row.id;
  }
  const exams = getExamMap();
  const lower = raw.toLowerCase();
  return Object.values(exams).find((e) => lower.includes(e.name.toLowerCase()))?.id || '';
}

function parseScore(text) {
  const m = String(text || '').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseDifficulty(text) {
  const t = String(text || '').trim().toLowerCase();
  for (const [key, value] of Object.entries(DIFFICULTY_ALIASES)) {
    if (t.includes(key)) return value;
  }
  return '';
}

function listExamOptions() {
  const exams = getExamMap();
  return Object.values(exams)
    .map((e) => `• ${e.name} (${e.minScore}–${e.maxScore})`)
    .join('\n');
}

function formatRankResult(result) {
  const range =
    result.range && typeof result.range === 'object'
      ? `${result.range.low}–${result.range.high}`
      : String(result.range || result.predictedValue || '—');
  return `Rank prediction for ${result.examName}:\n${result.metricLabel}: ${range}\n${result.message || ''}`.trim();
}

async function handleRankPredictorTurn(message, context = {}, opts = {}) {
  const isNew = Boolean(opts.isNewEntry);
  let ctx = isNew ? initialRankContext() : { ...initialRankContext(), ...context };
  const text = String(message || '').trim();

  if ((isNew || !ctx.examId) && !ctx.examId) {
    const detected = detectExamId(text);
    if (detected) ctx.examId = detected;
  }
  if ((isNew || ctx.score == null) && ctx.score == null) {
    const maybeScore = parseScore(text);
    if (maybeScore != null) ctx.score = maybeScore;
  }
  if ((isNew || !ctx.difficulty) && !ctx.difficulty) {
    const maybeDifficulty = parseDifficulty(text);
    if (maybeDifficulty) ctx.difficulty = maybeDifficulty;
  }

  if (ctx.examId && ctx.score != null) {
    ctx.step = getExamMap()[ctx.examId]?.mode === 'difficulty-map' && !ctx.difficulty ? 'difficulty' : 'ready';
  }

  if (ctx.step === 'exam' || !ctx.examId) {
    const examId = ctx.examId || detectExamId(text);
    if (!examId) {
      return {
        reply: `Which exam marks should I use?\n\n${listExamOptions()}`,
        context: { ...ctx, step: 'exam' },
        flow: 'rank_predictor',
      };
    }
    ctx.examId = examId;
    ctx.step = 'score';
  }

  const exam = getExamMap()[ctx.examId];
  if (!exam) {
    return {
      reply: `I didn't recognize that exam. Please choose one:\n\n${listExamOptions()}`,
      context: initialRankContext(),
      flow: 'rank_predictor',
    };
  }

  if (ctx.step === 'score' || ctx.score == null) {
    const score = ctx.score != null ? ctx.score : parseScore(text);
    if (score == null) {
      return {
        reply: `Enter your ${exam.name} score (${exam.minScore} to ${exam.maxScore}).`,
        context: { ...ctx, step: 'score', examId: ctx.examId },
        flow: 'rank_predictor',
      };
    }
    ctx.score = score;
    if (exam.mode === 'difficulty-map' && !ctx.difficulty) {
      ctx.step = 'difficulty';
    }
  }

  if (exam.mode === 'difficulty-map' && !ctx.difficulty) {
    const difficulty = parseDifficulty(text);
    if (!difficulty) {
      return {
        reply: 'For MHT CET, also tell me paper difficulty: Easy, Moderate, or Difficult.',
        context: { ...ctx, step: 'difficulty' },
        flow: 'rank_predictor',
      };
    }
    ctx.difficulty = difficulty;
  }

  try {
    const result = predictRank({
      examId: ctx.examId,
      score: ctx.score,
      options: ctx.difficulty ? { difficulty: ctx.difficulty } : {},
    });
    return {
      reply: formatRankResult(result),
      context: initialRankContext(),
      flow: 'idle',
      clearFlow: true,
      toolResult: { type: 'rank_predictor', data: result },
      quickReplies: ['Predict colleges', 'Compare colleges', 'Menu'],
    };
  } catch (error) {
    return {
      reply: error.message || 'Could not predict rank for that input. Try again with a valid score.',
      context: { ...ctx, step: 'score' },
      flow: 'rank_predictor',
    };
  }
}

module.exports = {
  handleRankPredictorTurn,
  initialRankContext,
  detectExamId,
};
