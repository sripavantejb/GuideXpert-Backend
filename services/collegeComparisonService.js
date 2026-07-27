'use strict';

const { COLLEGE_COMPARISON_CATALOG } = require('../data/collegeComparisonCatalog');
const { OpenAiCompatibleProvider } = require('./ai/providers/OpenAiCompatibleProvider');
const {
  buildCollegeComparisonSystemPrompt,
} = require('./ai/prompts/collegeComparison.system');

const provider = new OpenAiCompatibleProvider();
const DEFAULT_SEARCH_LIMIT = 8;
const SUMMARY_MAX_TOKENS = Number(process.env.COLLEGE_COMPARISON_SUMMARY_MAX_TOKENS) || 220;
const SUMMARY_TIMEOUT_MS = Number(process.env.COLLEGE_COMPARISON_SUMMARY_TIMEOUT_MS) || 10000;

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildSearchText(college) {
  return unique([college.name, college.shortName, ...(college.aliases || [])]).join(' ');
}

function scoreMatch(college, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;
  const haystack = normalizeText(buildSearchText(college));
  if (!haystack) return 0;
  if (haystack === normalizedQuery) return 100;
  if (haystack.startsWith(normalizedQuery)) return 90;
  if (haystack.includes(normalizedQuery)) return 70;
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return matched ? matched * 10 : 0;
}

function searchCollegeComparisonCatalog(query, limit = DEFAULT_SEARCH_LIMIT) {
  const normalizedQuery = String(query || '').trim();
  const max = Math.min(Math.max(Number(limit) || DEFAULT_SEARCH_LIMIT, 1), 20);
  const baseList = COLLEGE_COMPARISON_CATALOG.map((college) => ({
    id: college.id,
    name: college.name,
    shortName: college.shortName,
    city: college.city,
    state: college.state,
    ownership: college.ownership,
    rankingLabel: college.rankingLabel,
  }));

  if (!normalizedQuery) {
    return baseList.slice(0, max);
  }

  return COLLEGE_COMPARISON_CATALOG
    .map((college) => ({ college, score: scoreMatch(college, normalizedQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.college.name.localeCompare(b.college.name))
    .slice(0, max)
    .map(({ college }) => ({
      id: college.id,
      name: college.name,
      shortName: college.shortName,
      city: college.city,
      state: college.state,
      ownership: college.ownership,
      rankingLabel: college.rankingLabel,
    }));
}

function getCollegeByIdOrName(value) {
  const needle = normalizeText(value);
  if (!needle) return null;
  return (
    COLLEGE_COMPARISON_CATALOG.find((college) => college.id === value) ||
    COLLEGE_COMPARISON_CATALOG.find((college) => {
      const options = unique([college.id, college.name, college.shortName, ...(college.aliases || [])]);
      return options.some((option) => normalizeText(option) === needle);
    }) ||
    null
  );
}

function formatMoneyLabel(value) {
  if (!Number.isFinite(value)) return null;
  return `₹${value.toFixed(1)}L`;
}

function numericRow(metric, aValue, bValue, formatter, preference = 'higher') {
  const hasA = Number.isFinite(aValue);
  const hasB = Number.isFinite(bValue);
  let better = 'tie';
  if (hasA && hasB && aValue !== bValue) {
    if (preference === 'lower') {
      better = aValue < bValue ? 'a' : 'b';
    } else {
      better = aValue > bValue ? 'a' : 'b';
    }
  }
  return {
    metric,
    aValue: hasA ? formatter(aValue) : 'Not available',
    bValue: hasB ? formatter(bValue) : 'Not available',
    better,
  };
}

function textRow(metric, aValue, bValue) {
  return {
    metric,
    aValue: aValue || 'Not available',
    bValue: bValue || 'Not available',
    better: aValue && bValue && aValue === bValue ? 'tie' : 'neutral',
  };
}

function buildOverview(college) {
  return {
    id: college.id,
    name: college.name,
    shortName: college.shortName,
    city: college.city,
    state: college.state,
    ownership: college.ownership,
    approvals: college.approvals,
    rankingLabel: college.rankingLabel,
    averagePackageLabel: college.averagePackageLabel,
    placementRateLabel: college.placementRateLabel,
    annualFeesLabel: college.annualFeesLabel,
    roiLabel: college.roiLabel,
    campusSizeLabel: college.campusSizeLabel,
    branchCount: college.branchCount,
    flagshipBranches: college.flagshipBranches,
    highlights: college.highlights,
  };
}

function buildWinnerSummary(aCollege, bCollege) {
  const winners = [];
  if (aCollege.averagePackageValue !== bCollege.averagePackageValue) {
    winners.push({
      metric: 'Average package',
      winner: aCollege.averagePackageValue > bCollege.averagePackageValue ? 'a' : 'b',
    });
  }
  if (aCollege.placementRateValue !== bCollege.placementRateValue) {
    winners.push({
      metric: 'Placement rate',
      winner: aCollege.placementRateValue > bCollege.placementRateValue ? 'a' : 'b',
    });
  }
  if (aCollege.annualFeesValue !== bCollege.annualFeesValue) {
    winners.push({
      metric: 'Annual fees',
      winner: aCollege.annualFeesValue < bCollege.annualFeesValue ? 'a' : 'b',
    });
  }
  if (aCollege.roiScore !== bCollege.roiScore) {
    winners.push({
      metric: 'ROI',
      winner: aCollege.roiScore > bCollege.roiScore ? 'a' : 'b',
    });
  }
  if (aCollege.rankingScore !== bCollege.rankingScore) {
    winners.push({
      metric: 'Ranking',
      winner: aCollege.rankingScore > bCollege.rankingScore ? 'a' : 'b',
    });
  }
  return winners;
}

function buildComparisonPayload(aCollege, bCollege) {
  const rows = [
    numericRow(
      'Average package',
      aCollege.averagePackageValue,
      bCollege.averagePackageValue,
      (value) => `${value.toFixed(1)} LPA`
    ),
    numericRow(
      'Placement rate',
      aCollege.placementRateValue,
      bCollege.placementRateValue,
      (value) => `${Math.round(value)}%`
    ),
    numericRow(
      'Annual fees',
      aCollege.annualFeesValue,
      bCollege.annualFeesValue,
      (value) => `${formatMoneyLabel(value)} / yr`,
      'lower'
    ),
    numericRow('ROI score', aCollege.roiScore, bCollege.roiScore, (value) => `${Math.round(value)}/100`),
    numericRow(
      'Branch breadth',
      aCollege.branchCount,
      bCollege.branchCount,
      (value) => `${Math.round(value)} core options`
    ),
    textRow('Ranking signal', aCollege.rankingLabel, bCollege.rankingLabel),
    textRow('Location', `${aCollege.city}, ${aCollege.state}`, `${bCollege.city}, ${bCollege.state}`),
    textRow('Approvals', aCollege.approvals.join(' · '), bCollege.approvals.join(' · ')),
  ];

  return {
    institutionA: buildOverview(aCollege),
    institutionB: buildOverview(bCollege),
    rows,
    keyHighlights: {
      institutionA: aCollege.highlights,
      institutionB: bCollege.highlights,
    },
    winners: buildWinnerSummary(aCollege, bCollege),
  };
}

async function generateComparisonSummary(comparison) {
  const apiKey = String(process.env.LLM_API_KEY || '').trim();
  const baseURL = String(process.env.LLM_BASE_URL || '').trim();
  const model = String(process.env.LLM_MODEL || '').trim();
  if (!apiKey || !baseURL || !model) return null;

  const promptPayload = {
    institutionA: comparison.institutionA,
    institutionB: comparison.institutionB,
    rows: comparison.rows,
    winners: comparison.winners,
  };

  try {
    const result = await provider.chatCompletion({
      messages: [
        { role: 'system', content: buildCollegeComparisonSystemPrompt() },
        { role: 'user', content: JSON.stringify(promptPayload) },
      ],
      temperature: 0.2,
      maxTokens: SUMMARY_MAX_TOKENS,
      timeoutMs: SUMMARY_TIMEOUT_MS,
      maxRetries: 0,
    });
    const text = String(result?.text || '').trim();
    return text || null;
  } catch (error) {
    console.warn('[college-comparison] summary failed:', error.message);
    return null;
  }
}

async function compareCollegeProfiles({
  collegeAId,
  collegeBId,
  collegeAName,
  collegeBName,
  includeSummary = false,
} = {}) {
  const institutionA = getCollegeByIdOrName(collegeAId || collegeAName);
  const institutionB = getCollegeByIdOrName(collegeBId || collegeBName);

  if (!institutionA || !institutionB) {
    const missing = !institutionA ? 'institutionA' : 'institutionB';
    const error = new Error(`${missing} was not found in the comparison catalog`);
    error.status = 404;
    error.code = 'COLLEGE_NOT_FOUND';
    throw error;
  }
  if (institutionA.id === institutionB.id) {
    const error = new Error('Select two different colleges to compare');
    error.status = 400;
    error.code = 'SAME_COLLEGE';
    throw error;
  }

  const comparison = buildComparisonPayload(institutionA, institutionB);
  if (includeSummary) {
    comparison.summary = await generateComparisonSummary(comparison);
  }
  return comparison;
}

module.exports = {
  searchCollegeComparisonCatalog,
  compareCollegeProfiles,
};
