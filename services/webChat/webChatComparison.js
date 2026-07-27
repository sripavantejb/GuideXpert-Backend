'use strict';

const { compareColleges } = require('../collegeComparisonService');
const {
  looksLikeCollegeName,
  looksLikeCollegePair,
  parseCollegePair,
  isCompareEntryPhrase,
  normalizeText,
} = require('./webChatIntent');

function initialComparisonContext() {
  return { step: 'collegeA', collegeAName: '', collegeBName: '' };
}

function summarizeComparison(result) {
  const a = result.institutionA?.name || result.collegeA?.name || 'College A';
  const b = result.institutionB?.name || result.collegeB?.name || 'College B';
  const counts = result.winnerSummary?.counts || { A: 0, B: 0, tie: 0 };
  const lines = (result.rows || []).slice(0, 6).map((row) => {
    const winner =
      row.better === 'a' ? a : row.better === 'b' ? b : row.winner === 'A' ? a : row.winner === 'B' ? b : 'Similar';
    return `• ${row.metric || row.label}: ${row.aValue || row.valueA} vs ${row.bValue || row.valueB} → ${winner}`;
  });
  return `Comparison: ${a} vs ${b}\nMetric wins — ${a}: ${counts.A || 0}, ${b}: ${counts.B || 0}\n\n${lines.join('\n')}\n\nOpen College Comparison for the full table.`;
}

function rejectAsCollegeReply(ctx, reason) {
  const base =
    ctx.step === 'collegeB' && ctx.collegeAName
      ? `First college: ${ctx.collegeAName}.\nWhich college should I compare it with?`
      : 'Which is the first college? (You can also type "VIT vs SRM")';
  return {
    reply: `${reason}\n\n${base}`,
    context: ctx,
    flow: 'college_comparison',
    quickReplies: ['Cancel', 'Menu', 'IIIT Hyderabad vs NIT Trichy'],
  };
}

/**
 * @param {string} message
 * @param {object} context
 * @param {object} identity
 * @param {{ isNewEntry?: boolean, pair?: { collegeAName: string, collegeBName: string }|null }} [opts]
 */
async function handleComparisonTurn(message, context = {}, identity = {}, opts = {}) {
  const isNew = Boolean(opts.isNewEntry);
  let ctx = isNew ? initialComparisonContext() : { ...initialComparisonContext(), ...context };
  const text = normalizeText(message);

  // Fresh entry: ask for colleges; never treat the trigger phrase as a name.
  if (isNew && (!text || isCompareEntryPhrase(text))) {
    return {
      reply: 'Sure — let’s compare two colleges.\nWhich is the first college? (Or type "VIT vs SRM")',
      context: initialComparisonContext(),
      flow: 'college_comparison',
      quickReplies: ['Cancel', 'Menu', 'IIIT Hyderabad vs NIT Trichy'],
    };
  }

  const pairFromOpts = opts.pair && opts.pair.collegeAName && opts.pair.collegeBName ? opts.pair : null;
  const pair = pairFromOpts || (looksLikeCollegePair(text) ? parseCollegePair(text) : null);

  if (pair?.collegeAName && pair?.collegeBName) {
    if (!looksLikeCollegeName(pair.collegeAName) || !looksLikeCollegeName(pair.collegeBName)) {
      return rejectAsCollegeReply(
        ctx,
        'I need two real college names to compare (for example "IIIT Hyderabad vs NIT Trichy").'
      );
    }
    ctx.collegeAName = pair.collegeAName;
    ctx.collegeBName = pair.collegeBName;
    ctx.step = 'ready';
  } else if (ctx.step === 'collegeA') {
    if (!text) {
      return {
        reply: 'Which is the first college? (You can also type "VIT vs SRM")',
        context: ctx,
        flow: 'college_comparison',
        quickReplies: ['Cancel', 'Menu'],
      };
    }
    if (!looksLikeCollegeName(text)) {
      return rejectAsCollegeReply(
        ctx,
        'That doesn’t look like a college name. Send an institute name, or say "cancel" / "menu".'
      );
    }
    ctx.collegeAName = text;
    ctx.step = 'collegeB';
    return {
      reply: `Got it — first college: ${ctx.collegeAName}.\nNow tell me the second college.`,
      context: ctx,
      flow: 'college_comparison',
      quickReplies: ['Cancel', 'Menu'],
    };
  } else if (ctx.step === 'collegeB') {
    if (!text) {
      return {
        reply: `First college: ${ctx.collegeAName}.\nWhich college should I compare it with?`,
        context: { ...ctx, step: 'collegeB' },
        flow: 'college_comparison',
        quickReplies: ['Cancel', 'Menu'],
      };
    }
    if (!looksLikeCollegeName(text)) {
      return rejectAsCollegeReply(
        { ...ctx, step: 'collegeB' },
        'That doesn’t look like a college name. Send the second institute, or say "cancel" / "menu".'
      );
    }
    ctx.collegeBName = text;
    ctx.step = 'ready';
  }

  if (ctx.step === 'collegeA' && !ctx.collegeAName) {
    return {
      reply: 'Which is the first college? (You can also type "VIT vs SRM")',
      context: ctx,
      flow: 'college_comparison',
      quickReplies: ['Cancel', 'Menu'],
    };
  }

  if (ctx.step === 'collegeB' && !ctx.collegeBName) {
    return {
      reply: `First college: ${ctx.collegeAName}.\nWhich college should I compare it with?`,
      context: { ...ctx, step: 'collegeB' },
      flow: 'college_comparison',
      quickReplies: ['Cancel', 'Menu'],
    };
  }

  try {
    const result = await compareColleges({
      collegeAName: ctx.collegeAName,
      collegeBName: ctx.collegeBName,
      includeSummary: false,
      phone: identity.phone || '',
      fullName: identity.fullName || '',
    });
    return {
      reply: summarizeComparison(result),
      context: initialComparisonContext(),
      flow: 'idle',
      clearFlow: true,
      toolResult: { type: 'college_comparison', data: result },
      quickReplies: ['Predict colleges', 'Predict rank', 'Menu'],
    };
  } catch (error) {
    return {
      reply:
        error.message ||
        'Could not compare those colleges. Try full names like "IIIT Hyderabad vs NIT Trichy".',
      context: initialComparisonContext(),
      flow: 'college_comparison',
      quickReplies: ['Cancel', 'Menu', 'IIIT Hyderabad vs NIT Trichy'],
    };
  }
}

module.exports = {
  handleComparisonTurn,
  initialComparisonContext,
};
