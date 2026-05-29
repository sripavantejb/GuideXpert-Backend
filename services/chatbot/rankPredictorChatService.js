const { predictRank, listExams } = require('../rankPredictorService');
const { normalizeText } = require('./intentClassifierService');

const EXAM_ALIASES = {
  jee: 'jeemainmarks',
  'jee main': 'jeemainmarks',
  jeeadvanced: 'jeeadvanced',
  'jee advanced': 'jeeadvanced',
  kcet: 'kcet',
  keam: 'keam',
  eamcet: 'apeamcet',
  'ap eamcet': 'apeamcet',
  tnea: 'tnea',
  wbjee: 'wbjee',
  mhtcet: 'mhcet',
};

function listExamsMessage() {
  const exams = listExams();
  const names = exams.map((e) => e.name).join(', ');
  return `Supported exams: ${names}.\n\nReply with exam and score, e.g. "JEE Main 85" or "KCET 120".`;
}

function parseExamAndScore(text, context = {}) {
  const t = normalizeText(text);
  if (context.examId && !Number.isNaN(Number(t))) {
    return { examId: context.examId, score: Number(t) };
  }

  for (const [alias, examId] of Object.entries(EXAM_ALIASES)) {
    if (t.includes(alias)) {
      const nums = t.match(/-?\d+(\.\d+)?/g);
      if (nums && nums.length) {
        return { examId, score: Number(nums[0]) };
      }
      return { examId, score: null };
    }
  }

  const nums = t.match(/-?\d+(\.\d+)?/g);
  if (nums && nums.length === 1 && context.examId) {
    return { examId: context.examId, score: Number(nums[0]) };
  }

  return { examId: null, score: null };
}

function handleRankPredictorMessage(text, context = {}) {
  if (!context.examId && normalizeText(text) === 'list') {
    return { reply: listExamsMessage(), context: { step: 'awaiting_exam_score' } };
  }

  const parsed = parseExamAndScore(text, context);
  if (!parsed.examId) {
    return {
      reply:
        'Which exam? Examples: JEE Main, JEE Advanced, KCET, KEAM, AP EAMCET.\nThen send your score on the next message.',
      context: { step: 'awaiting_exam_score' },
    };
  }
  if (parsed.score == null || Number.isNaN(parsed.score)) {
    return {
      reply: `Send your ${parsed.examId} score as a number (e.g. 85).`,
      context: { step: 'awaiting_score', examId: parsed.examId },
    };
  }

  try {
    const result = predictRank({ examId: parsed.examId, score: parsed.score });
    const msg = [
      `Prediction for ${result.examName || parsed.examId}:`,
      `${result.metricLabel || 'Result'}: ${result.predictedValue ?? result.message ?? '—'}`,
      result.range ? `Range: ${result.range}` : null,
      '\nReply MENU for main menu.',
    ]
      .filter(Boolean)
      .join('\n');
    return { reply: msg, context: { step: 'done' } };
  } catch (e) {
    return {
      reply: e.message || 'Could not predict for that score. Please check the allowed score range.',
      context: { step: 'awaiting_exam_score', examId: parsed.examId },
    };
  }
}

module.exports = {
  listExamsMessage,
  handleRankPredictorMessage,
};
