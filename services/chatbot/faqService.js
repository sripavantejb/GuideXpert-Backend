const Blog = require('../../models/Blog');
const { CHATBOT_FAQ } = require('../../config/chatbotFaq');
const { normalizeText } = require('./intentClassifierService');

function searchStaticFaq(query) {
  const t = normalizeText(query);
  if (!t) return [];

  const scored = CHATBOT_FAQ.map((entry) => {
    let score = 0;
    if (normalizeText(entry.title).includes(t) || t.includes(normalizeText(entry.slug))) {
      score += 3;
    }
    for (const kw of entry.keywords || []) {
      if (t.includes(normalizeText(kw))) score += 2;
    }
    return { entry, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 3).map((x) => x.entry);
}

async function searchWithRag(query, limit = 3) {
  try {
    const { buildRagContext } = require('./embeddingRagService');
    const rag = await buildRagContext(query);
    if (rag) return [{ slug: 'rag', title: 'Knowledge base', excerpt: rag }];
  } catch {
    /* optional */
  }
  return [];
}

async function searchBlog(query, limit = 3) {
  const t = normalizeText(query);
  if (!t || t.length < 2) return [];

  const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const posts = await Blog.find({
    $or: [{ title: re }, { category: re }, { subtitle: re }],
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('title subtitle category slug contentHtml')
    .lean();

  return posts.map((p) => ({
    slug: p.slug || String(p._id),
    title: p.title,
    category: p.category,
    excerpt: (p.subtitle || '').slice(0, 200) || stripHtml(p.contentHtml).slice(0, 200),
  }));
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function formatFaqAnswerAsync(entries, blogPosts, query) {
  const ragHits = query ? await searchWithRag(query) : [];
  return formatFaqAnswer(entries, blogPosts, ragHits);
}

function formatFaqAnswer(entries, blogPosts, ragHits = []) {
  const lines = [];
  if (ragHits.length && ragHits[0].excerpt) {
    lines.push(ragHits[0].excerpt);
  }
  if (entries.length) {
    lines.push(entries[0].answer);
    if (entries.length > 1) {
      lines.push('\nRelated topics:');
      entries.slice(1).forEach((e) => lines.push(`• ${e.title}`));
    }
  }
  if (blogPosts.length) {
    lines.push('\nFrom our blog:');
    blogPosts.forEach((b) => lines.push(`• ${b.title}${b.category ? ` (${b.category})` : ''}`));
  }
  if (!lines.length) {
    return 'I could not find an exact answer. Reply MENU for options or AGENT to talk to our team.';
  }
  return lines.join('\n');
}

module.exports = {
  searchStaticFaq,
  searchBlog,
  formatFaqAnswer,
  formatFaqAnswerAsync,
};
