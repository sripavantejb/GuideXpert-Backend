const crypto = require('crypto');
const StudentResource = require('../models/StudentResource');
const StudentResourceDownload = require('../models/StudentResourceDownload');
const ResourceUploadSession = require('../models/ResourceUploadSession');
const ResourceUploadChunk = require('../models/ResourceUploadChunk');
const {
  uploadToGridFS,
  openDownloadStream,
  deleteFromGridFS,
} = require('../services/resourceStorageService');
const { generateOTP, hashOTP, verifyOTP } = require('../utils/otpUtil');
const otpRepository = require('../utils/otpRepository');
const otpStore = require('../utils/otpStore');
const { sendOtp: sendOtpSms } = require('../utils/msg91Service');
const { isPrivilegedPhone, getPrivilegedOtp } = require('../utils/privilegedAccess');

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const CHUNK_SIZE = 2 * 1024 * 1024;
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10);
const OTP_EXPIRY_MS = OTP_EXPIRY_MINUTES * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 3;
const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const OCCUPATION = 'Resource Download';

function normalizePhone(phone) {
  return otpRepository.normalize(phone);
}

function adminName(req) {
  return String(
    req.admin?.email || req.admin?.username || req.admin?.name || req.admin?.phone || ''
  ).slice(0, 120);
}

function isPdfFileName(fileName) {
  return typeof fileName === 'string' && /\.pdf$/i.test(fileName.trim());
}

function isPdfMimeType(mimeType) {
  const mime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  return !mime || mime === 'application/pdf' || mime === 'application/x-pdf';
}

function chunkDataToBuffer(value) {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value._bsontype === 'Binary' || value?.sub_type != null) {
    return Buffer.from(value.buffer);
  }
  if (typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return Buffer.from(value);
}

function validatePdfBuffer(buffer) {
  if (!buffer || buffer.length < 5) return false;
  return buffer.slice(0, 5).toString('ascii').startsWith('%PDF-');
}

async function createResourceFromBuffer(buffer, meta, req) {
  if (!validatePdfBuffer(buffer)) {
    const err = new Error('Invalid PDF file');
    err.statusCode = 400;
    throw err;
  }

  const resolvedTitle =
    (meta.title && meta.title.trim()) ||
    meta.fileName.replace(/\.pdf$/i, '') ||
    'Untitled Resource';

  const gridFsFileId = await uploadToGridFS(buffer, {
    filename: meta.fileName,
    mimeType: meta.mimeType || 'application/pdf',
  });

  const created = await StudentResource.create({
    title: resolvedTitle.slice(0, 200),
    description: (meta.description || '').slice(0, 2000),
    fileName: meta.fileName,
    fileSize: buffer.length,
    mimeType: meta.mimeType || 'application/pdf',
    gridFsFileId,
    status: 'draft',
    createdBy: meta.createdBy || adminName(req),
  });

  return created;
}

function toAdminItem(doc) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description || '',
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    mimeType: doc.mimeType || 'application/pdf',
    status: doc.status,
    publishedAt: doc.publishedAt || null,
    createdBy: doc.createdBy || '',
    downloadCount: doc.downloadCount || 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toPublicItem(doc) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    description: doc.description || '',
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    publishedAt: doc.publishedAt || doc.createdAt,
  };
}

function signDownloadToken(resourceId, phone) {
  const secret = process.env.OTP_SECRET;
  if (!secret) throw new Error('OTP_SECRET is not set');
  const exp = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const payload = `${resourceId}|${phone}|${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function verifyDownloadToken(token, resourceId, phone) {
  const secret = process.env.OTP_SECRET;
  if (!secret || !token) return false;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split('|');
    if (parts.length !== 4) return false;
    const [tokenResourceId, tokenPhone, expStr, sig] = parts;
    if (tokenResourceId !== resourceId || tokenPhone !== phone) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Date.now()) return false;
    const payload = `${tokenResourceId}|${tokenPhone}|${expStr}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function getPublishedResource(id) {
  const doc = await StudentResource.findById(id).lean();
  if (!doc || doc.status !== 'published') return null;
  return doc;
}

exports.adminList = async (req, res) => {
  try {
    const { status } = req.query || {};
    const filter = {};
    if (status === 'draft' || status === 'published') filter.status = status;
    const list = await StudentResource.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: list.map(toAdminItem) });
  } catch (err) {
    console.error('[StudentResource] adminList:', err);
    return res.status(500).json({ success: false, message: 'Failed to list resources' });
  }
};

exports.adminUploadInit = async (req, res) => {
  try {
    const { fileName, fileSize, mimeType, title, description, totalChunks } = req.body || {};

    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ success: false, message: 'fileName is required' });
    }
    const size = Number(fileSize);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: `fileSize must be between 1 and ${MAX_FILE_SIZE} bytes`,
      });
    }
    const chunks = Number(totalChunks);
    if (!Number.isFinite(chunks) || chunks < 1) {
      return res.status(400).json({ success: false, message: 'totalChunks is required' });
    }

    const mime = typeof mimeType === 'string' ? mimeType.trim() : 'application/pdf';
    if (!isPdfMimeType(mime) && !isPdfFileName(fileName)) {
      return res.status(400).json({ success: false, message: 'Only PDF files are allowed' });
    }

    const uploadId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);

    await ResourceUploadSession.create({
      uploadId,
      fileName: fileName.trim().slice(0, 260),
      fileSize: size,
      mimeType: mime,
      totalChunks: chunks,
      title: typeof title === 'string' ? title.trim().slice(0, 200) : '',
      description: typeof description === 'string' ? description.trim().slice(0, 2000) : '',
      createdBy: adminName(req),
      expiresAt,
    });

    return res.status(201).json({
      success: true,
      data: { uploadId, chunkSize: CHUNK_SIZE },
    });
  } catch (err) {
    console.error('[StudentResource] adminUploadInit:', err);
    return res.status(500).json({ success: false, message: 'Failed to init upload' });
  }
};

exports.adminUploadChunk = async (req, res) => {
  try {
    const uploadId = req.body?.uploadId || req.headers['x-upload-id'];
    const chunkIndex = Number(req.body?.chunkIndex);
    const chunkData = req.file?.buffer;

    if (!uploadId || typeof uploadId !== 'string') {
      return res.status(400).json({ success: false, message: 'uploadId is required' });
    }
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return res.status(400).json({ success: false, message: 'chunkIndex is required' });
    }
    if (!chunkData || !Buffer.isBuffer(chunkData) || chunkData.length === 0) {
      return res.status(400).json({ success: false, message: 'chunk file is required' });
    }
    if (chunkData.length > CHUNK_SIZE) {
      return res.status(400).json({ success: false, message: `Chunk exceeds ${CHUNK_SIZE} bytes` });
    }

    const session = await ResourceUploadSession.findOne({ uploadId, status: 'pending' });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Upload session not found or expired' });
    }
    if (chunkIndex >= session.totalChunks) {
      return res.status(400).json({ success: false, message: 'chunkIndex out of range' });
    }

    const expiresAt = session.expiresAt;
    await ResourceUploadChunk.findOneAndUpdate(
      { uploadId, chunkIndex },
      { uploadId, chunkIndex, data: chunkData, expiresAt },
      { upsert: true, new: true }
    );

    const received = await ResourceUploadChunk.countDocuments({ uploadId });
    session.receivedChunks = received;
    await session.save();

    return res.json({
      success: true,
      data: { uploadId, chunkIndex, receivedChunks: received, totalChunks: session.totalChunks },
    });
  } catch (err) {
    console.error('[StudentResource] adminUploadChunk:', err);
    return res.status(500).json({ success: false, message: 'Failed to save chunk' });
  }
};

exports.adminUploadComplete = async (req, res) => {
  try {
    const { uploadId, title, description } = req.body || {};
    if (!uploadId || typeof uploadId !== 'string') {
      return res.status(400).json({ success: false, message: 'uploadId is required' });
    }

    const session = await ResourceUploadSession.findOne({ uploadId, status: 'pending' });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Upload session not found or expired' });
    }

    const chunks = await ResourceUploadChunk.find({ uploadId })
      .sort({ chunkIndex: 1 })
      .select('chunkIndex data');

    if (chunks.length !== session.totalChunks) {
      return res.status(400).json({
        success: false,
        message: `Missing chunks: received ${chunks.length} of ${session.totalChunks}`,
      });
    }

    const buffer = Buffer.concat(chunks.map((c) => chunkDataToBuffer(c.data)));
    if (buffer.length !== session.fileSize) {
      return res.status(400).json({
        success: false,
        message: `File size mismatch: expected ${session.fileSize}, got ${buffer.length}`,
      });
    }

    const created = await createResourceFromBuffer(
      buffer,
      {
        title:
          (typeof title === 'string' && title.trim()) ||
          session.title ||
          session.fileName,
        description:
          typeof description === 'string' ? description.trim() : session.description || '',
        fileName: session.fileName,
        mimeType: session.mimeType,
        createdBy: session.createdBy,
      },
      req
    );

    session.status = 'complete';
    await session.save();
    await ResourceUploadChunk.deleteMany({ uploadId });

    return res.status(201).json({ success: true, data: toAdminItem(created.toObject()) });
  } catch (err) {
    console.error('[StudentResource] adminUploadComplete:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: err.statusCode ? err.message : 'Failed to complete upload',
    });
  }
};

/** Direct upload for PDFs up to 10MB (single JSON request, avoids multipart issues). */
exports.adminUploadDirect = async (req, res) => {
  try {
    const { fileName, fileBase64, title, description, mimeType, fileSize } = req.body || {};

    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ success: false, message: 'fileName is required' });
    }
    if (!isPdfFileName(fileName)) {
      return res.status(400).json({ success: false, message: 'Only PDF files are allowed' });
    }
    if (!fileBase64 || typeof fileBase64 !== 'string') {
      return res.status(400).json({ success: false, message: 'fileBase64 is required' });
    }

    const mime = typeof mimeType === 'string' ? mimeType.trim() : 'application/pdf';
    if (!isPdfMimeType(mime)) {
      return res.status(400).json({ success: false, message: 'Only PDF files are allowed' });
    }

    const payload = fileBase64.includes(',') ? fileBase64.split(',').pop() : fileBase64;
    const buffer = Buffer.from(payload, 'base64');
    const expectedSize = Number(fileSize);

    if (!Number.isFinite(expectedSize) || expectedSize <= 0 || expectedSize > 10 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'Direct upload supports PDF files up to 10MB. Use chunked upload for larger files.',
      });
    }
    if (buffer.length !== expectedSize) {
      return res.status(400).json({
        success: false,
        message: `File size mismatch: expected ${expectedSize}, got ${buffer.length}`,
      });
    }

    const created = await createResourceFromBuffer(
      buffer,
      {
        title: typeof title === 'string' ? title.trim() : '',
        description: typeof description === 'string' ? description.trim() : '',
        fileName: fileName.trim().slice(0, 260),
        mimeType: mime,
      },
      req
    );

    return res.status(201).json({ success: true, data: toAdminItem(created.toObject()) });
  } catch (err) {
    console.error('[StudentResource] adminUploadDirect:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: err.statusCode ? err.message : 'Failed to upload resource',
    });
  }
};

exports.adminUpdate = async (req, res) => {
  try {
    const doc = await StudentResource.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Resource not found' });

    if (typeof req.body?.title === 'string' && req.body.title.trim()) {
      doc.title = req.body.title.trim().slice(0, 200);
    }
    if (typeof req.body?.description === 'string') {
      doc.description = req.body.description.trim().slice(0, 2000);
    }
    await doc.save();
    return res.json({ success: true, data: toAdminItem(doc.toObject()) });
  } catch (err) {
    console.error('[StudentResource] adminUpdate:', err);
    return res.status(500).json({ success: false, message: 'Failed to update resource' });
  }
};

exports.adminPublish = async (req, res) => {
  try {
    const doc = await StudentResource.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Resource not found' });
    doc.status = 'published';
    doc.publishedAt = new Date();
    await doc.save();
    return res.json({ success: true, data: toAdminItem(doc.toObject()) });
  } catch (err) {
    console.error('[StudentResource] adminPublish:', err);
    return res.status(500).json({ success: false, message: 'Failed to publish resource' });
  }
};

exports.adminUnpublish = async (req, res) => {
  try {
    const doc = await StudentResource.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Resource not found' });
    doc.status = 'draft';
    await doc.save();
    return res.json({ success: true, data: toAdminItem(doc.toObject()) });
  } catch (err) {
    console.error('[StudentResource] adminUnpublish:', err);
    return res.status(500).json({ success: false, message: 'Failed to unpublish resource' });
  }
};

exports.adminDelete = async (req, res) => {
  try {
    const doc = await StudentResource.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Resource not found' });
    await deleteFromGridFS(doc.gridFsFileId);
    await StudentResource.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error('[StudentResource] adminDelete:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete resource' });
  }
};

exports.adminDownloadLogs = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const filter = {};
    if (req.query.resourceId) filter.resourceId = req.query.resourceId;

    const [items, total] = await Promise.all([
      StudentResourceDownload.find(filter)
        .sort({ downloadedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StudentResourceDownload.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        items: items.map((d) => ({
          id: d._id.toString(),
          resourceId: d.resourceId.toString(),
          resourceTitle: d.resourceTitle || '',
          fullName: d.fullName,
          phone: d.phone,
          downloadedAt: d.downloadedAt,
        })),
        total,
        limit,
        skip,
      },
    });
  } catch (err) {
    console.error('[StudentResource] adminDownloadLogs:', err);
    return res.status(500).json({ success: false, message: 'Failed to load download logs' });
  }
};

exports.publicList = async (req, res) => {
  try {
    const list = await StudentResource.find({ status: 'published' })
      .sort({ publishedAt: -1, createdAt: -1 })
      .lean();
    return res.json({ success: true, data: list.map(toPublicItem) });
  } catch (err) {
    console.error('[StudentResource] publicList:', err);
    return res.status(500).json({ success: false, message: 'Failed to load resources' });
  }
};

exports.requestDownload = async (req, res) => {
  try {
    const resource = await getPublishedResource(req.params.id);
    if (!resource) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    const { fullName } = req.body || {};
    const phoneRaw = req.body?.phone || req.body?.whatsappNumber;
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'fullName is required' });
    }
    if (phoneRaw == null || phoneRaw === '') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }

    const p = normalizePhone(phoneRaw);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }

    const canSend = await otpRepository.canSend(p);
    if (!canSend.allowed) {
      return res.status(429).json({
        success: false,
        message: canSend.message || 'Too many OTP requests. Try again later.',
        retryAfter: canSend.retryAfter,
      });
    }

    const privileged = isPrivilegedPhone(p);
    const otp = privileged ? getPrivilegedOtp() : generateOTP();
    const hashed = hashOTP(otp);
    const expiresAt = Date.now() + OTP_EXPIRY_MS;

    if (!privileged) {
      const gw = await sendOtpSms(p, otp);
      if (!gw.success) {
        return res.status(502).json({
          success: false,
          message: 'Could not send OTP.',
          detail: gw.error || 'SMS service error',
        });
      }
    }

    await otpRepository.saveOtp(p, hashed, expiresAt);

    return res.json({
      success: true,
      message: 'OTP sent successfully',
      occupation: OCCUPATION,
      resourceId: resource._id.toString(),
    });
  } catch (err) {
    console.error('[StudentResource] requestDownload:', err);
    return res.status(500).json({ success: false, message: 'Failed to send OTP' });
  }
};

exports.verifyDownload = async (req, res) => {
  try {
    const resource = await getPublishedResource(req.params.id);
    if (!resource) {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    const { fullName } = req.body || {};
    const phoneRaw = req.body?.phone || req.body?.whatsappNumber;
    const otp = req.body?.otp;

    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'fullName is required' });
    }
    if (phoneRaw == null || phoneRaw === '') {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }

    const p = normalizePhone(phoneRaw);
    if (!/^\d{10}$/.test(p)) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Indian phone required' });
    }

    const otpStr = otp != null ? String(otp).trim() : '';
    if (!/^\d{6}$/.test(otpStr)) {
      return res.status(400).json({ success: false, message: 'OTP must be 6 digits' });
    }

    let rec = await otpRepository.getLatest(p);
    if (!rec) {
      return res.status(400).json({
        success: false,
        message: 'No OTP found for this number. Request a new OTP.',
      });
    }
    if (new Date(rec.expiresAt) < new Date()) {
      await otpRepository.deleteOtp(p);
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new OTP.' });
    }
    if (rec.attempts >= MAX_VERIFY_ATTEMPTS) {
      await otpRepository.deleteOtp(p);
      return res.status(400).json({ success: false, message: 'Too many attempts. Please request a new OTP.' });
    }
    if (!verifyOTP(otpStr, rec.otpHash)) {
      const updated = await otpRepository.incrementAttempts(p);
      if (updated && updated.attempts >= MAX_VERIFY_ATTEMPTS) {
        await otpRepository.deleteOtp(p);
      }
      return res.status(400).json({ success: false, message: 'Invalid OTP. Please check the code and try again.' });
    }

    await otpRepository.deleteOtp(p);
    otpStore.addVerified(p);

    const now = new Date();
    await StudentResourceDownload.create({
      resourceId: resource._id,
      resourceTitle: resource.title,
      fullName: fullName.trim().slice(0, 120),
      phone: p,
      downloadedAt: now,
      otpVerifiedAt: now,
    });

    await StudentResource.findByIdAndUpdate(resource._id, { $inc: { downloadCount: 1 } });

    const downloadToken = signDownloadToken(resource._id.toString(), p);

    return res.json({
      success: true,
      message: 'OTP verified',
      downloadToken,
      fileName: resource.fileName,
    });
  } catch (err) {
    console.error('[StudentResource] verifyDownload:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP' });
  }
};

exports.downloadFile = async (req, res) => {
  try {
    const resource = await StudentResource.findById(req.params.id).lean();
    if (!resource || resource.status !== 'published') {
      return res.status(404).json({ success: false, message: 'Resource not found' });
    }

    const token = req.query.token;
    const phoneRaw = req.query.phone;
    if (!token || !phoneRaw) {
      return res.status(401).json({ success: false, message: 'Download token and phone are required' });
    }

    const p = normalizePhone(phoneRaw);
    if (!verifyDownloadToken(token, resource._id.toString(), p)) {
      return res.status(401).json({ success: false, message: 'Invalid or expired download token' });
    }

    const stream = await openDownloadStream(resource.gridFsFileId);
    res.setHeader('Content-Type', resource.mimeType || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(resource.fileName)}"`
    );
    stream.on('error', (err) => {
      console.error('[StudentResource] downloadFile stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Failed to download file' });
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[StudentResource] downloadFile:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: 'Failed to download file' });
    }
  }
};

exports.CHUNK_SIZE = CHUNK_SIZE;
exports.MAX_FILE_SIZE = MAX_FILE_SIZE;
