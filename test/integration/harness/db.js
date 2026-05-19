'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let memoryServer = null;

async function connectTestDb() {
  if (mongoose.connection.readyState === 1) {
    await resetTestDb();
    return mongoose.connection;
  }
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri();
  await mongoose.connect(uri, {
    dbName: 'guidexpert_integration_test',
    serverSelectionTimeoutMS: 10000
  });
  await syncIndexes();
  return mongoose.connection;
}

async function syncIndexes() {
  const models = [
    require('../../../models/WhatsAppReminderJob'),
    require('../../../models/WhatsAppMessageEvent'),
    require('../../../models/WhatsAppWebhookEvent'),
    require('../../../models/WhatsAppRetryGroup'),
    require('../../../models/FormSubmission')
  ];
  await Promise.all(models.map((M) => M.syncIndexes().catch(() => {})));
}

async function resetTestDb() {
  if (mongoose.connection.readyState !== 1) return;
  await mongoose.connection.dropDatabase();
}

async function disconnectTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

module.exports = {
  connectTestDb,
  resetTestDb,
  disconnectTestDb,
  syncIndexes
};
