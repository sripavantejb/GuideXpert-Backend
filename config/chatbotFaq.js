/**
 * Static FAQ entries for rule-based chatbot (Phase 1).
 * Blog search supplements these via faqService.
 */
const CHATBOT_FAQ = [
  {
    slug: 'what-is-guidexpert',
    keywords: ['what is guidexpert', 'about guidexpert', 'who are you'],
    title: 'What is GuideXpert?',
    answer:
      'GuideXpert helps students and parents with career guidance, demo counselling sessions, and college planning tools.',
  },
  {
    slug: 'book-demo',
    keywords: ['book demo', 'register', 'sign up', 'how to join'],
    title: 'How do I book a demo?',
    answer:
      'Complete registration on our website and choose an available demo slot. You will receive WhatsApp and SMS reminders before your session.',
  },
  {
    slug: 'iit-counselling',
    keywords: ['iit counselling', 'iit session', 'iit demo'],
    title: 'IIT counselling sessions',
    answer:
      'IIT counselling slots are on Wednesday 6 PM, Saturday 6 PM, or Sunday 11 AM (IST). Complete the IIT counselling form to book your slot.',
  },
  {
    slug: 'meeting-link',
    keywords: ['meeting link', 'join link', 'zoom', 'meet link'],
    title: 'Meeting link',
    answer:
      'Your demo meeting link is sent by WhatsApp and SMS before your session. Reply with "my details" if you are already registered and we will look up your booking.',
  },
  {
    slug: 'talk-to-agent',
    keywords: ['talk to agent', 'human', 'call me'],
    title: 'Talk to an agent',
    answer: 'Reply AGENT or type "talk to human" and we will connect you with our team.',
  },
];

module.exports = { CHATBOT_FAQ };
