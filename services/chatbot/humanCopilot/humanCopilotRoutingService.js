'use strict';

const HumanCopilotConfig = require('../../../models/HumanCopilotConfig');
const WhatsAppAgentHandoff = require('../../../models/WhatsAppAgentHandoff');
const { extractEditTopic } = require('./humanCopilotTopicUtils');
const {
  COPILOT_ROUTING_MODES,
  SPECIALTY_TOPIC_MAP,
  ROLE_BY_SPECIALTY,
  FALLBACK_ROLE,
  ROUTING_MODE_LABELS,
} = require('./humanCopilotAgentConstants');
const { buildAuditEntry } = require('./humanCopilotAuditService');

function configService() {
  return require('../../../models/HumanCopilotConfig');
}

function agentService() {
  return require('./humanCopilotAgentService');
}

const MAX_WORKLOAD_SNAPSHOTS = 50;

function detectSpecialty(handoff) {
  const text = [handoff.userLastMessage, handoff.summaryForAgent].filter(Boolean).join(' ');
  const topic = extractEditTopic(text);

  if (handoff.productLine === 'iit_counselling') {
    return { specialty: 'iit', reason: 'iit_product_line' };
  }

  if (topic === 'scholarship') {
    return { specialty: 'scholarship', reason: 'scholarship_topic_detected' };
  }

  const mapped = SPECIALTY_TOPIC_MAP[topic];
  if (mapped) {
    return { specialty: mapped, reason: `${mapped}_topic_detected` };
  }

  if (/\biit\b/i.test(text)) {
    return { specialty: 'iit', reason: 'iit_topic_detected' };
  }

  return { specialty: null, reason: 'no_specialty_detected' };
}

function agentMatchesSpecialty(admin, specialty) {
  const profile = admin.copilotAgentProfile || {};
  const specialties = profile.specialties || [];
  if (specialties.includes(specialty)) return true;
  const expectedRole = ROLE_BY_SPECIALTY[specialty];
  return expectedRole && profile.role === expectedRole;
}

function agentMatchesRole(admin, role) {
  return (admin.copilotAgentProfile || {}).role === role;
}

async function filterAssignable(agentsWithWorkload) {
  return agentsWithWorkload.filter((row) => row.assignable);
}

async function pickRoundRobin(assignable, cursorId) {
  if (!assignable.length) return null;
  const sorted = [...assignable].sort((a, b) =>
    String(a.admin._id).localeCompare(String(b.admin._id))
  );
  if (!cursorId) return sorted[0];

  const cursorIdx = sorted.findIndex((row) => String(row.admin._id) === String(cursorId));
  const nextIdx = cursorIdx >= 0 ? (cursorIdx + 1) % sorted.length : 0;
  return sorted[nextIdx];
}

async function pickLeastWorkload(assignable) {
  if (!assignable.length) return null;
  return assignable.reduce((best, row) =>
    row.activeCount < best.activeCount ? row : best
  );
}

async function selectAgentForHandoff(handoff, { modeOverride, config: configIn } = {}) {
  const config = configIn || (await configService().getOrCreateConfig());
  const routingMode = modeOverride || config.routingMode || 'manual';

  if (routingMode === 'manual') {
    return {
      agent: null,
      agentId: null,
      routingMode,
      reason: 'manual_mode',
      fallback: null,
    };
  }

  const allAgents = await agentService().listAgentAdmins();
  const withWorkload = await Promise.all(
    allAgents.map(async (admin) => {
      const activeCount = await agentService().countActiveConversationsForAgent(admin);
      return {
        admin,
        activeCount,
        assignable: agentService().isAgentAssignable(admin, activeCount),
      };
    })
  );

  const assignable = await filterAssignable(withWorkload);
  if (!assignable.length) {
    return {
      agent: null,
      agentId: null,
      routingMode,
      reason: 'no_eligible_agent',
      fallback: null,
    };
  }

  let picked = null;
  let reason = null;
  let fallback = null;

  if (routingMode === 'round_robin') {
    picked = await pickRoundRobin(assignable, config.roundRobinCursor);
    reason = 'round_robin_next';
  } else if (routingMode === 'least_workload') {
    picked = await pickLeastWorkload(assignable);
    reason = 'least_workload';
  } else if (routingMode === 'specialty') {
    const { specialty, reason: detectReason } = detectSpecialty(handoff);
    if (!specialty) {
      const generalCandidates = assignable.filter((row) =>
        agentMatchesRole(row.admin, FALLBACK_ROLE)
      );
      picked = generalCandidates[0] || assignable[0];
      reason = 'fallback_general_counsellor';
      fallback = { used: true, role: FALLBACK_ROLE, reason: detectReason };
    } else {
      const specialists = assignable.filter((row) => agentMatchesSpecialty(row.admin, specialty));
      if (specialists.length) {
        picked = await pickLeastWorkload(specialists);
        reason = detectReason;
      } else {
        const generalCandidates = assignable.filter((row) =>
          agentMatchesRole(row.admin, FALLBACK_ROLE)
        );
        picked = generalCandidates[0] || (await pickLeastWorkload(assignable));
        reason = 'fallback_general_counsellor';
        fallback = { used: true, role: FALLBACK_ROLE, reason: `no_${specialty}_specialist` };
      }
    }
  }

  if (!picked) {
    return {
      agent: null,
      agentId: null,
      routingMode,
      reason: 'no_eligible_agent',
      fallback,
    };
  }

  const agentRow = agentService().mapAgentRow(picked.admin, picked.activeCount);
  return {
    agent: agentRow,
    agentId: agentRow.id,
    routingMode,
    reason,
    fallback,
  };
}

function incrementCounter(obj, key) {
  const next = { ...(obj || {}) };
  next[key] = (next[key] || 0) + 1;
  return next;
}

async function recordRoutingAnalytics(config, decision, agentAdmin) {
  const analytics = config.routingAnalytics || {};
  const agentId = decision.agentId || 'none';
  const role = agentAdmin?.copilotAgentProfile?.role || 'unknown';

  const assignmentCounts = incrementCounter(analytics.assignmentCounts, decision.routingMode);
  const routingReasons = incrementCounter(analytics.routingReasons, decision.reason);
  const specialistUsage =
    decision.reason && decision.reason.includes('topic')
      ? incrementCounter(analytics.specialistUsage, decision.reason)
      : analytics.specialistUsage || {};

  const workloadSnapshots = [...(analytics.workloadSnapshots || [])];
  if (decision.agent) {
    workloadSnapshots.push({
      agentId: decision.agentId,
      activeConversations: decision.agent.activeConversations,
      at: new Date(),
    });
  }
  if (workloadSnapshots.length > MAX_WORKLOAD_SNAPSHOTS) {
    workloadSnapshots.splice(0, workloadSnapshots.length - MAX_WORKLOAD_SNAPSHOTS);
  }

  await HumanCopilotConfig.updateOne(
    { _id: config._id },
    {
      $set: {
        routingAnalytics: {
          assignmentCounts,
          routingReasons,
          specialistUsage,
          overloadEvents: analytics.overloadEvents || 0,
          workloadSnapshots,
        },
        updatedAt: new Date(),
      },
    }
  );
}

async function updateRoundRobinCursor(config, agentId) {
  await HumanCopilotConfig.updateOne(
    { _id: config._id },
    { $set: { roundRobinCursor: agentId, updatedAt: new Date() } }
  );
}

async function updateRoutingSettings(settings = {}) {
  const config = await configService().getOrCreateConfig();
  const updates = { updatedAt: new Date() };

  if (settings.routingMode != null) {
    if (!COPILOT_ROUTING_MODES.includes(settings.routingMode)) {
      return { success: false, error: 'invalid_routing_mode' };
    }
    updates.routingMode = settings.routingMode;
  }
  if (settings.specialtyRules != null) {
    updates.specialtyRules = settings.specialtyRules;
  }

  const doc = await HumanCopilotConfig.findByIdAndUpdate(config._id, { $set: updates }, { new: true }).lean();
  return { success: true, config: doc };
}

async function getRoutingConfig() {
  const config = await configService().getOrCreateConfig();
  return {
    routingMode: config.routingMode || 'manual',
    routingModeLabel: ROUTING_MODE_LABELS[config.routingMode] || config.routingMode,
    specialtyRules: config.specialtyRules || {},
    fallbackRole: FALLBACK_ROLE,
    roundRobinCursor: config.roundRobinCursor ? String(config.roundRobinCursor) : null,
    analytics: config.routingAnalytics || {},
    updatedAt: config.updatedAt,
  };
}

async function legacySrRoundRobin(handoffId) {
  const count = await WhatsAppAgentHandoff.countDocuments({ route: 'admin_pool' });
  const slot = count % 2 === 0 ? 'sr1' : 'sr2';
  return WhatsAppAgentHandoff.findByIdAndUpdate(
    handoffId,
    {
      $set: {
        assignedSrCounsellor: slot,
        copilotState: 'assigned',
        assignedAt: new Date(),
      },
    },
    { new: true }
  );
}

async function autoAssignHandoff(handoffId, { assignFn } = {}) {
  const handoff = await WhatsAppAgentHandoff.findById(handoffId).lean();
  if (!handoff || handoff.route !== 'admin_pool') {
    return { success: false, error: 'not_found' };
  }
  if (handoff.assignedSrCounsellor || handoff.assignedAgentId) {
    return { success: false, error: 'already_assigned', reason: 'already_assigned' };
  }

  const agentsExist = await agentService().hasConfiguredAgents();

  if (!agentsExist) {
    const updated = await legacySrRoundRobin(handoffId);
    if (!updated) return { success: false, error: 'assign_failed' };
    return {
      success: true,
      assigned: true,
      routingMode: 'legacy_sr_round_robin',
      reason: 'legacy_fallback',
      handoff: updated,
    };
  }

  const config = await configService().getOrCreateConfig();

  const decision = await selectAgentForHandoff(handoff, { config });
  if (!decision.agentId) {
    await WhatsAppAgentHandoff.updateOne(
      { _id: handoffId },
      {
        $push: {
          auditTrail: buildAuditEntry({
            action: 'routing_skipped',
            meta: { routingMode: decision.routingMode, reason: decision.reason },
          }),
        },
      }
    );
    return {
      success: true,
      assigned: false,
      routingMode: decision.routingMode,
      reason: decision.reason,
      fallback: decision.fallback,
    };
  }

  const assign = assignFn || require('./humanCopilotService').assignHandoffByAgent;
  const result = await assign(handoffId, decision.agentId, null, {
    routingDecision: decision,
    isAutoAssign: true,
  });

  if (!result.success) {
    if (result.error === 'agent_overloaded') {
      const analytics = config.routingAnalytics || {};
      await HumanCopilotConfig.updateOne(
        { _id: config._id },
        {
          $set: {
            'routingAnalytics.overloadEvents': (analytics.overloadEvents || 0) + 1,
            updatedAt: new Date(),
          },
        }
      );
    }
    return { success: false, ...result, routingMode: decision.routingMode, reason: decision.reason };
  }

  if (decision.routingMode === 'round_robin') {
    await updateRoundRobinCursor(config, decision.agentId);
  }

  const agentAdmin = decision.agent
    ? { copilotAgentProfile: { role: decision.agent.role } }
    : null;
  await recordRoutingAnalytics(config, decision, agentAdmin);

  return {
    success: true,
    assigned: true,
    agent: decision.agent,
    agentId: decision.agentId,
    routingMode: decision.routingMode,
    reason: decision.reason,
    fallback: decision.fallback,
    handoff: result.handoff,
    lockVersion: result.lockVersion,
  };
}

module.exports = {
  detectSpecialty,
  selectAgentForHandoff,
  autoAssignHandoff,
  getRoutingConfig,
  updateRoutingSettings,
  recordRoutingAnalytics,
  legacySrRoundRobin,
};
