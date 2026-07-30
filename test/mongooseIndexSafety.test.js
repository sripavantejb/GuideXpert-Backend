'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const mongoose = require('mongoose');
const { isLocalUri } = require('../config/mongooseSafety');

const ROOT = path.join(__dirname, '..');
const SAFETY_MODULE = path.join(ROOT, 'config', 'mongooseSafety.js');
const EXEMPT = new Set(['config/db.js', 'config/mongooseSafety.js']);

function filesCallingConnect() {
  const out = execFileSync(
    'rg',
    ['-l', 'mongoose\\.connect\\(', '--glob', '!node_modules', '.'],
    { cwd: ROOT, encoding: 'utf8' }
  );
  return out
    .trim()
    .split('\n')
    .map((f) => f.replace(/^\.\//, ''))
    .filter((f) => f && !EXEMPT.has(f));
}

describe('mongoose index safety', () => {
  test('remote hosts are never treated as local', () => {
    assert.equal(isLocalUri('mongodb+srv://user:pw@guidexpert.t6p5vfw.mongodb.net/test'), false);
    assert.equal(isLocalUri('mongodb://db.internal:27017/app'), false);
  });

  test('local and in-memory hosts keep autoIndex available', () => {
    assert.equal(isLocalUri('mongodb://localhost:27017/guidexpert'), true);
    assert.equal(isLocalUri('mongodb://127.0.0.1:53210/test'), true);
  });

  test('connect is patched, and the patch is installed once', () => {
    assert.equal(mongoose.__guidexpertIndexSafetyInstalled, true);
    const before = mongoose.connect;
    delete require.cache[require.resolve('../config/mongooseSafety')];
    require('../config/mongooseSafety');
    assert.equal(mongoose.connect, before, 're-requiring must not re-wrap connect');
  });

  test('every file calling mongoose.connect requires the safety guard first', () => {
    const offenders = [];
    for (const rel of filesCallingConnect()) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const match = /require\('([^']*config\/mongooseSafety)'\)/.exec(src);
      if (!match) {
        offenders.push(`${rel} — missing require('.../config/mongooseSafety')`);
        continue;
      }
      const resolved = `${path.resolve(path.dirname(path.join(ROOT, rel)), match[1])}.js`;
      if (resolved !== SAFETY_MODULE) {
        offenders.push(`${rel} — require resolves to ${resolved}`);
      }
      if (src.indexOf(match[0]) > src.indexOf('mongoose.connect(')) {
        offenders.push(`${rel} — guard is required after mongoose.connect is called`);
      }
    }
    assert.deepEqual(offenders, [], `unguarded mongoose.connect call sites:\n${offenders.join('\n')}`);
  });
});
