const studentService = require('../services/studentService');

function escapeCsvCell(val) {
  if (val == null) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

exports.list = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const params = {
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      course: req.query.course,
      status: req.query.status,
      joinedFrom: req.query.joinedFrom,
      joinedTo: req.query.joinedTo,
      deleted: req.query.deleted,
    };
    const result = await studentService.list(counsellorId, params);
    return res.json(result);
  } catch (error) {
    console.error('[studentController.list]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getOne = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const student = await studentService.getOne(counsellorId, req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    return res.json(student);
  } catch (error) {
    console.error('[studentController.getOne]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.create = async (req, res) => {
  try {
    const validationErrors = studentService.validateCreate(req.body || {});
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, message: validationErrors.join('; ') });
    }
    const counsellorId = req.counsellor._id;
    const student = await studentService.create(counsellorId, req.body);
    return res.status(201).json(student);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg });
    }
    console.error('[studentController.create]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.update = async (req, res) => {
  try {
    const validationErrors = studentService.validateUpdate(req.body || {});
    if (validationErrors.length > 0) {
      return res.status(400).json({ success: false, message: validationErrors.join('; ') });
    }
    const counsellorId = req.counsellor._id;
    const student = await studentService.update(counsellorId, req.params.id, req.body);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    return res.json(student);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const msg = Object.values(error.errors).map((e) => e.message).join('; ');
      return res.status(400).json({ success: false, message: msg });
    }
    console.error('[studentController.update]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.softDelete = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const student = await studentService.softDelete(counsellorId, req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    return res.json({ success: true, message: 'Student deleted' });
  } catch (error) {
    console.error('[studentController.softDelete]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.restore = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const student = await studentService.restore(counsellorId, req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found or not deleted' });
    }
    return res.json(student);
  } catch (error) {
    console.error('[studentController.restore]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.bulkUpdateStatus = async (req, res) => {
  try {
    const { ids, status } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array is required' });
    }
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }
    const counsellorId = req.counsellor._id;
    const result = await studentService.bulkUpdateStatus(counsellorId, ids, status);
    return res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error('[studentController.bulkUpdateStatus]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.bulkSoftDelete = async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array is required' });
    }
    const counsellorId = req.counsellor._id;
    const result = await studentService.bulkSoftDelete(counsellorId, ids);
    return res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error('[studentController.bulkSoftDelete]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.exportStudents = async (req, res) => {
  try {
    const counsellorId = req.counsellor._id;
    const params = {
      q: req.query.q,
      course: req.query.course,
      status: req.query.status,
      joinedFrom: req.query.joinedFrom,
      joinedTo: req.query.joinedTo,
      deleted: req.query.deleted,
    };
    const data = await studentService.exportList(counsellorId, params);
    const header = [
      'ID', 'Full Name', 'Email', 'Phone', 'Course', 'Status', 'Joined', 'Notes', 'Created', 'Updated', 'Deleted At',
    ];
    const rows = data.map((d) => [
      d._id,
      d.fullName,
      d.email || '',
      d.phone,
      d.course,
      d.status,
      d.joinedAt ? new Date(d.joinedAt).toISOString().slice(0, 10) : '',
      d.notes || '',
      d.createdAt ? new Date(d.createdAt).toISOString() : '',
      d.updatedAt ? new Date(d.updatedAt).toISOString() : '',
      d.deletedAt ? new Date(d.deletedAt).toISOString() : '',
    ]);
    const csvLines = [header.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))];
    const csv = csvLines.join('\r\n');
    const filename = `students-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (error) {
    console.error('[studentController.exportStudents]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
