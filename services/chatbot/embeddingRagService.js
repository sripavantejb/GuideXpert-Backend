/**
 * Phase 3: RAG over Blog content (keyword fallback until embeddings are configured).
 */
const Blog = require('../../models/Blog');
const { normalizeText } = require('./intentClassifierService');

async function searchKnowledge(query, limit = 5) {
  if (String(process.env.CHATBOT_RAG_ENABLED || '').trim() !== '1') {
    return [];
  }

  const t = normalizeText(query);
  if (!t || t.length < 3) return [];

  const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const posts = await Blog.find({
    $or: [{ title: re }, { contentHtml: re }, { category: re }],
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('title category contentHtml slug')
    .lean();

  return posts.map((p) => ({
    title: p.title,
    category: p.category,
    excerpt: String(p.contentHtml || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400),
    slug: p.slug,
  }));
}

async function buildRagContext(query) {
  const chunks = await searchKnowledge(query, 3);
  if (!chunks.length) return null;
  return chunks.map((c) => `[${c.title}] ${c.excerpt}`).join('\n\n');
}

module.exports = { searchKnowledge, buildRagContext };
