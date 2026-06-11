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
  {
    slug: 'program-fees',
    keywords: ['fees', 'fee', 'price', 'pricing', 'cost', 'fees kya hai', 'price kya hai', 'fees enti'],
    title: 'GuideXpert program fees',
    answer:
      'GuideXpert offers demo counselling and structured guidance programs. Fees depend on the program you choose—demo sessions are often free or low-cost, while full packages vary by services (career guidance, college planning, IIT counselling, mentorship). Tell us your needs and we will share the exact fee structure.',
  },
  {
    slug: 'program-benefits',
    keywords: ['benefits', 'benefit', 'benefits kya hai', 'benefits enti'],
    title: 'Benefits of GuideXpert programs',
    answer:
      'GuideXpert helps students and parents move from confusion to clarity with structured career counselling, college and branch fit guidance, demo sessions, college predictor tools, IIT counselling slot support, and ongoing mentorship—not random college pushes.',
  },
  {
    slug: 'program-mentorship',
    keywords: ['mentorship', 'mentor', 'mentoring'],
    title: 'GuideXpert mentorship',
    answer:
      'Yes, GuideXpert programs include mentorship and ongoing guidance. Experts support career direction, college choices, follow-ups, and admission planning so students are supported throughout the journey.',
  },
  {
    slug: 'program-duration',
    keywords: ['duration', 'how long', 'program length', 'sessions'],
    title: 'Program duration and sessions',
    answer:
      'Duration depends on the program. Demo counselling is a single session; structured guidance can span multiple sessions over weeks with follow-ups and mentorship. We tailor the timeline to your goals—career clarity, college shortlisting, or end-to-end admission support.',
  },
];

module.exports = { CHATBOT_FAQ };
