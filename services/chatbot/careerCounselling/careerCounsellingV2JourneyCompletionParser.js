'use strict';

const { normalizeText } = require('../intentTextUtils');

function isPhase14Ack(text) {
  const t = normalizeText(text);
  return /^(ok|okay|thanks|thank you|done|finish|finished|bye|goodbye)$/i.test(t);
}

module.exports = {
  isPhase14Ack,
};
