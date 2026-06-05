'use strict';

const crypto = require('crypto');

function hashEmbedText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

module.exports = { hashEmbedText };
