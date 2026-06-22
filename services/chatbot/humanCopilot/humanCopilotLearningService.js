'use strict';

const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const { TOPIC_RULES, extractEditTopic } = require('./humanCopilotTopicUtils');

const EDIT_PATTERN_RULES = Object.freeze([
  { key: 'added_explanations', label: 'Added explanations' },
  { key: 'more_details', label: 'More details' },
  { key: 'softened_wording', label: 'Softened wording' },
  { key: 'removed_incorrect', label: 'Removed incorrect statements' },
]);

const HEDGE_WORDS = ['maybe', 'may', 'recommend', 'consider', 'suggest'];

function parseSinceDays(sinceDays = 30) {
  const days = Math.min(Math.max(parseInt(sinceDays, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { days, since };
}

function baseMatch(since) {
  return { route: 'admin_pool', createdAt: { $gte: since } };
}

function buildMeta(sinceDays) {
  const { days, since } = parseSinceDays(sinceDays);
  return { sinceDays: days, since, generatedAt: new Date() };
}

function percent(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function levenshteinDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function normalizedEditRatio(suggested, finalText) {
  const a = String(suggested || '').trim();
  const b = String(finalText || '').trim();
  if (!a && !b) return 0;
  const distance = levenshteinDistance(a, b);
  const denom = Math.max(a.length, b.length, 1);
  return Math.round((distance / denom) * 1000) / 1000;
}

function classifyEditRatio(ratio) {
  if (ratio <= 0.1) return 'unchanged';
  if (ratio <= 0.3) return 'minor_edit';
  if (ratio <= 0.6) return 'moderate_edit';
  return 'major_rewrite';
}

function countSentences(text) {
  return String(text || '')
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function extractTokens(text) {
  return String(text || '').match(/\b[A-Z][a-z]+|\d+\b/g) || [];
}

function extractEditPatterns(suggested, finalText) {
  const s = String(suggested || '').trim();
  const f = String(finalText || '').trim();
  const patterns = [];

  if (f.length > s.length * 1.25) patterns.push('added_explanations');
  if (countSentences(f) > countSentences(s)) patterns.push('more_details');

  const suggestedLower = s.toLowerCase();
  const finalLower = f.toLowerCase();
  const addedHedge = HEDGE_WORDS.some(
    (word) => finalLower.includes(word) && !suggestedLower.includes(word)
  );
  if (addedHedge) patterns.push('softened_wording');

  if (s.length > f.length * 1.2) {
    const suggestedTokens = extractTokens(s);
    const finalTokens = new Set(extractTokens(f));
    const dropped = suggestedTokens.some((token) => !finalTokens.has(token));
    if (dropped) patterns.push('removed_incorrect');
  }

  return patterns;
}

function enrichReplyLearning({ suggestedText, draftText, replySource }) {
  const suggested = String(suggestedText || '').trim();
  const finalText = String(draftText || '').trim();
  const source = replySource || 'manual';

  if (source === 'manual' || !suggested) {
    return {
      editRatio: null,
      editClassification: 'manual',
      editTopic: extractEditTopic(finalText),
      editPatterns: [],
    };
  }

  if (source === 'ai_used') {
    return {
      editRatio: 0,
      editClassification: 'unchanged',
      editTopic: extractEditTopic(`${suggested} ${finalText}`),
      editPatterns: [],
    };
  }

  const editRatio = normalizedEditRatio(suggested, finalText);
  return {
    editRatio,
    editClassification: classifyEditRatio(editRatio),
    editTopic: extractEditTopic(`${suggested} ${finalText}`),
    editPatterns: extractEditPatterns(suggested, finalText),
  };
}

function resolveReplyLearning(reply) {
  if (!reply) {
    return {
      editRatio: null,
      editClassification: 'manual',
      editTopic: 'general',
      editPatterns: [],
    };
  }

  if (reply.editClassification != null) {
    return {
      editRatio: reply.editRatio ?? null,
      editClassification: reply.editClassification,
      editTopic: reply.editTopic || 'general',
      editPatterns: Array.isArray(reply.editPatterns) ? reply.editPatterns : [],
    };
  }

  return enrichReplyLearning({
    suggestedText: reply.suggestedText,
    draftText: reply.draftText,
    replySource: reply.replySource,
  });
}

function topicLabel(key) {
  const hit = TOPIC_RULES.find((rule) => rule.key === key);
  return hit?.label || 'General';
}

function patternLabel(key) {
  const hit = EDIT_PATTERN_RULES.find((rule) => rule.key === key);
  return hit?.label || key;
}

async function loadSentReplies(since) {
  const rows = await WhatsAppAgentHandoff.aggregate([
    { $match: baseMatch(since) },
    { $unwind: '$copilotReplies' },
    { $match: { 'copilotReplies.status': 'sent' } },
    {
      $project: {
        handoffId: '$_id',
        productLine: 1,
        reply: '$copilotReplies',
      },
    },
  ]);

  return rows.map((row) => {
    const learning = resolveReplyLearning(row.reply);
    return {
      handoffId: String(row.handoffId),
      productLine: row.productLine,
      replySource: row.reply.replySource || 'manual',
      suggestedText: row.reply.suggestedText || null,
      humanReply: row.reply.draftText || '',
      sentAt: row.reply.sentAt || row.reply.createdAt,
      ...learning,
    };
  });
}

async function getLearningOverview({ sinceDays = 30 } = {}) {
  const meta = buildMeta(sinceDays);
  const replies = await loadSentReplies(meta.since);
  const totalSent = replies.length;

  const sourceCounts = { ai_used: 0, ai_edited: 0, manual: 0 };
  const editBreakdown = {
    unchanged: 0,
    minorEdit: 0,
    moderateEdit: 0,
    majorRewrite: 0,
  };

  for (const reply of replies) {
    sourceCounts[reply.replySource] = (sourceCounts[reply.replySource] || 0) + 1;
    if (reply.editClassification === 'unchanged') editBreakdown.unchanged += 1;
    if (reply.editClassification === 'minor_edit') editBreakdown.minorEdit += 1;
    if (reply.editClassification === 'moderate_edit') editBreakdown.moderateEdit += 1;
    if (reply.editClassification === 'major_rewrite') editBreakdown.majorRewrite += 1;
  }

  return {
    meta,
    data: {
      totalSent,
      aiUsedPercent: percent(sourceCounts.ai_used, totalSent),
      aiEditedPercent: percent(sourceCounts.ai_edited, totalSent),
      manualPercent: percent(sourceCounts.manual, totalSent),
      editBreakdown,
    },
  };
}

async function getLearningEditPatterns({ sinceDays = 30 } = {}) {
  const meta = buildMeta(sinceDays);
  const replies = await loadSentReplies(meta.since).then((rows) =>
    rows.filter((row) => row.replySource === 'ai_edited')
  );

  const counts = {};
  for (const reply of replies) {
    for (const pattern of reply.editPatterns || []) {
      counts[pattern] = (counts[pattern] || 0) + 1;
    }
  }

  const patterns = EDIT_PATTERN_RULES.map((rule) => ({
    key: rule.key,
    label: rule.label,
    count: counts[rule.key] || 0,
  }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  return { meta, data: { patterns } };
}

async function getLearningTopics({ sinceDays = 30 } = {}) {
  const meta = buildMeta(sinceDays);
  const replies = await loadSentReplies(meta.since);

  const topicMap = {};
  for (const reply of replies) {
    const key = reply.editTopic || 'general';
    if (!topicMap[key]) topicMap[key] = { count: 0, editCount: 0 };
    topicMap[key].count += 1;
    if (reply.replySource === 'ai_edited') topicMap[key].editCount += 1;
  }

  const topics = Object.entries(topicMap)
    .map(([key, stats]) => ({
      key,
      label: topicLabel(key),
      count: stats.count,
      editCount: stats.editCount,
    }))
    .sort((a, b) => b.editCount - a.editCount || b.count - a.count);

  return { meta, data: { topics } };
}

async function getLearningExamples({ sinceDays = 30, limit = 20 } = {}) {
  const meta = buildMeta(sinceDays);
  const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
  const replies = await loadSentReplies(meta.since).then((rows) =>
    rows
      .filter((row) => row.suggestedText || row.replySource !== 'manual')
      .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0))
      .slice(0, cappedLimit)
  );

  return {
    meta,
    data: {
      examples: replies.map((row) => ({
        handoffId: row.handoffId,
        productLine: row.productLine,
        replySource: row.replySource,
        suggestedText: row.suggestedText,
        humanReply: row.humanReply,
        editClassification: row.editClassification,
        editRatio: row.editRatio,
        editTopic: row.editTopic,
        editPatterns: row.editPatterns,
        sentAt: row.sentAt,
      })),
    },
  };
}

module.exports = {
  TOPIC_RULES,
  EDIT_PATTERN_RULES,
  parseSinceDays,
  normalizedEditRatio,
  classifyEditRatio,
  extractEditTopic,
  extractEditPatterns,
  enrichReplyLearning,
  resolveReplyLearning,
  getLearningOverview,
  getLearningEditPatterns,
  getLearningTopics,
  getLearningExamples,
  topicLabel,
  patternLabel,
};
