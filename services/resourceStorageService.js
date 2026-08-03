const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');

const BUCKET_NAME = 'student_resources';

function getBucket() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('MongoDB connection not ready');
  }
  return new GridFSBucket(db, { bucketName: BUCKET_NAME });
}

async function ensureConnection() {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connection.asPromise();
  }
}

/**
 * Upload a complete buffer to GridFS.
 * @returns {Promise<import('mongodb').ObjectId>}
 */
async function uploadToGridFS(buffer, metadata = {}) {
  await ensureConnection();
  const bucket = getBucket();

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(metadata.filename || 'resource.pdf', {
      metadata: {
        mimeType: metadata.mimeType || 'application/pdf',
        ...metadata,
      },
    });

    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));

    uploadStream.end(buffer);
  });
}

/**
 * Open a readable stream for a GridFS file.
 */
async function openDownloadStream(gridFsFileId) {
  await ensureConnection();
  const bucket = getBucket();
  const id = typeof gridFsFileId === 'string' ? new ObjectId(gridFsFileId) : gridFsFileId;
  return bucket.openDownloadStream(id);
}

/**
 * Delete a GridFS file by id.
 */
async function deleteFromGridFS(gridFsFileId) {
  await ensureConnection();
  if (!gridFsFileId) return;
  const bucket = getBucket();
  const id = typeof gridFsFileId === 'string' ? new ObjectId(gridFsFileId) : gridFsFileId;
  try {
    await bucket.delete(id);
  } catch (err) {
    if (err?.code !== 'ENOENT' && err?.message !== 'FileNotFound') {
      throw err;
    }
  }
}

module.exports = {
  BUCKET_NAME,
  uploadToGridFS,
  openDownloadStream,
  deleteFromGridFS,
};
