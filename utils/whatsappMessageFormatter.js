'use strict';

function stripInlineHtml(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, ' • ')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?[^>]+>/g, '');
}

function stripHtmlTags(text) {
  return stripInlineHtml(text);
}

function stripMarkdownBold(text) {
  return String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1');
}

function isMarkdownTableRow(line) {
  const trimmed = String(line || '').trim();
  return trimmed.startsWith('|') && trimmed.split('|').length >= 3;
}

function isMarkdownTableSeparator(line) {
  const trimmed = String(line || '').trim();
  if (!isMarkdownTableRow(trimmed)) return false;
  return /^\|[\s\-:|]+\|$/.test(trimmed);
}

function splitTableCells(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => stripMarkdownBold(stripInlineHtml(cell)).trim());
}

function normalizeCellBullets(cellText) {
  const cleaned = stripMarkdownBold(stripInlineHtml(cellText)).trim();
  if (!cleaned) return [];

  return cleaned
    .split(/\n| • /)
    .map((part) => part.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}

function convertMarkdownTableBlock(lines) {
  if (!lines || lines.length === 0) return '';

  const dataRows = lines.filter((line) => !isMarkdownTableSeparator(line));
  if (dataRows.length <= 1) {
    return dataRows
      .flatMap((line) => splitTableCells(line))
      .filter(Boolean)
      .join('\n');
  }

  const bodyRows = dataRows.slice(1);
  const sections = [];

  for (const row of bodyRows) {
    const cells = splitTableCells(row);
    if (cells.length === 0) continue;

    const title = cells[0];
    if (title) sections.push(title);

    for (let i = 1; i < cells.length; i += 1) {
      for (const bullet of normalizeCellBullets(cells[i])) {
        sections.push(`• ${bullet}`);
      }
    }

    sections.push('');
  }

  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function convertMarkdownHeadings(line) {
  const match = String(line || '').match(/^(#{1,6})\s+(.+)$/);
  if (!match) return line;
  return `${stripMarkdownBold(match[2]).trim()}\n`;
}

function collapseBlankLines(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert Knowledge Assistant markdown/HTML into WhatsApp-friendly plain text.
 */
function formatForWhatsApp(text) {
  const input = stripInlineHtml(String(text || ''));
  if (!input.trim()) return '';

  const lines = input.split('\n');
  const output = [];
  let tableBuffer = [];

  function flushTable() {
    if (tableBuffer.length === 0) return;
    output.push(convertMarkdownTableBlock(tableBuffer));
    tableBuffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (isMarkdownTableRow(line)) {
      tableBuffer.push(line);
      continue;
    }

    flushTable();

    if (!line.trim()) {
      output.push('');
      continue;
    }

    output.push(convertMarkdownHeadings(line));
  }

  flushTable();

  return collapseBlankLines(
    output
      .join('\n')
      .split('\n')
      .map((line) => stripMarkdownBold(line))
      .join('\n')
  );
}

module.exports = {
  formatForWhatsApp,
  stripHtmlTags,
  convertMarkdownTableBlock,
};
