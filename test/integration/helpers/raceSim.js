'use strict';

/**
 * @param {number} n
 * @param {(workerId: number) => Promise<unknown>} fn
 */
async function parallelCronWorkers(n, fn) {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  return Promise.all(ids.map((id) => fn(id)));
}

/**
 * @param {number} n
 * @param {() => Promise<unknown>} fn
 */
async function parallelRuns(n, fn) {
  return Promise.all(Array.from({ length: n }, () => fn()));
}

module.exports = {
  parallelCronWorkers,
  parallelRuns
};
