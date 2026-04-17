const Counsellor = require('../models/Counsellor');

exports.getCertifiedCounsellors = async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const match = {};
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      match.$or = [{ name: re }, { email: re }, { phone: re }];
    }

    const rows = await Counsellor.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'students',
          let: { counsellorId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$counsellorId', '$$counsellorId'] },
                    { $eq: ['$createdBy', '$$counsellorId'] },
                    { $eq: ['$deletedAt', null] },
                  ],
                },
              },
            },
            { $count: 'total' },
          ],
          as: 'studentStats',
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          phone: 1,
          createdAt: 1,
          studentCount: { $ifNull: [{ $arrayElemAt: ['$studentStats.total', 0] }, 0] },
        },
      },
      { $sort: { studentCount: -1, name: 1 } },
    ]);

    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[getCertifiedCounsellors] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
