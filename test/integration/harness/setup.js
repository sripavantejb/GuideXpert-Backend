'use strict';

const { connectTestDb, resetTestDb, disconnectTestDb } = require('./db');
const { applyIntegrationEnv, restoreEnv, clearCrashPoint } = require('./env');
const { FakeClock } = require('./clock');
const gupshupService = require('../../../services/gupshupService');

let sharedClock = null;

function getClock() {
  if (!sharedClock) sharedClock = new FakeClock();
  return sharedClock;
}

function resetClock(iso) {
  sharedClock = new FakeClock(iso);
  return sharedClock;
}

async function integrationBefore() {
  applyIntegrationEnv();
  await connectTestDb();
  gupshupService.resetIntegrationStubCallCount();
}

async function integrationBeforeEach() {
  applyIntegrationEnv();
  await resetTestDb();
  clearCrashPoint();
  gupshupService.resetIntegrationStubCallCount();
  if (!sharedClock) sharedClock = new FakeClock();
}

async function integrationAfter() {
  restoreEnv();
  sharedClock = null;
  await disconnectTestDb();
}

module.exports = {
  integrationBefore,
  integrationBeforeEach,
  integrationAfter,
  getClock,
  resetClock
};
