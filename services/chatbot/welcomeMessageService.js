/**
 * Phase 1 welcome / main-menu copy by product line (iit_counselling | guidexpert | unknown).
 */

function extractFirstName(fullName) {
  const n = String(fullName || '').trim();
  if (!n) return null;
  const first = n.split(/\s+/)[0];
  return first || null;
}

function resolveDisplayName(leadContext) {
  const line = leadContext?.productLine || 'unknown';
  if (line === 'iit_counselling') {
    return extractFirstName(leadContext?.iit?.fullName);
  }
  if (line === 'guidexpert') {
    return extractFirstName(leadContext?.gx?.fullName);
  }
  return null;
}

/**
 * Salutation line for IIT / GX known leads.
 */
function formatWelcomeSalutation(leadContext) {
  const firstName = resolveDisplayName(leadContext);
  const line = leadContext?.productLine || 'unknown';
  if (line === 'iit_counselling') {
    return firstName ? `🎓 Hi ${firstName}!` : '🎓 Hi there!';
  }
  if (line === 'guidexpert') {
    return firstName ? `💼 Hi ${firstName}!` : '💼 Hi there!';
  }
  return null;
}

function buildIitStudentWelcome(leadContext) {
  const salutation = formatWelcomeSalutation(leadContext);
  return [
    salutation,
    '',
    'Welcome back to GuideXpert.',
    '',
    "We're here to support your IIT & Engineering counselling journey and help you make confident college decisions.",
    '',
    'What would you like help with today?',
    '',
    '1️⃣ My Counselling Details',
    '2️⃣ My Meeting Link',
    '3️⃣ My Assigned Expert',
    '4️⃣ Rank Predictor',
    '5️⃣ College Predictor',
    '6️⃣ Talk to My Counsellor',
    '',
    'You can also ask questions naturally, such as:',
    '',
    '• When is my counselling session?',
    '• Who is my assigned expert?',
    '• Share my meeting link?',
    '• What documents should I keep ready?',
    '',
    "We're excited to be part of your journey towards the right college and career.",
  ].join('\n');
}

function buildGuidexpertLeadWelcome(leadContext) {
  const salutation = formatWelcomeSalutation(leadContext);
  return [
    salutation,
    '',
    'Welcome to GuideXpert.',
    '',
    'Thank you for showing interest in becoming a Certified Career Counsellor.',
    '',
    'Our program helps passionate individuals learn career guidance, college counselling, student mentoring, and future-ready counselling practices.',
    '',
    'How can we help you today?',
    '',
    '1️⃣ Program Overview',
    '2️⃣ Eligibility Criteria',
    '3️⃣ Certification Process',
    '4️⃣ Fees & Enrollment',
    '5️⃣ Career Opportunities',
    '6️⃣ Talk to Our Team',
    '',
    'You can also ask questions like:',
    '',
    '• What is the GuideXpert Counsellor Program?',
    '• Who can join?',
    '• What are the fees?',
    '• What career opportunities are available?',
    '',
    "We're happy to guide you through every step.",
  ].join('\n');
}

function buildOrganicVisitorWelcome() {
  return [
    '👋 Welcome to GuideXpert!',
    '',
    "We're India's career guidance and counselling platform helping students make informed academic and career decisions, while also training future career counsellors.",
    '',
    'How can we help you today?',
    '',
    '1️⃣ IIT / College Counselling',
    '2️⃣ Become a Career Counsellor',
    '3️⃣ Rank Predictor',
    '4️⃣ Talk to an Expert',
    '',
    'Or simply type your question.',
    '',
    'Examples:',
    '• What is GuideXpert?',
    '• How does IIT counselling work?',
    '• How can I become a counsellor?',
    '• What services does GuideXpert provide?',
    '',
    "We're here to help you find the right path.",
  ].join('\n');
}

/**
 * Full welcome / main-menu body for the current lead classification.
 * @param {object} leadContext — from buildLeadContext (productLine, iit, gx)
 */
function buildWelcomeMenuText(leadContext) {
  const line = leadContext?.productLine || 'unknown';
  if (line === 'iit_counselling') {
    return buildIitStudentWelcome(leadContext);
  }
  if (line === 'guidexpert') {
    return buildGuidexpertLeadWelcome(leadContext);
  }
  return buildOrganicVisitorWelcome();
}

module.exports = {
  extractFirstName,
  formatWelcomeSalutation,
  buildWelcomeMenuText,
  buildIitStudentWelcome,
  buildGuidexpertLeadWelcome,
  buildOrganicVisitorWelcome,
};
