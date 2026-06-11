'use strict';

const ALLOWED_KB_CATEGORIES = new Set(['iit_counselling', 'niit_counselling']);

const SHORT_IIT_QUERY_EXPANSIONS = {
  float: 'JoSAA float option seat allocation upgrade',
  slide: 'JoSAA slide option branch change downgrade',
  freeze: 'JoSAA freeze option accept allotted seat',
  rounds: 'JoSAA counselling rounds how many',
  round: 'JoSAA counselling round process',
  quota: 'JEE counselling quota home state other state',
  josaa: 'JoSAA joint seat allocation authority IIT NIT IIIT',
  csab: 'CSAB special round counselling NIT IIIT CFTI',
  crl: 'CRL common rank list JEE Main rank',
  'float ante enti': 'JoSAA float option seat allocation Telugu',
  'slide ante enti': 'JoSAA slide option branch allocation Telugu',
  'rounds kitne': 'JoSAA counselling rounds how many Hindi',
  'josaa kya hai': 'JoSAA joint seat allocation authority Hindi',
};

module.exports = {
  ALLOWED_KB_CATEGORIES,
  SHORT_IIT_QUERY_EXPANSIONS,
};
