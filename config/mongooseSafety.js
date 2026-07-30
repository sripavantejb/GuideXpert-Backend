'use strict';

/**
 * Global index-safety guard for Mongoose.
 *
 * Mongoose builds every declared index on connect by default (`autoIndex`).
 * That means any script or test run with an updated model silently mutates the
 * indexes of whatever cluster it connects to — which has already happened once
 * against production. Index creation must be an explicit, reviewed migration,
 * never a side effect of loading a model.
 *
 * The guard is URI-aware rather than blanket-off, because the two cases have
 * genuinely different risk:
 *
 *   - localhost / 127.0.0.1 / in-memory servers → autoIndex stays ON, so unit
 *     tests that assert unique-index behaviour keep working against a database
 *     that is thrown away seconds later.
 *   - anything remote (Atlas, any host) → autoIndex is FORCED OFF, always.
 *
 * Override with ALLOW_REMOTE_AUTO_INDEX=1 for a deliberate, supervised run.
 *
 * Require this module before calling `mongoose.connect`. It patches connect
 * itself, so it cannot be bypassed by passing options.
 */

const mongoose = require('mongoose');

const LOCAL_HOST_PATTERN = /(^|\/\/|@)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

function isLocalUri(uri) {
  return LOCAL_HOST_PATTERN.test(String(uri || ''));
}

function overrideAllowed() {
  return process.env.ALLOW_REMOTE_AUTO_INDEX === '1';
}

function describeUri(uri) {
  const match = /@([^/?]+)/.exec(String(uri || ''));
  if (match) return match[1];
  const plain = /\/\/([^/?]+)/.exec(String(uri || ''));
  return plain ? plain[1] : 'unknown-host';
}

if (!mongoose.__guidexpertIndexSafetyInstalled) {
  const originalConnect = mongoose.connect.bind(mongoose);

  mongoose.connect = function guardedConnect(uri, options = {}, ...rest) {
    const local = isLocalUri(uri);
    const allowAutoIndex = local || overrideAllowed();

    if (!allowAutoIndex) {
      mongoose.set('autoIndex', false);
      if (options && options.autoIndex === true) {
        console.warn(
          '[mongooseSafety] ignoring autoIndex:true for remote host',
          describeUri(uri),
          '— set ALLOW_REMOTE_AUTO_INDEX=1 to override deliberately'
        );
      }
      return originalConnect(uri, { ...options, autoIndex: false }, ...rest);
    }

    if (!local && overrideAllowed()) {
      console.warn(
        '[mongooseSafety] ALLOW_REMOTE_AUTO_INDEX=1 — index builds are ENABLED against',
        describeUri(uri)
      );
    }
    return originalConnect(uri, options, ...rest);
  };

  Object.defineProperty(mongoose, '__guidexpertIndexSafetyInstalled', {
    value: true,
    enumerable: false,
  });
}

module.exports = { isLocalUri, describeUri };
