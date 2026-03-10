const crypto = require('crypto');
const WebinarCertificate = require('../models/WebinarCertificate');
const otpRepository = require('../utils/otpRepository');

function generateShortCertificateId() {
  return 'GX' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * POST /api/certificate — create or upsert a certificate record (public).
 * Body (by mobile, one ID per user): { fullName, dateIssued, mobileNumber }
 * Body (by certificateId, legacy): { certificateId, fullName, dateIssued }
 */
exports.createCertificate = async (req, res) => {
  try {
    const body = req.body || {};
    const { certificateId: bodyCertificateId, fullName, dateIssued, mobileNumber: bodyMobile } = body;

    const fullNameStr = typeof fullName === 'string' ? fullName.trim() : '';
    const dateIssuedStr = typeof dateIssued === 'string' ? dateIssued.trim() : '';
    if (!fullNameStr) {
      return res.status(400).json({ success: false, message: 'fullName is required.' });
    }
    if (!dateIssuedStr) {
      return res.status(400).json({ success: false, message: 'dateIssued is required.' });
    }

    const trimmedName = fullNameStr.slice(0, 200);
    const trimmedDate = dateIssuedStr.slice(0, 50);

    if (typeof bodyMobile === 'string' && bodyMobile.trim()) {
      const mobile = otpRepository.normalize(bodyMobile.trim());
      if (!mobile || mobile.length !== 10) {
        return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
      }
      let doc = await WebinarCertificate.findOne({ mobileNumber: mobile }).lean();
      if (doc) {
        await WebinarCertificate.updateOne(
          { certificateId: doc.certificateId },
          { $set: { fullName: trimmedName, dateIssued: trimmedDate } }
        );
        doc = { ...doc, fullName: trimmedName, dateIssued: trimmedDate };
      } else {
        const newCertificateId = generateShortCertificateId();
        const created = await WebinarCertificate.create({
          certificateId: newCertificateId,
          fullName: trimmedName,
          dateIssued: trimmedDate,
          mobileNumber: mobile,
        });
        doc = created.toObject ? created.toObject() : { certificateId: newCertificateId, fullName: trimmedName, dateIssued: trimmedDate, mobileNumber: mobile };
      }
      return res.status(200).json({
        success: true,
        data: {
          certificateId: doc.certificateId,
          fullName: doc.fullName,
          dateIssued: doc.dateIssued,
        },
      });
    }

    if (!bodyCertificateId || typeof bodyCertificateId !== 'string' || !bodyCertificateId.trim()) {
      return res.status(400).json({ success: false, message: 'certificateId or mobileNumber is required.' });
    }
    const doc = await WebinarCertificate.findOneAndUpdate(
      { certificateId: bodyCertificateId.trim() },
      { $set: { fullName: trimmedName, dateIssued: trimmedDate } },
      { new: true, upsert: true }
    ).lean();

    return res.status(200).json({
      success: true,
      data: {
        certificateId: doc.certificateId,
        fullName: doc.fullName,
        dateIssued: doc.dateIssued,
      },
    });
  } catch (err) {
    console.error('[createCertificate]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * POST /api/certificate/migrate-short-id — replace legacy UUID with short GX id for a user (by mobile).
 * Body: { mobileNumber }
 */
exports.migrateToShortId = async (req, res) => {
  try {
    const mobileNumber = req.body?.mobileNumber;
    if (!mobileNumber || typeof mobileNumber !== 'string' || !mobileNumber.trim()) {
      return res.status(400).json({ success: false, message: 'mobileNumber is required.' });
    }
    const mobile = otpRepository.normalize(mobileNumber.trim());
    if (!mobile || mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
    }
    const doc = await WebinarCertificate.findOne({ mobileNumber: mobile }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Certificate not found.' });
    }
    const currentId = doc.certificateId != null ? String(doc.certificateId).trim() : '';
    if (currentId.startsWith('GX')) {
      return res.status(200).json({ success: true, data: { certificateId: currentId } });
    }
    const newCertificateId = generateShortCertificateId();
    await WebinarCertificate.updateOne(
      { mobileNumber: mobile },
      { $set: { certificateId: newCertificateId } }
    );
    return res.status(200).json({ success: true, data: { certificateId: newCertificateId } });
  } catch (err) {
    console.error('[migrateToShortId]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

/**
 * GET /api/certificate/:id — get certificate by certificateId (public).
 */
exports.getCertificateById = async (req, res) => {
  try {
    const id = (req.params.id != null ? String(req.params.id) : '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: 'Certificate ID is required.' });
    }

    const doc = await WebinarCertificate.findOne({ certificateId: id }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Certificate not found.' });
    }
    // Return the stored certificate ID (earlier ID) so frontend uses same ID on certificate and preview
    const storedCertificateId = doc.certificateId != null ? String(doc.certificateId).trim() : id;

    return res.status(200).json({
      success: true,
      data: {
        certificateId: storedCertificateId,
        fullName: doc.fullName,
        dateIssued: doc.dateIssued,
      },
    });
  } catch (err) {
    console.error('[getCertificateById]', err);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
