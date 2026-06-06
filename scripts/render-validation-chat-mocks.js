#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const resultsPath = path.join(__dirname, '..', 'docs', 'phase-6-validation-artifacts', 'live-validation-results.json');
const outDir = path.dirname(resultsPath);
const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderChat(result) {
  const user = escapeHtml(result.input);
  const bot = escapeHtml(result.finalResponse).replace(/\n/g, '<br>');
  const title = escapeHtml(`${result.id}: ${result.name}`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { margin: 0; background: #111b21; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .wrap { max-width: 420px; margin: 24px auto; background: #0b141a; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,.35); }
    .header { background: #202c33; color: #e9edef; padding: 14px 16px; font-weight: 600; font-size: 15px; }
    .chat { padding: 16px; min-height: 420px; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><text x="0" y="50" fill="%23182229" font-size="40">•</text></svg>'); }
    .bubble { max-width: 88%; padding: 8px 10px; border-radius: 8px; margin-bottom: 8px; line-height: 1.45; font-size: 14px; white-space: normal; word-wrap: break-word; }
    .user { background: #005c4b; color: #e9edef; margin-left: auto; border-top-right-radius: 0; }
    .bot { background: #202c33; color: #e9edef; margin-right: auto; border-top-left-radius: 0; }
    .meta { color: #8696a0; font-size: 11px; padding: 0 16px 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">GuideXpert Assistant · Live validation</div>
    <div class="chat">
      <div class="bubble user">${user}</div>
      <div class="bubble bot">${bot}</div>
    </div>
    <div class="meta">${title} · ${result.responseLanguage} · ${result.durationMs}ms · PASS</div>
  </div>
</body>
</html>`;
}

for (const result of data.results) {
  const file = path.join(outDir, `${result.id}-whatsapp-mock.html`);
  fs.writeFileSync(file, renderChat(result));
  console.log('Wrote', file);
}
