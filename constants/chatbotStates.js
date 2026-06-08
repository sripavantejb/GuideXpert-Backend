/** WhatsApp chatbot state machine and related enums. */

const PRODUCT_LINES = Object.freeze(['guidexpert', 'iit_counselling', 'unknown']);

const CONVERSATION_STATUSES = Object.freeze(['active', 'closed', 'handoff']);

const BOT_STATES = Object.freeze([
  'greeting',
  'main_menu',
  'faq',
  'faq_answer',
  'lead_lookup',
  'counselling_support',
  'assigned_expert',
  'demo_support',
  'rank_predictor',
  'college_predictor',
  'human_handoff',
  'idle',
]);

const INBOUND_MESSAGE_TYPES = Object.freeze([
  'text',
  'button_reply',
  'list_reply',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'interactive',
  'unknown',
]);

const INBOUND_PROCESS_STATUSES = Object.freeze([
  'pending',
  'processing',
  'processed',
  'skipped',
  'failed',
]);

const OUTBOUND_MESSAGE_TYPES = Object.freeze([
  'text',
  'interactive_button',
  'interactive_list',
  'image',
  'template_fallback',
]);

const OUTBOUND_SENDER_TYPES = Object.freeze(['bot', 'agent', 'system']);

const OUTBOUND_STATUSES = Object.freeze([
  'queued',
  'submitted',
  'sent',
  'delivered',
  'read',
  'failed',
]);

const HANDOFF_STATUSES = Object.freeze(['open', 'claimed', 'resolved', 'expired', 'cancelled']);

const HANDOFF_ROUTES = Object.freeze(['bda', 'admin_pool']);

const HANDOFF_REASONS = Object.freeze([
  'user_requested',
  'bot_escalation',
  'low_confidence',
  'keyword',
  'admin_initiated',
]);

const WEBHOOK_EVENT_KINDS = Object.freeze(['inbound', 'dlr', 'unknown']);

// menu: command words only; hi/hello/hey use whole-message matching in intentClassifierService
const GLOBAL_KEYWORDS = Object.freeze({
  menu: ['menu', 'help', 'start'],
  agent: ['agent', 'human', 'person', 'talk to someone', 'counsellor', 'counselor', 'support'],
  stop: ['stop', 'unsubscribe', 'opt out', 'optout'],
  cancel: ['cancel'],
});

module.exports = {
  PRODUCT_LINES,
  CONVERSATION_STATUSES,
  BOT_STATES,
  INBOUND_MESSAGE_TYPES,
  INBOUND_PROCESS_STATUSES,
  OUTBOUND_MESSAGE_TYPES,
  OUTBOUND_SENDER_TYPES,
  OUTBOUND_STATUSES,
  HANDOFF_STATUSES,
  HANDOFF_ROUTES,
  HANDOFF_REASONS,
  WEBHOOK_EVENT_KINDS,
  GLOBAL_KEYWORDS,
};
