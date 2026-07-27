'use strict';

const crypto = require('crypto');
const { COLLEGE_COMPARISON_CATALOG } = require('../data/collegeComparisonCatalog');
const CollegeComparisonProfile = require('../models/CollegeComparisonProfile');
const CollegeComparisonSearchEvent = require('../models/CollegeComparisonSearchEvent');
const { chatCompletion } = require('./ai/llmClient');
const { buildCollegeComparisonSystemPrompt } = require('./ai/prompts/collegeComparison.system');
const {
  buildCollegeComparisonProfileSystemPrompt,
} = require('./ai/prompts/collegeComparisonProfile.system');

const MAX_SEARCH_RESULTS = 40;
const PROFILE_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.COLLEGE_COMPARISON_PROFILE_TIMEOUT_MS) || 18000
);
const PROFILE_MAX_TOKENS = Math.max(
  220,
  Number(process.env.COLLEGE_COMPARISON_PROFILE_MAX_TOKENS) || 420
);

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function slugifyCollegeKey(name) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (base) return `ft-${base}`;
  const hash = crypto.createHash('sha1').update(String(name || '')).digest('hex').slice(0, 10);
  return `ft-${hash}`;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toPublicCollege(college) {
  return {
    id: college.id,
    name: college.name,
    shortName: college.shortName,
    city: college.city,
    state: college.state,
    ownership: college.ownership,
    approvals: college.approvals || [],
    rankingLabel: college.rankingLabel,
    averagePackageLabel: college.averagePackageLabel,
    placementRateLabel: college.placementRateLabel,
    annualFeesLabel: college.annualFeesLabel,
    roiLabel: college.roiLabel,
    campusSizeLabel: college.campusSizeLabel,
    branchCount: college.branchCount,
    flagshipBranches: college.flagshipBranches || [],
    highlights: college.highlights || [],
    source: college.source || 'catalog',
  };
}

function profileDocToCollege(doc) {
  if (!doc) return null;
  return {
    id: doc.key,
    name: doc.name,
    aliases: Array.isArray(doc.aliases) ? doc.aliases : [],
    shortName: doc.shortName || doc.name,
    city: doc.city || 'Unknown',
    state: doc.state || 'Unknown',
    ownership: doc.ownership || 'Private',
    approvals: Array.isArray(doc.approvals) ? doc.approvals : [],
    rankingLabel: doc.rankingLabel || 'Not available',
    rankingScore: Number(doc.rankingScore) || 50,
    averagePackageLabel: doc.averagePackageLabel || 'Not available',
    averagePackageValue: doc.averagePackageValue,
    placementRateLabel: doc.placementRateLabel || 'Not available',
    placementRateValue: doc.placementRateValue,
    annualFeesLabel: doc.annualFeesLabel || 'Not available',
    annualFeesValue: doc.annualFeesValue,
    roiLabel: doc.roiLabel || 'Not available',
    roiScore: Number(doc.roiScore) || 50,
    campusSizeLabel: doc.campusSizeLabel || 'Not available',
    campusSizeScore: Number(doc.campusSizeScore) || 50,
    branchCount: Number(doc.branchCount) || 0,
    flagshipBranches: Array.isArray(doc.flagshipBranches) ? doc.flagshipBranches : [],
    highlights: Array.isArray(doc.highlights) ? doc.highlights : [],
    source: doc.source || 'ai_free_text',
  };
}

function listCatalogColleges() {
  return COLLEGE_COMPARISON_CATALOG.map(toPublicCollege);
}

async function listCachedProfileColleges(limit = 80) {
  try {
    const docs = await CollegeComparisonProfile.find({})
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    return docs.map(profileDocToCollege).filter(Boolean);
  } catch {
    return [];
  }
}

async function getCollegeComparisonOptions() {
  const cached = await listCachedProfileColleges(100);
  const byId = new Map();
  for (const college of [...listCatalogColleges(), ...cached]) {
    if (!byId.has(college.id)) byId.set(college.id, college);
  }
  return {
    colleges: Array.from(byId.values()),
    allowFreeText: true,
    metrics: [
      { key: 'ranking', label: 'Ranking signal' },
      { key: 'averagePackage', label: 'Average package' },
      { key: 'placementRate', label: 'Placement rate' },
      { key: 'annualFees', label: 'Annual fees' },
      { key: 'roi', label: 'ROI signal' },
      { key: 'campusSize', label: 'Campus size' },
      { key: 'branchCount', label: 'Branch depth' },
      { key: 'location', label: 'Location' },
      { key: 'ownership', label: 'Ownership' },
      { key: 'approvals', label: 'Approvals / recognition' },
    ],
  };
}

function scoreCollegeMatch(college, query) {
  const q = normalizeSearchText(query);
  if (!q) return 0;
  const name = normalizeSearchText(college.name);
  const shortName = normalizeSearchText(college.shortName);
  const aliases = (college.aliases || []).map(normalizeSearchText);
  const haystack = [name, shortName, ...aliases, normalizeSearchText(`${college.city} ${college.state}`)];

  if (haystack.some((part) => part === q)) return 100;
  if (haystack.some((part) => part.startsWith(q))) return 90;
  if (haystack.some((part) => part.includes(q))) return 75;

  const tokens = q.split(' ').filter(Boolean);
  const tokenHits = tokens.filter((token) => haystack.some((part) => part.includes(token))).length;
  if (!tokenHits) return 0;
  return Math.round((tokenHits / tokens.length) * 60);
}

async function searchCollegesForComparison(query, limit = 12) {
  const capped = Math.min(Math.max(Number(limit) || 12, 1), MAX_SEARCH_RESULTS);
  const q = String(query || '').trim();
  const cached = await listCachedProfileColleges(120);
  const pool = [...COLLEGE_COMPARISON_CATALOG, ...cached];

  if (!q) {
    return pool.slice(0, capped).map(toPublicCollege);
  }

  return pool
    .map((college) => ({ college, score: scoreCollegeMatch(college, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.college.name.localeCompare(b.college.name))
    .slice(0, capped)
    .map((row) => toPublicCollege(row.college));
}

function findExactCatalogMatch(raw) {
  const q = normalizeSearchText(raw);
  if (!q) return null;
  return (
    COLLEGE_COMPARISON_CATALOG.find((college) => {
      const aliases = [college.name, college.shortName, ...(college.aliases || [])].map(normalizeSearchText);
      return aliases.includes(q);
    }) || null
  );
}

async function findCachedProfileByNameOrId(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const key = slugifyCollegeKey(text);
  try {
    const byKey = await CollegeComparisonProfile.findOne({ key }).lean();
    if (byKey) return profileDocToCollege(byKey);

    const q = normalizeSearchText(text);
    const docs = await CollegeComparisonProfile.find({}).limit(200).lean();
    const hit = docs.find((doc) => {
      const names = [doc.name, doc.shortName, ...(doc.aliases || [])].map(normalizeSearchText);
      return names.includes(q) || names.some((n) => n && (n.includes(q) || q.includes(n)));
    });
    return profileDocToCollege(hit);
  } catch {
    return null;
  }
}

function clampScore(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function sanitizeProfilePayload(raw, fallbackName) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const name = String(src.name || fallbackName || '').trim().slice(0, 200) || fallbackName;
  return {
    name,
    shortName: String(src.shortName || name).trim().slice(0, 80) || name,
    city: String(src.city || 'Unknown').trim().slice(0, 80) || 'Unknown',
    state: String(src.state || 'Unknown').trim().slice(0, 80) || 'Unknown',
    ownership: String(src.ownership || 'Private').trim().slice(0, 80) || 'Private',
    approvals: Array.isArray(src.approvals)
      ? src.approvals.map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
      : [],
    rankingLabel: String(src.rankingLabel || 'Not available').trim().slice(0, 120) || 'Not available',
    rankingScore: clampScore(src.rankingScore, 50),
    averagePackageLabel:
      String(src.averagePackageLabel || 'Not available').trim().slice(0, 120) || 'Not available',
    averagePackageValue:
      src.averagePackageValue == null || src.averagePackageValue === ''
        ? null
        : Number(src.averagePackageValue),
    placementRateLabel:
      String(src.placementRateLabel || 'Not available').trim().slice(0, 120) || 'Not available',
    placementRateValue:
      src.placementRateValue == null || src.placementRateValue === ''
        ? null
        : Number(src.placementRateValue),
    annualFeesLabel: String(src.annualFeesLabel || 'Not available').trim().slice(0, 120) || 'Not available',
    annualFeesValue:
      src.annualFeesValue == null || src.annualFeesValue === '' ? null : Number(src.annualFeesValue),
    roiLabel: String(src.roiLabel || 'Not available').trim().slice(0, 120) || 'Not available',
    roiScore: clampScore(src.roiScore, 50),
    campusSizeLabel: String(src.campusSizeLabel || 'Not available').trim().slice(0, 120) || 'Not available',
    campusSizeScore: clampScore(src.campusSizeScore, 50),
    branchCount: Math.max(0, Number(src.branchCount) || 0),
    flagshipBranches: Array.isArray(src.flagshipBranches)
      ? src.flagshipBranches.map((x) => String(x).trim()).filter(Boolean).slice(0, 5)
      : [],
    highlights: Array.isArray(src.highlights)
      ? src.highlights.map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
      : [],
  };
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function buildFreeTextCollegeProfile(name) {
  const collegeName = String(name || '').trim().slice(0, 160);
  if (!collegeName) {
    const err = new Error('College name is required');
    err.statusCode = 400;
    throw err;
  }

  const completion = await chatCompletion({
    systemPrompt: buildCollegeComparisonProfileSystemPrompt(),
    userPrompt: JSON.stringify({ collegeName }),
    temperature: 0.1,
    maxTokens: PROFILE_MAX_TOKENS,
    timeoutMs: PROFILE_TIMEOUT_MS,
  });

  const parsed = parseJsonObject(completion.content);
  if (!parsed) {
    const err = new Error('Could not build free-text college profile. Try again.');
    err.statusCode = 502;
    throw err;
  }

  const sanitized = sanitizeProfilePayload(parsed, collegeName);
  const key = slugifyCollegeKey(collegeName);
  const aliases = Array.from(
    new Set([collegeName, sanitized.name, sanitized.shortName].map((x) => String(x).trim()).filter(Boolean))
  );

  try {
    await CollegeComparisonProfile.findOneAndUpdate(
      { key },
      {
        $set: {
          key,
          ...sanitized,
          aliases,
          source: 'ai_free_text',
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
  } catch {
    // Cache write is best-effort; comparison can still proceed.
  }

  return {
    id: key,
    ...sanitized,
    aliases,
    source: 'ai_free_text',
  };
}

async function resolveCollegeRef(ref) {
  if (!ref || typeof ref !== 'object') return { college: null, freeText: false };

  const id = String(ref.id || '').trim();
  const name = String(ref.name || '').trim();

  if (id) {
    const fromCatalog = COLLEGE_COMPARISON_CATALOG.find((c) => c.id === id);
    if (fromCatalog) return { college: fromCatalog, freeText: false };
    const cached = await findCachedProfileByNameOrId(id);
    if (cached) return { college: cached, freeText: cached.source === 'ai_free_text' };
  }

  if (name) {
    const exact = findExactCatalogMatch(name);
    if (exact) return { college: exact, freeText: false };
    const cached = await findCachedProfileByNameOrId(name);
    if (cached) return { college: cached, freeText: cached.source === 'ai_free_text' };
    const built = await buildFreeTextCollegeProfile(name);
    return { college: built, freeText: true };
  }

  return { college: null, freeText: false };
}

function compareNumeric(a, b, higherIsBetter = true) {
  if (a == null || b == null || Number.isNaN(Number(a)) || Number.isNaN(Number(b))) {
    return { winner: 'tie', reason: 'Comparable public signal not available for both.' };
  }
  const left = Number(a);
  const right = Number(b);
  if (left === right) return { winner: 'tie', reason: 'Values are effectively similar.' };
  if (higherIsBetter) {
    return left > right
      ? { winner: 'A', reason: 'Higher reported signal.' }
      : { winner: 'B', reason: 'Higher reported signal.' };
  }
  return left < right
    ? { winner: 'A', reason: 'Lower reported cost signal.' }
    : { winner: 'B', reason: 'Lower reported cost signal.' };
}

function buildRows(collegeA, collegeB) {
  return [
    {
      key: 'ranking',
      label: 'Ranking signal',
      valueA: collegeA.rankingLabel,
      valueB: collegeB.rankingLabel,
      ...compareNumeric(collegeA.rankingScore, collegeB.rankingScore, true),
    },
    {
      key: 'averagePackage',
      label: 'Average package',
      valueA: collegeA.averagePackageLabel,
      valueB: collegeB.averagePackageLabel,
      ...compareNumeric(collegeA.averagePackageValue, collegeB.averagePackageValue, true),
    },
    {
      key: 'placementRate',
      label: 'Placement rate',
      valueA: collegeA.placementRateLabel,
      valueB: collegeB.placementRateLabel,
      ...compareNumeric(collegeA.placementRateValue, collegeB.placementRateValue, true),
    },
    {
      key: 'annualFees',
      label: 'Annual fees',
      valueA: collegeA.annualFeesLabel,
      valueB: collegeB.annualFeesLabel,
      ...compareNumeric(collegeA.annualFeesValue, collegeB.annualFeesValue, false),
    },
    {
      key: 'roi',
      label: 'ROI signal',
      valueA: collegeA.roiLabel,
      valueB: collegeB.roiLabel,
      ...compareNumeric(collegeA.roiScore, collegeB.roiScore, true),
    },
    {
      key: 'campusSize',
      label: 'Campus size',
      valueA: collegeA.campusSizeLabel,
      valueB: collegeB.campusSizeLabel,
      ...compareNumeric(collegeA.campusSizeScore, collegeB.campusSizeScore, true),
    },
    {
      key: 'branchCount',
      label: 'Branch depth',
      valueA: String(collegeA.branchCount || 0),
      valueB: String(collegeB.branchCount || 0),
      ...compareNumeric(collegeA.branchCount, collegeB.branchCount, true),
    },
    {
      key: 'location',
      label: 'Location',
      valueA: `${collegeA.city}, ${collegeA.state}`,
      valueB: `${collegeB.city}, ${collegeB.state}`,
      winner: 'tie',
      reason: 'Location preference is personal.',
    },
    {
      key: 'ownership',
      label: 'Ownership',
      valueA: collegeA.ownership,
      valueB: collegeB.ownership,
      winner: 'tie',
      reason: 'Ownership depends on student preference.',
    },
    {
      key: 'approvals',
      label: 'Approvals / recognition',
      valueA: (collegeA.approvals || []).join(', ') || 'Not listed',
      valueB: (collegeB.approvals || []).join(', ') || 'Not listed',
      winner: 'tie',
      reason: 'Check latest official approvals before deciding.',
    },
  ];
}

function summarizeWinners(rows) {
  const counts = { A: 0, B: 0, tie: 0 };
  for (const row of rows) {
    if (row.winner === 'A' || row.winner === 'B' || row.winner === 'tie') counts[row.winner] += 1;
  }
  let overall = 'tie';
  if (counts.A > counts.B) overall = 'A';
  if (counts.B > counts.A) overall = 'B';
  return { counts, overall };
}

function toSummaryCollege(college) {
  return {
    id: college.id,
    name: college.name,
    shortName: college.shortName,
    city: college.city,
    state: college.state,
    ownership: college.ownership,
    rankingLabel: college.rankingLabel,
    averagePackageLabel: college.averagePackageLabel,
    placementRateLabel: college.placementRateLabel,
    annualFeesLabel: college.annualFeesLabel,
    roiLabel: college.roiLabel,
    campusSizeLabel: college.campusSizeLabel,
    branchCount: college.branchCount,
    flagshipBranches: college.flagshipBranches || [],
    highlights: college.highlights || [],
    source: college.source || 'catalog',
  };
}

function sanitizeAiTableCell(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function mapWinnerToBetter(winner) {
  if (winner === 'A') return 'a';
  if (winner === 'B') return 'b';
  return 'tie';
}

function toClientRows(rows) {
  return (rows || []).map((row) => ({
    metric: row.label || row.metric || row.factor || '',
    aValue: row.valueA != null ? String(row.valueA) : String(row.aValue || row.collegeA || ''),
    bValue: row.valueB != null ? String(row.valueB) : String(row.bValue || row.collegeB || ''),
    better: row.better || mapWinnerToBetter(row.winner),
    reason: row.reason || '',
  }));
}

function sanitizeAiSummaryRows(rows, maxRows = 6) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const edgeRaw = String(row?.edge || row?.winner || row?.better || 'Tie').trim();
      const edge =
        edgeRaw === 'A' || edgeRaw.toLowerCase() === 'a'
          ? 'A'
          : edgeRaw === 'B' || edgeRaw.toLowerCase() === 'b'
            ? 'B'
            : 'Tie';
      return {
        factor: sanitizeAiTableCell(row?.factor || row?.label || row?.metric),
        collegeA: sanitizeAiTableCell(row?.collegeA || row?.a || row?.valueA || row?.aValue),
        collegeB: sanitizeAiTableCell(row?.collegeB || row?.b || row?.valueB || row?.bValue),
        edge,
        metric: sanitizeAiTableCell(row?.factor || row?.label || row?.metric),
        aValue: sanitizeAiTableCell(row?.collegeA || row?.a || row?.valueA || row?.aValue),
        bValue: sanitizeAiTableCell(row?.collegeB || row?.b || row?.valueB || row?.bValue),
        better: mapWinnerToBetter(edge === 'Tie' ? 'tie' : edge),
      };
    })
    .filter((row) => row.factor || row.collegeA || row.collegeB)
    .slice(0, maxRows);
}

function buildFallbackAiSummary(collegeA, collegeB, rows, winnerSummary) {
  const summaryRows = rows.slice(0, 6).map((row) => ({
    factor: row.label,
    collegeA: String(row.valueA || '—'),
    collegeB: String(row.valueB || '—'),
    edge: row.winner === 'A' ? 'A' : row.winner === 'B' ? 'B' : 'Tie',
    metric: row.label,
    aValue: String(row.valueA || '—'),
    bValue: String(row.valueB || '—'),
    better: mapWinnerToBetter(row.winner),
  }));

  return {
    rows: summaryRows,
    whoShouldPreferA: `Students prioritizing ${collegeA.shortName}'s ranking/placement mix (${collegeA.rankingLabel}).`,
    whoShouldPreferB: `Students prioritizing ${collegeB.shortName}'s ranking/placement mix (${collegeB.rankingLabel}).`,
    overallLean: winnerSummary.overall,
  };
}

function normalizeAiSummaryPayload(parsed, collegeA, collegeB, rows, winnerSummary) {
  const fallback = buildFallbackAiSummary(collegeA, collegeB, rows, winnerSummary);
  if (!parsed || typeof parsed !== 'object') {
    return fallback;
  }

  const summaryRows = sanitizeAiSummaryRows(parsed.rows || parsed.comparisonTable || parsed.table);
  return {
    rows: summaryRows.length ? summaryRows : fallback.rows,
    whoShouldPreferA:
      sanitizeAiTableCell(parsed.whoShouldPreferA) || fallback.whoShouldPreferA,
    whoShouldPreferB:
      sanitizeAiTableCell(parsed.whoShouldPreferB) || fallback.whoShouldPreferB,
    overallLean: winnerSummary.overall,
  };
}

async function generateAiSummary({ collegeA, collegeB, rows, winnerSummary }) {
  const summaryTimeoutMs = Math.max(
    3000,
    Number(process.env.COLLEGE_COMPARISON_SUMMARY_TIMEOUT_MS) || 20000
  );
  const summaryMaxTokens = Math.max(
    180,
    Number(process.env.COLLEGE_COMPARISON_SUMMARY_MAX_TOKENS) || 420
  );

  const userPrompt = JSON.stringify({
    collegeA: toSummaryCollege(collegeA),
    collegeB: toSummaryCollege(collegeB),
    metricWinners: rows.map((row) => ({
      metric: row.label,
      winner: row.winner,
      reason: row.reason,
      valueA: row.valueA,
      valueB: row.valueB,
    })),
    overallLean: winnerSummary.overall,
    winnerCounts: winnerSummary.counts,
  });

  const completion = await chatCompletion({
    systemPrompt: buildCollegeComparisonSystemPrompt(),
    userPrompt,
    temperature: 0.2,
    maxTokens: summaryMaxTokens,
    timeoutMs: summaryTimeoutMs,
  });

  const parsed = parseJsonObject(completion.content);
  const summary = normalizeAiSummaryPayload(parsed, collegeA, collegeB, rows, winnerSummary);

  return {
    summary,
    model: completion.model,
    usage: completion.usage || null,
  };
}

function toClientComparison(result) {
  const summary =
    result.aiSummary && result.aiSummary.generated && result.aiSummary.summary
      ? result.aiSummary.summary
      : null;

  return {
    institutionA: result.collegeA,
    institutionB: result.collegeB,
    collegeA: result.collegeA,
    collegeB: result.collegeB,
    rows: toClientRows(result.rows),
    winnerSummary: result.winnerSummary,
    freeTextUsed: Boolean(result.freeTextUsed),
    disclaimer: result.disclaimer,
    summary,
    aiSummary: result.aiSummary,
    generatedAt: result.generatedAt,
  };
}

function buildResultSnapshot(clientResult) {
  return {
    institutionA: clientResult.institutionA,
    institutionB: clientResult.institutionB,
    rows: clientResult.rows,
    winnerSummary: clientResult.winnerSummary,
    freeTextUsed: Boolean(clientResult.freeTextUsed),
    summary: clientResult.summary || null,
    generatedAt: clientResult.generatedAt,
  };
}

async function logComparisonSearch({ phone, fullName, collegeA, collegeB, freeTextUsed, includeSummary, clientResult }) {
  try {
    await CollegeComparisonSearchEvent.create({
      phone: normalizePhone(phone),
      fullName: normalizeName(fullName),
      collegeAId: collegeA?.id || '',
      collegeAName: collegeA?.name || '',
      collegeBId: collegeB?.id || '',
      collegeBName: collegeB?.name || '',
      freeTextUsed: Boolean(freeTextUsed),
      includeSummary: Boolean(includeSummary),
      summaryGenerated: Boolean(clientResult?.summary),
      source: 'public',
      winnersCountA: Number(clientResult?.winnerSummary?.counts?.A) || 0,
      winnersCountB: Number(clientResult?.winnerSummary?.counts?.B) || 0,
      resultSnapshot: buildResultSnapshot(clientResult),
      comparedAt: new Date(),
    });
  } catch (error) {
    console.warn('[college-comparison] failed to log search event:', error.message);
  }
}

async function compareColleges({
  collegeAId,
  collegeBId,
  collegeAName,
  collegeBName,
  includeSummary = false,
  phone = '',
  fullName = '',
}) {
  const resolvedA = await resolveCollegeRef({ id: collegeAId, name: collegeAName });
  const resolvedB = await resolveCollegeRef({ id: collegeBId, name: collegeBName });
  const collegeA = resolvedA.college;
  const collegeB = resolvedB.college;

  if (!collegeA || !collegeB) {
    const err = new Error('Both colleges are required. Type any college name or pick from suggestions.');
    err.statusCode = 400;
    throw err;
  }
  if (collegeA.id === collegeB.id || normalizeSearchText(collegeA.name) === normalizeSearchText(collegeB.name)) {
    const err = new Error('Pick two different colleges to compare');
    err.statusCode = 400;
    throw err;
  }

  const rows = buildRows(collegeA, collegeB);
  const winnerSummary = summarizeWinners(rows);
  const freeTextUsed = Boolean(resolvedA.freeText || resolvedB.freeText);

  const result = {
    collegeA: toPublicCollege(collegeA),
    collegeB: toPublicCollege(collegeB),
    rows,
    winnerSummary,
    freeTextUsed,
    disclaimer:
      'Signals are directional for counselling support. Confirm latest fees, placements, approvals, and cutoffs from official sources.',
    aiSummary: {
      requested: Boolean(includeSummary),
      generated: false,
      skipped: !includeSummary,
      reason: includeSummary ? '' : 'Summary not requested',
      summary: null,
      model: null,
      usage: null,
    },
    generatedAt: new Date().toISOString(),
  };

  if (includeSummary) {
    try {
      const ai = await generateAiSummary({ collegeA, collegeB, rows, winnerSummary });
      result.aiSummary = {
        requested: true,
        generated: true,
        skipped: false,
        reason: '',
        summary: ai.summary,
        model: ai.model,
        usage: ai.usage,
      };
    } catch (error) {
      result.aiSummary = {
        requested: true,
        generated: false,
        skipped: true,
        reason: error.message || 'AI summary unavailable',
        summary: null,
        model: null,
        usage: null,
      };
    }
  }

  const clientResult = toClientComparison(result);

  await logComparisonSearch({
    phone,
    fullName,
    collegeA,
    collegeB,
    freeTextUsed,
    includeSummary,
    clientResult,
  });

  return clientResult;
}

async function listCollegeComparisonSearchesForAdmin({
  page = 1,
  limit = 50,
  phone = '',
  q = '',
} = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
  const filter = {};

  const phoneDigits = normalizePhone(phone);
  if (phoneDigits) filter.phone = phoneDigits;

  const query = String(q || '').trim();
  if (query) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [
      { fullName: regex },
      { phone: regex },
      { collegeAName: regex },
      { collegeBName: regex },
    ];
  }

  const [total, rows] = await Promise.all([
    CollegeComparisonSearchEvent.countDocuments(filter),
    CollegeComparisonSearchEvent.find(filter)
      .sort({ comparedAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
  ]);

  return {
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: Math.max(1, Math.ceil(total / limitNum)),
    comparisons: rows.map((row) => ({
      id: String(row._id),
      phone: row.phone || '',
      fullName: row.fullName || '',
      collegeAId: row.collegeAId || '',
      collegeAName: row.collegeAName || '',
      collegeBId: row.collegeBId || '',
      collegeBName: row.collegeBName || '',
      freeTextUsed: Boolean(row.freeTextUsed),
      includeSummary: Boolean(row.includeSummary),
      summaryGenerated: Boolean(row.summaryGenerated),
      winnersCountA: Number(row.winnersCountA) || 0,
      winnersCountB: Number(row.winnersCountB) || 0,
      resultSnapshot: row.resultSnapshot || null,
      comparedAt: row.comparedAt,
    })),
  };
}

async function searchCollegeComparisonCatalog(query, limit = 12) {
  return searchCollegesForComparison(query, limit);
}

async function compareCollegeProfiles(payload = {}) {
  return compareColleges(payload);
}

module.exports = {
  getCollegeComparisonOptions,
  searchCollegesForComparison,
  searchCollegeComparisonCatalog,
  compareColleges,
  compareCollegeProfiles,
  listCollegeComparisonSearchesForAdmin,
};
