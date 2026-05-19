'use strict';

class FakeClock {
  /**
   * @param {string|Date} [startIso] default fixed anchor
   */
  constructor(startIso = '2026-05-15T06:00:00.000Z') {
    this._ms = new Date(startIso).getTime();
  }

  now() {
    return new Date(this._ms);
  }

  /** @returns {{ now: Date }} for service opts */
  opts() {
    return { now: this.now() };
  }

  advance(ms) {
    this._ms += ms;
    return this.now();
  }

  freeze(isoOrDate) {
    this._ms = new Date(isoOrDate).getTime();
    return this.now();
  }
}

module.exports = { FakeClock };
