'use strict';

const Admin = require('../../../models/Admin');
const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const {
  COPILOT_AGENT_ROLES,
  COPILOT_AVAILABILITY,
  DEFAULT_MAX_CONCURRENT,
  LEGACY_SLOTS,
  ROLE_LABELS,
} = require('./humanCopilotAgentConstants');
const { COPILOT_QUEUE_STATES } = require('./humanCopilotConstants');

const HUMAN_COPILOT_SECTION = 'human-copilot';
const ACTIVE_STATUSES = ['open', 'claimed'];

function getProfile(admin) {
  return admin?.copilotAgentProfile || {};
}

function isCopilotAgent(admin) {
  if (!admin) return false;
  if (admin.isSuperAdmin) return Boolean(getProfile(admin).enabled);
  const hasAccess =
    Array.isArray(admin.sectionAccess) && admin.sectionAccess.includes(HUMAN_COPILOT_SECTION);
  return hasAccess && Boolean(getProfile(admin).enabled);
}

function mapAgentRow(admin, activeCount = 0) {
  const profile = getProfile(admin);
  const capacity = profile.maxConcurrentConversations ?? DEFAULT_MAX_CONCURRENT;
  const workloadPercent =
    capacity > 0 ? Math.min(100, Math.round((activeCount / capacity) * 100)) : 0;

  return {
    id: String(admin._id),
    username: admin.username,
    name: admin.name || admin.username,
    role: profile.role || 'sr_counsellor',
    roleLabel: ROLE_LABELS[profile.role] || profile.role,
    availability: profile.availability || 'active',
    enabled: Boolean(profile.enabled),
    specialties: profile.specialties || [],
    legacySlot: profile.legacySlot || null,
    maxConcurrentConversations: capacity,
    activeConversations: activeCount,
    capacity,
    workloadPercent,
    assignable: isAgentAssignable(admin, activeCount),
  };
}

function isAgentAssignable(admin, activeCount = null) {
  const profile = getProfile(admin);
  if (!profile.enabled) return false;
  if (profile.availability === 'offline') return false;
  const capacity = profile.maxConcurrentConversations ?? DEFAULT_MAX_CONCURRENT;
  const count = activeCount ?? 0;
  return count < capacity;
}

async function countActiveConversationsForAgent(admin) {
  const profile = getProfile(admin);
  const agentId = admin._id;
  const orClauses = [{ assignedAgentId: agentId }];
  if (profile.legacySlot && LEGACY_SLOTS.includes(profile.legacySlot)) {
    orClauses.push({ assignedSrCounsellor: profile.legacySlot, assignedAgentId: null });
  }

  return WhatsAppAgentHandoff.countDocuments({
    route: 'admin_pool',
    status: { $in: ACTIVE_STATUSES },
    copilotState: { $in: COPILOT_QUEUE_STATES },
    $or: orClauses,
  });
}

async function countActiveConversations(agentId) {
  const admin = await Admin.findById(agentId).select('copilotAgentProfile').lean();
  if (!admin) return 0;
  return countActiveConversationsForAgent(admin);
}

async function listAgentAdmins() {
  const admins = await Admin.find({
    $or: [
      { isSuperAdmin: true, 'copilotAgentProfile.enabled': true },
      {
        sectionAccess: HUMAN_COPILOT_SECTION,
        'copilotAgentProfile.enabled': true,
      },
    ],
  })
    .select('username name isSuperAdmin sectionAccess copilotAgentProfile')
    .lean();

  return admins.filter(isCopilotAgent);
}

async function listAgents() {
  const admins = await listAgentAdmins();
  const rows = await Promise.all(
    admins.map(async (admin) => {
      const activeCount = await countActiveConversationsForAgent(admin);
      return mapAgentRow(admin, activeCount);
    })
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveLegacySlot(slot) {
  if (!LEGACY_SLOTS.includes(slot)) return null;
  const admin = await Admin.findOne({
    'copilotAgentProfile.enabled': true,
    'copilotAgentProfile.legacySlot': slot,
  })
    .select('username name copilotAgentProfile')
    .lean();
  return admin;
}

async function getAgentById(adminId) {
  const admin = await Admin.findById(adminId)
    .select('username name isSuperAdmin sectionAccess copilotAgentProfile')
    .lean();
  if (!admin || !isCopilotAgent(admin)) return null;
  const activeCount = await countActiveConversationsForAgent(admin);
  return mapAgentRow(admin, activeCount);
}

async function updateAgentStatus(adminId, availability) {
  if (!COPILOT_AVAILABILITY.includes(availability)) {
    return { success: false, error: 'invalid_availability' };
  }

  const admin = await Admin.findByIdAndUpdate(
    adminId,
    { $set: { 'copilotAgentProfile.availability': availability, updatedAt: new Date() } },
    { new: true }
  )
    .select('username name copilotAgentProfile')
    .lean();

  if (!admin) return { success: false, error: 'not_found' };
  const activeCount = await countActiveConversationsForAgent(admin);
  return { success: true, agent: mapAgentRow(admin, activeCount) };
}

async function updateAgentSettings(adminId, settings = {}) {
  const updates = { updatedAt: new Date() };

  if (settings.enabled != null) {
    updates['copilotAgentProfile.enabled'] = Boolean(settings.enabled);
  }
  if (settings.role != null) {
    if (!COPILOT_AGENT_ROLES.includes(settings.role)) {
      return { success: false, error: 'invalid_role' };
    }
    updates['copilotAgentProfile.role'] = settings.role;
  }
  if (settings.availability != null) {
    if (!COPILOT_AVAILABILITY.includes(settings.availability)) {
      return { success: false, error: 'invalid_availability' };
    }
    updates['copilotAgentProfile.availability'] = settings.availability;
  }
  if (settings.maxConcurrentConversations != null) {
    const max = parseInt(settings.maxConcurrentConversations, 10);
    if (!Number.isFinite(max) || max < 1 || max > 50) {
      return { success: false, error: 'invalid_max_concurrent' };
    }
    updates['copilotAgentProfile.maxConcurrentConversations'] = max;
  }
  if (settings.specialties != null) {
    updates['copilotAgentProfile.specialties'] = (settings.specialties || [])
      .map((s) => String(s).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
  }
  if (settings.legacySlot !== undefined) {
    if (settings.legacySlot && !LEGACY_SLOTS.includes(settings.legacySlot)) {
      return { success: false, error: 'invalid_legacy_slot' };
    }
    updates['copilotAgentProfile.legacySlot'] = settings.legacySlot || null;
  }

  const admin = await Admin.findByIdAndUpdate(adminId, { $set: updates }, { new: true })
    .select('username name copilotAgentProfile')
    .lean();

  if (!admin) return { success: false, error: 'not_found' };
  const activeCount = await countActiveConversationsForAgent(admin);
  return { success: true, agent: mapAgentRow(admin, activeCount) };
}

async function hasConfiguredAgents() {
  const count = await Admin.countDocuments({
    'copilotAgentProfile.enabled': true,
    $or: [
      { isSuperAdmin: true },
      { sectionAccess: HUMAN_COPILOT_SECTION },
    ],
  });
  return count > 0;
}

async function listAssignableAgents() {
  const admins = await listAgentAdmins();
  const withWorkload = await Promise.all(
    admins.map(async (admin) => {
      const activeCount = await countActiveConversationsForAgent(admin);
      return { admin, activeCount, assignable: isAgentAssignable(admin, activeCount) };
    })
  );
  return withWorkload.filter((row) => row.assignable);
}

module.exports = {
  mapAgentRow,
  isCopilotAgent,
  isAgentAssignable,
  countActiveConversations,
  countActiveConversationsForAgent,
  listAgents,
  listAssignableAgents,
  listAgentAdmins,
  resolveLegacySlot,
  getAgentById,
  updateAgentStatus,
  updateAgentSettings,
  hasConfiguredAgents,
};
