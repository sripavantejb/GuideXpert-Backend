/**
 * One-off: convert data/rankPredictor/*.ts datasets to .json for static require() (Vercel bundle).
 * Run from repo root: node scripts/exportRankPredictorTsToJson.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dataDir = path.join(__dirname, '..', 'data', 'rankPredictor');

const FILES = [
  'apEamcetPrecitedRanks.ts',
  'jeeAdvanceRankPredictorRanks.ts',
  'jeeMainPercentilePredictorRanks.ts',
  'jeeMainRankPredictorRanks.ts',
  'kcetPredictedRanks.ts',
  'keamPredictedRank.ts',
  'mhtcetPredictedRanks.ts',
  'tneaPredictedRanks.ts',
  'tsEamcet2023PredictedRanks.ts',
  'wbJeeRankPredictorRanks.ts',
];

function loadTsExports(relativeFile) {
  const absolutePath = path.join(dataDir, relativeFile);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const exportNames = [];
  const transformed = source.replace(/export const\s+([A-Za-z0-9_]+)\s*=/g, (_, name) => {
    exportNames.push(name);
    return `const ${name} =`;
  });

  const wrapped = `${transformed}\nmodule.exports = { ${exportNames.join(', ')} };`;
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox, { timeout: 120000 });
  return sandbox.module.exports;
}

for (const file of FILES) {
  const exportsObj = loadTsExports(file);
  const base = file.replace(/\.ts$/, '');
  const outPath = path.join(dataDir, `${base}.json`);
  fs.writeFileSync(outPath, JSON.stringify(exportsObj), 'utf8');
  console.log('Wrote', outPath);
}
