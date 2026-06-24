'use strict';

const { ensureBackfilled, backfillLeadLifecycleEvents } = require('../services/analytics/leadLifecycleBackfillService');
const { getLifecycleFunnel } = require('../services/analytics/leadLifecycleFunnelService');
const { getExecutiveSummary } = require('../services/analytics/analyticsExecutiveService');
const { getLifecycleValidationReport } = require('../services/analytics/leadLifecycleValidationService');
const { warmDefaultSnapshots } = require('../services/analytics/leadLifecycleSnapshotService');

exports.getLifecycleFunnel = async (req, res) => {
  try {
    await ensureBackfilled();
    const result = await getLifecycleFunnel(req.query || {});
    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[getLifecycleFunnel]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getExecutiveSummary = async (req, res) => {
  try {
    await ensureBackfilled();
    const data = await getExecutiveSummary(req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getExecutiveSummary]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getLifecycleValidation = async (req, res) => {
  try {
    await ensureBackfilled();
    const data = await getLifecycleValidationReport(req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getLifecycleValidation]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.postLifecycleBackfill = async (req, res) => {
  try {
    const clearExisting = req.body?.clearExisting === true || req.query?.clear === 'true';
    const warmSnapshots = req.body?.warmSnapshots === true || req.query?.warm === 'true';
    const stats = await backfillLeadLifecycleEvents({ clearExisting });
    if (warmSnapshots) {
      stats.snapshotsWarmed = await warmDefaultSnapshots(req.query || {});
    }
    return res.status(200).json({ success: true, data: stats });
  } catch (error) {
    console.error('[postLifecycleBackfill]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
