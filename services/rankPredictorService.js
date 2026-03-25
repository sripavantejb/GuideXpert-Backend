const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dataDir = path.join(__dirname, '..', 'data', 'rankPredictor');

const tsExportCache = new Map();

function loadTsExports(relativeFile) {
  const absolutePath = path.join(dataDir, relativeFile);
  if (tsExportCache.has(absolutePath)) return tsExportCache.get(absolutePath);

  const source = fs.readFileSync(absolutePath, 'utf8');
  const exportNames = [];
  const transformed = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => {
    exportNames.push(name);
    return `const ${name} =`;
  });

  const wrapped = `${transformed}\nmodule.exports = { ${exportNames.join(', ')} };`;
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox, { timeout: 10000 });

  tsExportCache.set(absolutePath, sandbox.module.exports);
  return sandbox.module.exports;
}

const { apEamcetPredictedRanks2025 } = loadTsExports('apEamcetPrecitedRanks.ts');
const { jeeAdvancePredictedRanks2025 } = loadTsExports('jeeAdvanceRankPredictorRanks.ts');
const { jeeMainPercentilePredictedRanks } = loadTsExports('jeeMainPercentilePredictorRanks.ts');
const { jeeMainPredictedRanks } = loadTsExports('jeeMainRankPredictorRanks.ts');
const { kcet2025PredictedRanks } = loadTsExports('kcetPredictedRanks.ts');
const { keam2025PredictedRank } = loadTsExports('keamPredictedRank.ts');
const { mhtcetPredictedRanks2025 } = loadTsExports('mhtcetPredictedRanks.ts');
const { tneaPredictedRanks2025 } = loadTsExports('tneaPredictedRanks.ts');
const { tsEamcet2025PredictedRanks } = loadTsExports('tsEamcet2023PredictedRanks.ts');
const { wbJeeRankPredictorRanks2025 } = loadTsExports('wbJeeRankPredictorRanks.ts');

const EXAMS = {
  apeamcet: {
    id: 'apeamcet',
    name: 'AP EAMCET',
    minScore: 0,
    maxScore: 100,
    mode: 'range-table',
    data: apEamcetPredictedRanks2025,
    metricLabel: 'Predicted Rank',
  },
  jeeadvanced: {
    id: 'jeeadvanced',
    name: 'JEE Advanced',
    minScore: 0,
    maxScore: 360,
    mode: 'range-table',
    data: jeeAdvancePredictedRanks2025,
    metricLabel: 'Predicted Rank',
  },
  jeemainpercentile: {
    id: 'jeemainpercentile',
    name: 'JEE Main Percentile',
    minScore: -40,
    maxScore: 300,
    mode: 'range-table',
    data: jeeMainPercentilePredictedRanks,
    metricLabel: 'Estimated Percentile',
  },
  jeemainmarks: {
    id: 'jeemainmarks',
    name: 'JEE Main Rank (Score Table)',
    minScore: 0,
    maxScore: 100,
    mode: 'range-table',
    data: jeeMainPredictedRanks,
    metricLabel: 'Predicted Rank',
  },
  kcet: {
    id: 'kcet',
    name: 'KCET',
    minScore: 0,
    maxScore: 100,
    mode: 'range-table',
    data: kcet2025PredictedRanks,
    metricLabel: 'Predicted Rank',
  },
  keam: {
    id: 'keam',
    name: 'KEAM',
    minScore: 0,
    maxScore: 600,
    mode: 'range-table',
    data: keam2025PredictedRank,
    metricLabel: 'Predicted Rank',
  },
  mhcet: {
    id: 'mhcet',
    name: 'MHT CET',
    minScore: 0,
    maxScore: 200,
    mode: 'difficulty-map',
    data: mhtcetPredictedRanks2025,
    requiredOption: 'difficulty',
    options: ['Easy', 'Moderate', 'Difficult'],
    metricLabel: 'Estimated Percentile',
  },
  tnea: {
    id: 'tnea',
    name: 'TNEA',
    minScore: 0,
    maxScore: 200,
    mode: 'range-table',
    data: tneaPredictedRanks2025,
    metricLabel: 'Predicted Rank',
  },
  tseamcet: {
    id: 'tseamcet',
    name: 'TS EAMCET',
    minScore: 0,
    maxScore: 160,
    mode: 'range-table',
    data: tsEamcet2025PredictedRanks,
    metricLabel: 'Predicted Rank',
  },
  wbjee: {
    id: 'wbjee',
    name: 'WBJEE',
    minScore: 0,
    maxScore: 200,
    mode: 'range-table',
    data: wbJeeRankPredictorRanks2025,
    metricLabel: 'Predicted Rank',
  },
};

function predictorError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  if (details) err.details = details;
  return err;
}

function predictFromRangeTable(data, score) {
  return data.find((row) => score <= Number(row.maxMarks) && score >= Number(row.minMarks)) || null;
}

function predictRank({ examId, score, options = {} }) {
  const exam = EXAMS[examId];
  if (!exam) {
    throw predictorError(400, 'INVALID_EXAM_ID', 'Unsupported exam selected.');
  }
  if (typeof score !== 'number' || Number.isNaN(score) || !Number.isFinite(score)) {
    throw predictorError(400, 'INVALID_SCORE_FORMAT', 'Score must be a valid number.');
  }
  if (score < exam.minScore || score > exam.maxScore) {
    throw predictorError(
      422,
      'SCORE_OUT_OF_RANGE',
      `Score must be between ${exam.minScore} and ${exam.maxScore} for ${exam.name}.`
    );
  }

  if (exam.mode === 'difficulty-map') {
    const difficulty = options.difficulty;
    if (!difficulty || !exam.options.includes(difficulty)) {
      throw predictorError(
        422,
        'MISSING_OR_INVALID_OPTION',
        'A valid difficulty option is required.',
        { requiredOption: exam.requiredOption, allowedValues: exam.options }
      );
    }
    if (!Number.isInteger(score)) {
      throw predictorError(422, 'INVALID_SCORE_FORMAT', 'MHT CET score must be an integer for strict lookup.');
    }
    const row = exam.data[difficulty]?.[String(score)];
    if (!row) {
      throw predictorError(422, 'PREDICTION_UNAVAILABLE', 'Prediction unavailable for the provided score.');
    }
    return {
      examId: exam.id,
      examName: exam.name,
      metricLabel: exam.metricLabel,
      predictedValue: String(row.percentile),
      range: String(row.percentile),
      message: row.result || 'Based on previous year trends.',
      matchedBy: 'exact-key',
    };
  }

  const match = predictFromRangeTable(exam.data, score);
  if (!match) {
    throw predictorError(422, 'PREDICTION_UNAVAILABLE', 'Prediction unavailable for the provided score.');
  }

  return {
    examId: exam.id,
    examName: exam.name,
    metricLabel: exam.metricLabel,
    predictedValue: match.rankRange,
    range: match.rankRange,
    message: 'Based on previous year trends and provided dataset.',
    matchedBy: 'range',
  };
}

function listExams() {
  return Object.values(EXAMS).map((exam) => ({
    id: exam.id,
    name: exam.name,
    minScore: exam.minScore,
    maxScore: exam.maxScore,
    requiresOption: Boolean(exam.requiredOption),
    requiredOption: exam.requiredOption || null,
    optionValues: exam.options || [],
  }));
}

module.exports = {
  predictRank,
  listExams,
};
