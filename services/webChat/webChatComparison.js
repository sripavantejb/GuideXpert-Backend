'use strict';

const { compareColleges } = require('../collegeComparisonService');

function initialComparisonContext() {
  return { step: 'collegeA', collegeAName: '', collegeBName: '' };
}

function parseComparisonPair(text) {
  const raw = String(text || '').trim();
  const vsMatch = raw.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i);
  if (vsMatch) {
    return { collegeAName: vsMatch[1].trim(), collegeBName: vsMatch[2].trim() };
  }
  return null;
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

async function handleComparisonTurn(message, context = {}, identity = {}) {
  let ctx = { ...initialComparisonContext(), ...context };
  const text = String(message || '').trim();
  const pair = parseComparisonPair(text);

  if (pair?.collegeAName && pair?.collegeBName) {
    ctx.collegeAName = pair.collegeAName;
    ctx.collegeBName = pair.collegeBName;
    ctx.step = 'ready';
  } else if (ctx.step === 'collegeA' && text) {
    ctx.collegeAName = text;
    ctx.step = 'collegeB';
    return {
      reply: `Got it — first college: ${ctx.collegeAName}.\nNow tell me the second college.`,
      context: ctx,
      flow: 'college_comparison',
    };
  } else if (ctx.step === 'collegeB' && text) {
    ctx.collegeBName = text;
    ctx.step = 'ready';
  }

  if (ctx.step === 'collegeA' && !ctx.collegeAName) {
    return {
      reply: 'Which is the first college? (You can also type "VIT vs SRM")',
      context: ctx,
      flow: 'college_comparison',
    };
  }

  if (ctx.step === 'collegeB' && !ctx.collegeBName) {
    return {
      reply: `First college: ${ctx.collegeAName}.\nWhich college should I compare it with?`,
      context: { ...ctx, step: 'collegeB' },
      flow: 'college_comparison',
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
      reply: error.message || 'Could not compare those colleges. Try full names like "IIIT Hyderabad vs NIT Trichy".',
      context: initialComparisonContext(),
      flow: 'college_comparison',
    };
  }
}

module.exports = {
  handleComparisonTurn,
  initialComparisonContext,
};
