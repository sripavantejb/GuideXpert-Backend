const crypto = require('crypto');

const token = crypto.randomBytes(32).toString('hex');
console.log('OSVI_WEBHOOK_TOKEN=', token);
