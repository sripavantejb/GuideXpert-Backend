'use strict';

const ALLOWED_CATEGORIES = Object.freeze([
  'iit_counselling',
  'josaa',
  'csab',
  'rank_prediction',
  'college_prediction',
  'branch_guidance',
  'admissions',
  'scholarship',
  'fees',
  'hostel',
  'placements',
  'guidexpert_services',
  'career_guidance',
]);

const DENY_CATEGORIES = Object.freeze([
  'programming',
  'image_generation',
  'movies',
  'weather',
  'sports',
  'politics',
  'finance',
  'general_trivia',
  'prompt_injection',
  'medical',
  'legal',
  'adult',
  'religion',
  'current_affairs',
  'math',
]);

const SEGMENT_SPLIT_RE = /\s+(?:and|also)\s+|[,;]+|\s+but\s+/i;

const DENY_PATTERNS = Object.freeze([
  // programming — keywords
  { category: 'programming', pattern: /\bpython\b/i },
  { category: 'programming', pattern: /\bjava(script)?\b/i },
  { category: 'programming', pattern: /\breact(\.?js)?\b/i },
  { category: 'programming', pattern: /\bnode(\.?js)?\b/i },
  { category: 'programming', pattern: /\bc\+\+\b/i },
  { category: 'programming', pattern: /\bleetcode\b/i },
  { category: 'programming', pattern: /\bbinary tree\b/i },
  { category: 'programming', pattern: /\b(sorting|search(ing)?) algorithm\b/i },
  { category: 'programming', pattern: /\bwrite (me )?(some )?code\b/i },
  { category: 'programming', pattern: /\b(write|give|generate|share).{0,20}\bcode\b/i },
  { category: 'programming', pattern: /\bcode for\b/i },
  { category: 'programming', pattern: /\bimplement\b/i },
  { category: 'programming', pattern: /\bdebug\b/i },
  { category: 'programming', pattern: /\bfunction to\b/i },
  { category: 'programming', pattern: /\bcalculator code\b/i },
  // programming — expanded vocabulary
  { category: 'programming', pattern: /\b(script|software|program(me)?|coding)\b/i },
  { category: 'programming', pattern: /\bdsa\b/i },
  { category: 'programming', pattern: /\brecursion\b/i },
  { category: 'programming', pattern: /\b(linked list|binary tree|dynamic programming|memoization)\b/i },
  { category: 'programming', pattern: /\b(bfs|dfs)\b/i },
  { category: 'programming', pattern: /\btwo sum\b/i },
  { category: 'programming', pattern: /\b(quicksort|merge sort|time complexity)\b/i },
  { category: 'programming', pattern: /\btraverse\b.{0,20}\b(graph|tree|list)\b/i },
  { category: 'programming', pattern: /\b(reverse|sort).{0,20}\b(linked list|array|numbers)\b/i },
  { category: 'programming', pattern: /\bteach me (python|java|c\+\+|coding)\b/i },
  { category: 'programming', pattern: /\bteach me c\+\+/i },
  { category: 'programming', pattern: /\b(solve|explain).{0,20}\b(two sum|leetcode)\b/i },
  { category: 'programming', pattern: /\bsoftware engineering\b/i },
  { category: 'programming', pattern: /\b(source code|coding question)\b/i },
  { category: 'programming', pattern: /\bwrite a script\b/i },
  { category: 'programming', pattern: /\b(build|develop).{0,15}\b(program|software)\b/i },

  // prompt injection
  { category: 'prompt_injection', pattern: /\bignore (all )?(previous|prior) instructions\b/i },
  { category: 'prompt_injection', pattern: /\bignore previous instructions\b/i },
  { category: 'prompt_injection', pattern: /\byou are chatgpt\b/i },
  { category: 'prompt_injection', pattern: /\bpretend you are chatgpt\b/i },
  { category: 'prompt_injection', pattern: /\bdeveloper mode\b/i },
  { category: 'prompt_injection', pattern: /\bsystem prompt\b/i },
  { category: 'prompt_injection', pattern: /\bsystem override\b/i },
  { category: 'prompt_injection', pattern: /\bact as (a )?(coding tutor|chatgpt|developer)\b/i },
  { category: 'prompt_injection', pattern: /\bact as\b/i },
  { category: 'prompt_injection', pattern: /\bpretend to be\b/i },
  { category: 'prompt_injection', pattern: /\bforget guidexpert\b/i },
  { category: 'prompt_injection', pattern: /\breveal (your )?(system|hidden) prompt\b/i },
  { category: 'prompt_injection', pattern: /\bdo anything now\b/i },

  // image generation
  { category: 'image_generation', pattern: /\b(generate|create|draw|make|render|banao|chey|cheyyi|pannu)\b.{0,24}\b(image|picture|photo|pic|drawing|art(work)?|wallpaper|portrait|avatar|cartoon|puppy|dog)\b/i },
  { category: 'image_generation', pattern: /\b(image|picture|photo|pic|wallpaper|portrait|avatar) (of|create|banao)\b/i },
  { category: 'image_generation', pattern: /\bdog (pic|picture|image)\b/i },
  { category: 'image_generation', pattern: /\banime portrait\b/i },

  // weather
  { category: 'weather', pattern: /\bweather\b/i },
  { category: 'weather', pattern: /\btemperature\b/i },
  { category: 'weather', pattern: /\brain forecast\b/i },
  { category: 'weather', pattern: /\brain prediction\b/i },
  { category: 'weather', pattern: /\bforecast\b/i },

  // movies / entertainment
  { category: 'movies', pattern: /\bmovies?\b/i },
  { category: 'movies', pattern: /\bavengers\b/i },
  { category: 'movies', pattern: /\bactor\b/i },
  { category: 'movies', pattern: /\bactress\b/i },
  { category: 'movies', pattern: /\bsongs?\b/i },
  { category: 'movies', pattern: /\blyrics\b/i },
  { category: 'movies', pattern: /\bnetflix\b/i },
  { category: 'movies', pattern: /\banime\b/i },
  { category: 'movies', pattern: /\b(recommend|suggest).{0,12}\b(movie|song)\b/i },

  // sports
  { category: 'sports', pattern: /\bipl\b/i },
  { category: 'sports', pattern: /\bcricket\b/i },
  { category: 'sports', pattern: /\bfootball\b/i },
  { category: 'sports', pattern: /\b(match|game) score\b/i },
  { category: 'sports', pattern: /\bsports score\b/i },

  // politics
  { category: 'politics', pattern: /\belections?\b/i },
  { category: 'politics', pattern: /\bprime minister\b/i },
  { category: 'politics', pattern: /\bpolitical party\b/i },
  { category: 'politics', pattern: /\bpolitics\b/i },

  // finance
  { category: 'finance', pattern: /\bstocks?\b/i },
  { category: 'finance', pattern: /\bshare market\b/i },
  { category: 'finance', pattern: /\bstock market\b/i },
  { category: 'finance', pattern: /\bcrypto(currency)?\b/i },
  { category: 'finance', pattern: /\bbitcoin\b/i },
  { category: 'finance', pattern: /\bmutual funds?\b/i },
  { category: 'finance', pattern: /\b(invest|buy).{0,16}\bbitcoin\b/i },
  { category: 'finance', pattern: /\bethereum\b/i },
  { category: 'finance', pattern: /\bbuy ethereum\b/i },

  // policy — medical
  { category: 'medical', pattern: /\b(fever|headache|diabetes|symptoms of|medicine for|medical advice)\b/i },
  { category: 'medical', pattern: /\bi have (a )?fever\b/i },

  // policy — legal
  { category: 'legal', pattern: /\b(divorce laws?|income tax filing|consumer rights?|legal advice)\b/i },

  // policy — adult
  { category: 'adult', pattern: /\b(porn(ography)? websites?|adult movies?)\b/i },
  { category: 'adult', pattern: /\bsex education\b/i },
  { category: 'adult', pattern: /\badult content\b/i },

  // policy — religion
  { category: 'religion', pattern: /\b(who is jesus|explain hinduism|quran meaning|religious scripture)\b/i },
  { category: 'religion', pattern: /\breligious debate\b/i },

  // policy — current affairs
  { category: 'current_affairs', pattern: /\b(russia ukraine war|israel conflict|trump news|ukraine war)\b/i },
  { category: 'current_affairs', pattern: /\b(war|conflict).{0,20}\b(ukraine|israel|russia)\b/i },

  // policy — math (pure calculation / homework)
  { category: 'math', pattern: /\b(integrate|derivative|matrix multiplication|solve matrix)\b/i },
  { category: 'math', pattern: /\bfind (the )?derivative\b/i },
  { category: 'math', pattern: /\bintegrate\s+x\b/i },
  { category: 'math', pattern: /\bcalculus homework\b/i },
]);

const POLICY_CATEGORIES = Object.freeze([
  'medical',
  'legal',
  'adult',
  'religion',
  'current_affairs',
  'math',
  'prompt_injection',
]);

const ALLOW_SIGNAL_PATTERN =
  /\b(iit|nit|iiit|jee|josaa|csab|rank|ranks|branch|branches|cse|ece|eee|mech|civil|admission|admissions|college|colleges|hostel|fee|fees|placement|placements|scholarship|scholarships|counsell?ing|counsel(or|lor)|float|freeze|slide|cutoff|cutoffs|quota|seat|guidexpert|aiml|data science)\b/i;

const BRANCH_GUIDANCE_PATTERN =
  /\b(which|what|best|good)\b.{0,30}\b(branch|stream|course|college|career)\b/i;

/** Career comparison context — allows Python/Java mentions for placements/jobs. */
const CAREER_CONTEXT_PATTERN =
  /\b(placement|placements|career|job|jobs|software jobs?|for placements?|vs|versus)\b/i;

const CODE_WRITING_REQUEST_PATTERN =
  /\b(write|give|generate|share|implement|debug|sorting code|code for|source code|teach me python|teach me java|teach me c\+\+|solve two sum|leetcode)\b/i;

const BASE64_CANDIDATE_RE = /\b[A-Za-z0-9+/]{16,}={0,2}\b/g;

module.exports = {
  ALLOWED_CATEGORIES,
  DENY_CATEGORIES,
  DENY_PATTERNS,
  POLICY_CATEGORIES,
  ALLOW_SIGNAL_PATTERN,
  BRANCH_GUIDANCE_PATTERN,
  CAREER_CONTEXT_PATTERN,
  CODE_WRITING_REQUEST_PATTERN,
  SEGMENT_SPLIT_RE,
  BASE64_CANDIDATE_RE,
};
