/**
 * Seed sample blogs if collection is empty.
 * Run from Backend: node scripts/seedBlogs.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('../config/db');
const Blog = require('../models/Blog');

const samples = [
  {
    title: 'Wake Up and Smell the Coffee',
    subtitle: 'A calm morning ritual that boosts focus and mood.',
    category: 'Food',
    content:
      '<p>Morning routines shape the rest of your day. Start with water, stretch lightly, and brew coffee mindfully. Keep notifications off for the first 30 minutes so your brain can settle into deep focus.</p><p>A simple cup and a clear desk can become a daily reset ritual. The goal is not complexity, but consistency.</p>',
    coverImage:
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1400&q=80',
    author: 'GuideXpert Editorial',
  },
  {
    title: 'The Brand New NASA Office',
    subtitle: 'Design principles behind high-performance workspaces.',
    category: 'Architecture',
    content:
      '<p>Great workspaces are built around light, movement, and collaboration. Open pathways reduce friction while quiet zones preserve concentration.</p><p>When design supports behavior, teams spend less energy switching contexts and more energy producing meaningful output.</p>',
    coverImage:
      'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
    author: 'GuideXpert Editorial',
  },
  {
    title: 'Experience the Saharan Sands',
    subtitle: 'A visual travel journal from sunrise to starlight.',
    category: 'Travel',
    content:
      '<p>Desert landscapes reveal subtle gradients and powerful silence. Sunrise paints dunes in warm peach tones, while evenings transition to dramatic shadows and rich skies.</p><p>Pack light, hydrate often, and leave room for spontaneous exploration.</p>',
    coverImage:
      'https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=900&q=80',
    author: 'GuideXpert Editorial',
  },
  {
    title: '9 Air-Cleaning Plants Your Home Needs',
    subtitle: 'Simple greenery choices for better indoor air quality.',
    category: 'Interior',
    content:
      '<p>Snake plants, pothos, and peace lilies are beginner-friendly and visually calming. Place plants near windows with indirect light and avoid overwatering.</p><p>A small plant corner can lift both mood and room aesthetics.</p>',
    coverImage:
      'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=900&q=80',
    author: 'GuideXpert Editorial',
  },
  {
    title: 'One Month Sugar Detox',
    subtitle: 'Practical steps to reset cravings and energy.',
    category: 'Food',
    content:
      '<p>Start by replacing sugary snacks with fruit, nuts, and high-protein options. Stable blood sugar improves focus and reduces afternoon slumps.</p><p>Track your meals for a week to identify hidden sugar sources and make steady adjustments.</p>',
    coverImage:
      'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=900&q=80',
    author: 'GuideXpert Editorial',
  },
  {
    title: 'Shooting Minimal Instagram Photos',
    subtitle: 'How to compose clean, modern visuals in any city.',
    category: 'Photography',
    content:
      '<p>Minimal shots rely on negative space, symmetry, and one clear subject. Shoot during soft daylight and reduce frame clutter.</p><p>Consistency in color temperature and framing helps your profile feel cohesive.</p>',
    coverImage:
      'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1400&q=80',
    author: 'GuideXpert Editorial',
  },
];

async function run() {
  await connectDB();
  const count = await Blog.countDocuments();
  if (count > 0) {
    console.log(`[seedBlogs] Skipping — ${count} blog(s) already in database.`);
    process.exit(0);
  }
  await Blog.insertMany(samples);
  console.log(`[seedBlogs] Inserted ${samples.length} sample blogs.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('[seedBlogs]', err);
  process.exit(1);
});
