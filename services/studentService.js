const Student = require('../models/Student');
const { STATUS_ENUM } = require('../models/Student');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const EXPORT_LIMIT = 5000;

function buildListQuery(counsellorId, filters = {}) {
  const query = { counsellorId };

  if (filters.deleted !== true) {
    query.deletedAt = null;
  } else {
    query.deletedAt = { $ne: null };
  }

  if (filters.course && String(filters.course).trim()) {
    query.course = new RegExp(String(filters.course).trim(), 'i');
  }
  if (filters.status && STATUS_ENUM.includes(filters.status)) {
    query.status = filters.status;
  }
  if (filters.joinedFrom) {
    query.joinedAt = query.joinedAt || {};
    query.joinedAt.$gte = new Date(filters.joinedFrom);
  }
  if (filters.joinedTo) {
    query.joinedAt = query.joinedAt || {};
    query.joinedAt.$lte = new Date(filters.joinedTo);
  }

  if (filters.q && String(filters.q).trim()) {
    const q = String(filters.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(q, 'i');
    query.$or = [
      { fullName: re },
      { email: re },
      { phone: re },
    ];
  }

  return query;
}

async function list(counsellorId, params = {}) {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(params.limit, 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const filters = {
    course: params.course,
    status: params.status,
    joinedFrom: params.joinedFrom,
    joinedTo: params.joinedTo,
    deleted: params.deleted === 'true' || params.deleted === true,
    q: params.q,
  };

  const query = buildListQuery(counsellorId, filters);
  const [data, total] = await Promise.all([
    Student.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Student.countDocuments(query),
  ]);

  return { data, total, page, limit };
}

async function getOne(counsellorId, studentId) {
  const student = await Student.findOne({
    _id: studentId,
    counsellorId,
  }).lean();
  return student;
}

function validateCreate(body) {
  const err = [];
  if (!body.fullName || !String(body.fullName).trim()) err.push('fullName is required');
  if (!body.phone || !String(body.phone).trim()) err.push('phone is required');
  if (!body.course || !String(body.course).trim()) err.push('course is required');
  if (body.status && !STATUS_ENUM.includes(body.status)) err.push('status must be one of: ' + STATUS_ENUM.join(', '));
  return err;
}

async function create(counsellorId, body) {
  const doc = {
    counsellorId,
    fullName: String(body.fullName).trim(),
    phone: String(body.phone).trim(),
    course: String(body.course).trim(),
    email: body.email != null ? String(body.email).trim() : '',
    notes: body.notes != null ? String(body.notes).trim() : '',
    status: body.status && STATUS_ENUM.includes(body.status) ? body.status : 'active',
    joinedAt: body.joinedAt ? new Date(body.joinedAt) : new Date(),
    createdBy: counsellorId,
  };
  const student = await Student.create(doc);
  return student.toObject();
}

function validateUpdate(body) {
  const err = [];
  if (body.status != null && !STATUS_ENUM.includes(body.status)) err.push('status must be one of: ' + STATUS_ENUM.join(', '));
  return err;
}

async function update(counsellorId, studentId, body) {
  const student = await Student.findOne({ _id: studentId, counsellorId });
  if (!student) return null;

  const allowed = ['fullName', 'email', 'phone', 'course', 'status', 'notes', 'joinedAt'];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === 'email' || key === 'notes') student[key] = body[key] != null ? String(body[key]).trim() : '';
      else if (key === 'joinedAt') student[key] = body[key] ? new Date(body[key]) : student[key];
      else if (key === 'fullName' || key === 'phone' || key === 'course') student[key] = String(body[key]).trim();
      else student[key] = body[key];
    }
  }
  student.updatedBy = counsellorId;
  await student.save();
  return student.toObject();
}

async function softDelete(counsellorId, studentId) {
  const student = await Student.findOneAndUpdate(
    { _id: studentId, counsellorId, deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { new: true }
  );
  return student ? student.toObject() : null;
}

async function restore(counsellorId, studentId) {
  const student = await Student.findOneAndUpdate(
    { _id: studentId, counsellorId, deletedAt: { $ne: null } },
    { $set: { deletedAt: null } },
    { new: true }
  );
  return student ? student.toObject() : null;
}

async function bulkUpdateStatus(counsellorId, ids, status) {
  if (!Array.isArray(ids) || ids.length === 0 || !STATUS_ENUM.includes(status)) {
    return { modifiedCount: 0 };
  }
  const result = await Student.updateMany(
    { _id: { $in: ids }, counsellorId, deletedAt: null },
    { $set: { status, updatedAt: new Date() } }
  );
  return { modifiedCount: result.modifiedCount };
}

async function bulkSoftDelete(counsellorId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { modifiedCount: 0 };
  }
  const result = await Student.updateMany(
    { _id: { $in: ids }, counsellorId, deletedAt: null },
    { $set: { deletedAt: new Date() } }
  );
  return { modifiedCount: result.modifiedCount };
}

async function exportList(counsellorId, params = {}) {
  const filters = {
    course: params.course,
    status: params.status,
    joinedFrom: params.joinedFrom,
    joinedTo: params.joinedTo,
    deleted: params.deleted === 'true' || params.deleted === true,
    q: params.q,
  };
  const query = buildListQuery(counsellorId, filters);
  const data = await Student.find(query).sort({ createdAt: -1 }).limit(EXPORT_LIMIT).lean();
  return data;
}

module.exports = {
  list,
  getOne,
  validateCreate,
  validateUpdate,
  create,
  update,
  softDelete,
  restore,
  bulkUpdateStatus,
  bulkSoftDelete,
  exportList,
};
