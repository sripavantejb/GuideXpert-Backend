/**
 * Integration-test crash simulation (no-op unless WA_TEST_CRASH_POINT is set).
 */
function maybeCrash(point) {
  const target = process.env.WA_TEST_CRASH_POINT;
  if (target && String(target) === String(point)) {
    const err = new Error(`WA_TEST_CRASH:${point}`);
    err.code = 'WA_TEST_CRASH';
    throw err;
  }
}

module.exports = { maybeCrash };
