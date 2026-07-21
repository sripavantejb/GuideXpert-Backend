'use strict';

/**
 * Entity definitions — registration for all chatbot-facing entities.
 *
 * Import this module once at startup (it runs register() side-effects).
 * Re-importing is safe: the register() calls are idempotent (they overwrite).
 */

const { register } = require('./entityNormalizer');

// ---------------------------------------------------------------------------
// RESERVATION CATEGORY — AP/TS EAMCET and general Indian reservations
// ---------------------------------------------------------------------------

register('ap_ts_category', {
  canonicalValues: ['OC', 'BC-A', 'BC-B', 'BC-C', 'BC-D', 'BC-E', 'SC', 'ST', 'EWS'],
  aliasMap: {
    // OC / OPEN / GENERAL
    OC: 'OC',
    OPENCATEGORY: 'OC',
    OPEN: 'OC',
    GENERAL: 'OC',
    GENERALCATEGORY: 'OC',
    GEN: 'OC',
    UNRESERVED: 'OC',
    UR: 'OC',
    FORWARDCASTE: 'OC',
    FC: 'OC',

    // BC-A
    'BC-A': 'BC-A',
    BCA: 'BC-A',
    'BC A': 'BC-A',
    BACKWARDCLASSA: 'BC-A',

    // BC-B
    'BC-B': 'BC-B',
    BCB: 'BC-B',
    'BC B': 'BC-B',
    BACKWARDCLASSB: 'BC-B',

    // BC-C
    'BC-C': 'BC-C',
    BCC: 'BC-C',
    'BC C': 'BC-C',
    BACKWARDCLASSC: 'BC-C',

    // BC-D
    'BC-D': 'BC-D',
    BCD: 'BC-D',
    'BC D': 'BC-D',
    BACKWARDCLASSD: 'BC-D',

    // BC-E
    'BC-E': 'BC-E',
    BCE: 'BC-E',
    'BC E': 'BC-E',
    BACKWARDCLASSE: 'BC-E',

    // SC
    SC: 'SC',
    SCHEDULEDCASTE: 'SC',
    'SCHEDULED CASTE': 'SC',
    DALIT: 'SC',

    // ST
    ST: 'ST',
    SCHEDULEDTRIBE: 'ST',
    'SCHEDULED TRIBE': 'ST',
    TRIBAL: 'ST',
    ADIVASI: 'ST',

    // EWS
    EWS: 'EWS',
    ECONOMICALLYWEAKERSECTION: 'EWS',
    'ECONOMICALLY WEAKER SECTION': 'EWS',
    EWSGENERAL: 'EWS',
  },
  patterns: [
    // BC-* with any separator
    { value: 'BC-A', re: /\bbc[\s\-_]*a\b/i },
    { value: 'BC-B', re: /\bbc[\s\-_]*b\b/i },
    { value: 'BC-C', re: /\bbc[\s\-_]*c\b/i },
    { value: 'BC-D', re: /\bbc[\s\-_]*d\b/i },
    { value: 'BC-E', re: /\bbc[\s\-_]*e\b/i },
    // Exact / word-boundary
    { value: 'OC', re: /\b(oc|open\s+category|open\s+caste|general\s+category|general\s+caste)\b/i },
    { value: 'SC', re: /\bsc\b/i },
    { value: 'ST', re: /\bst\b/i },
    { value: 'EWS', re: /\bews\b/i },
  ],
});

// ---------------------------------------------------------------------------
// GENDER
// ---------------------------------------------------------------------------

register('gender', {
  canonicalValues: ['male', 'female'],
  aliasMap: {
    MALE: 'male',
    M: 'male',
    BOY: 'male',
    BOYS: 'male',
    MAN: 'male',
    MEN: 'male',
    GENTS: 'male',
    '1': 'male',
    FEMALE: 'female',
    F: 'female',
    GIRL: 'female',
    GIRLS: 'female',
    WOMAN: 'female',
    WOMEN: 'female',
    LADIES: 'female',
    FEMLAE: 'female',
    FEMAIL: 'female',
    FEMAL: 'female',
    LADY: 'female',
    '2': 'female',
    // Telugu / Hinglish tokens
    MANISHI: 'male',
    AADAMANISHI: 'male',
    AADAMAADU: 'male',
    KODALLU: 'female',
    AMMAYI: 'female',
    AYYA: 'male',
    LADKA: 'male',
    LADKI: 'female',
  },
  patterns: [
    { value: 'female', re: /\b(female|femlae|femail|femal|girl|woman|women|f)\b/i },
    { value: 'male', re: /\b(male|boy|man|men|m)\b(?!.*\b(female|femlae|femail|femal)\b)/i },
  ],
});

// ---------------------------------------------------------------------------
// QUOTA (WBJEE)
// ---------------------------------------------------------------------------

register('wbjee_quota', {
  canonicalValues: ['all_india', 'home_state_wb'],
  aliasMap: {
    ALLINDIA: 'all_india',
    AI: 'all_india',
    '1': 'all_india',
    HOMESTATE: 'home_state_wb',
    WESTBENGAL: 'home_state_wb',
    WB: 'home_state_wb',
    '2': 'home_state_wb',
  },
  patterns: [
    { value: 'all_india', re: /\ball\s*india\b/i },
    { value: 'home_state_wb', re: /\b(home\s*state|west\s*bengal)\b/i },
  ],
});

// ---------------------------------------------------------------------------
// AP REGION
// ---------------------------------------------------------------------------

register('ap_region', {
  canonicalValues: ['AU', 'SVU'],
  aliasMap: {
    AU: 'AU',
    ANDHRAUNI: 'AU',
    ANDHRAUNI: 'AU',
    ANDHRAUNTV: 'AU',
    '1': 'AU',
    SVU: 'SVU',
    SRIVENKATESWARA: 'SVU',
    TIRUPATI: 'SVU',
    '2': 'SVU',
  },
  patterns: [
    { value: 'AU', re: /\b(au|andhra\s*university)\b/i },
    { value: 'SVU', re: /\b(svu|sri\s*venkateswara)\b/i },
  ],
});

// ---------------------------------------------------------------------------
// JEE CATEGORY
// ---------------------------------------------------------------------------

register('jee_category', {
  canonicalValues: ['OPEN', 'OPEN (PwD)', 'EWS', 'EWS (PwD)', 'OBC-NCL', 'OBC-NCL (PwD)', 'SC', 'SC (PwD)', 'ST', 'ST (PwD)'],
  aliasMap: {
    OPEN: 'OPEN',
    GENERAL: 'OPEN',
    GEN: 'OPEN',
    UR: 'OPEN',
    UNRESERVED: 'OPEN',
    '1': 'OPEN',
    OPENPWD: 'OPEN (PwD)',
    'OPEN(PWD)': 'OPEN (PwD)',
    '2': 'OPEN (PwD)',
    EWS: 'EWS',
    '3': 'EWS',
    EWSPWD: 'EWS (PwD)',
    'EWS(PWD)': 'EWS (PwD)',
    '4': 'EWS (PwD)',
    OBCNCL: 'OBC-NCL',
    'OBC-NCL': 'OBC-NCL',
    OBCNCLNCL: 'OBC-NCL',
    OBC: 'OBC-NCL',
    '5': 'OBC-NCL',
    OBCNCLPWD: 'OBC-NCL (PwD)',
    '6': 'OBC-NCL (PwD)',
    SC: 'SC',
    '7': 'SC',
    SCPWD: 'SC (PwD)',
    '8': 'SC (PwD)',
    ST: 'ST',
    '9': 'ST',
    STPWD: 'ST (PwD)',
    '10': 'ST (PwD)',
  },
  patterns: [
    { value: 'OBC-NCL', re: /\bobc[\s\-_]*ncl?\b/i },
    { value: 'SC', re: /\bsc\b/i },
    { value: 'ST', re: /\bst\b/i },
    { value: 'EWS', re: /\bews\b/i },
    { value: 'OPEN', re: /\b(open|general|unreserved|ur)\b/i },
  ],
});

// ---------------------------------------------------------------------------
// TNEA CATEGORY
// ---------------------------------------------------------------------------

register('tnea_category', {
  canonicalValues: ['OC', 'BC', 'BCM', 'MBC', 'SC', 'SCA', 'ST'],
  aliasMap: {
    OC: 'OC',
    OPENCATEGORY: 'OC',
    GENERAL: 'OC',
    GEN: 'OC',
    '1': 'OC',
    BC: 'BC',
    BACKWARDCLASS: 'BC',
    '2': 'BC',
    BCM: 'BCM',
    BACKWARDCLASSMUSLIM: 'BCM',
    '3': 'BCM',
    MBC: 'MBC',
    MOSTBACKWARDCLASS: 'MBC',
    '4': 'MBC',
    SC: 'SC',
    SCHEDULEDCASTE: 'SC',
    '5': 'SC',
    SCA: 'SCA',
    '6': 'SCA',
    ST: 'ST',
    SCHEDULEDTRIBE: 'ST',
    '7': 'ST',
  },
  patterns: [
    { value: 'SCA', re: /\bsca\b/i },
    { value: 'MBC', re: /\bmbc\b/i },
    { value: 'BCM', re: /\bbcm\b/i },
    { value: 'BC', re: /\b(?<!m)bc(?!m)\b/i },
    { value: 'SC', re: /\bsc\b/i },
    { value: 'ST', re: /\bst\b/i },
    { value: 'OC', re: /\b(oc|general|open\s+category)\b/i },
  ],
});

// ---------------------------------------------------------------------------
// KCET ADMISSION TYPE
// ---------------------------------------------------------------------------

register('kcet_admission', {
  canonicalValues: ['GENERAL', 'HK'],
  aliasMap: {
    GENERAL: 'GENERAL',
    GEN: 'GENERAL',
    NORMAL: 'GENERAL',
    '1': 'GENERAL',
    HK: 'HK',
    HYDERABADKARNATAKA: 'HK',
    '2': 'HK',
  },
  patterns: [
    { value: 'HK', re: /\bhk\b/i },
    { value: 'HK', re: /hyderabad[\s-]*karnataka/i },
    { value: 'GENERAL', re: /\bgeneral\b/i },
  ],
});

// ---------------------------------------------------------------------------
// MHT CET ADMISSION TYPE
// ---------------------------------------------------------------------------

register('mhtcet_admission', {
  canonicalValues: ['STATE_LEVEL', 'HOME_UNIVERSITY', 'OTHER_THAN_HOME_UNIVERSITY'],
  aliasMap: {
    STATELEVEL: 'STATE_LEVEL',
    SL: 'STATE_LEVEL',
    STATE: 'STATE_LEVEL',
    '1': 'STATE_LEVEL',
    HOMEUNIVERSITY: 'HOME_UNIVERSITY',
    HU: 'HOME_UNIVERSITY',
    HOME: 'HOME_UNIVERSITY',
    '2': 'HOME_UNIVERSITY',
    OTHERTHAN: 'OTHER_THAN_HOME_UNIVERSITY',
    OHU: 'OTHER_THAN_HOME_UNIVERSITY',
    OTHER: 'OTHER_THAN_HOME_UNIVERSITY',
    '3': 'OTHER_THAN_HOME_UNIVERSITY',
  },
  patterns: [
    { value: 'STATE_LEVEL', re: /state[\s-]*level/i },
    { value: 'HOME_UNIVERSITY', re: /home[\s-]*university/i },
    { value: 'OTHER_THAN_HOME_UNIVERSITY', re: /other\s+(than\s+)?home/i },
    { value: 'STATE_LEVEL', re: /\b(gopens|gobcs|gsc|gsebcs|gsts|tfws)\b/i },
  ],
});
