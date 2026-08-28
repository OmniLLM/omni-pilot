// Markdown → HTML rendering for assistant replies.
//
// Extracted from the content script so the floating panel and the side panel
// render replies identically. Output is escaped first and markup is generated
// afterwards, so model output can never inject HTML.
//
// build.mjs inlines this file into the bundles that need it (the `import` line
// is stripped), so the declarations below land at top level.

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Lines that already carry block-level markup, or stand in for it, must never
// be wrapped in a <p> — a <div> or <table> inside a <p> is invalid and the
// browser silently splits the paragraph, which produces stray vertical gaps.
const BLOCK_LINE = /^\s*(?:<(?:h[1-6]|ul|ol|li|blockquote|hr|table|div|details|pre|p)\b|<\/(?:ul|ol|blockquote|table|div|details|pre)>|__OP_(?:CODE_BLOCK|TABLE|THINK)_PLACEHOLDER_\d+__\s*$)/i;

function assembleBlocks(html) {
  const out = [];
  let paragraph = [];

  const flush = () => {
    if (!paragraph.length) return;
    // A single newline inside a paragraph is a deliberate line break.
    const text = paragraph.join('<br>').trim();
    if (text) out.push(`<p>${text}</p>`);
    paragraph = [];
  };

  for (const line of html.split('\n')) {
    if (!line.trim()) { flush(); continue; }        // blank line ends a paragraph
    if (BLOCK_LINE.test(line)) { flush(); out.push(line.trim()); continue; }
    paragraph.push(line.trim());
  }
  flush();

  return out.join('\n');
}

// Inline markup, applied to already-escaped text. Shared by the main pipeline
// and by table cells, which are extracted before the pipeline runs and would
// otherwise show literal `**bold**`.
function applyInlineMarkup(escaped) {
  return escaped
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/~~(.*?)~~/g, '<del>$1</del>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
}

/**
 * @param {string} text raw model output
 * @param {{ thinkingLabel?: string }} [options] label for collapsed <think>
 *   sections, which the content script localizes
 * @returns {string} HTML safe to assign as innerHTML
 */
function renderMarkdown(text, options = {}) {
  if (typeof text !== 'string') return '';
  const thinkingLabel = options.thinkingLabel || 'Thinking';

  // Extract and protect <think> blocks for collapsible rendering
  const thinkBlocks = [];
  let formatted = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, content) => {
    const placeholder = `__OP_THINK_PLACEHOLDER_${thinkBlocks.length}__`;
    thinkBlocks.push(content.trim());
    return placeholder;
  });

  // Extract fenced code blocks: ```lang\ncode\n```
  const blocks = [];
  formatted = formatted.replace(/```(\w*)\n([\s\S]*?)\n```/g, (match, lang, code) => {
    const placeholder = `__OP_CODE_BLOCK_PLACEHOLDER_${blocks.length}__`;
    blocks.push({ lang: lang || 'code', code });
    return placeholder;
  });

  // Protect inline code: `code`
  const inlineCodes = [];
  formatted = formatted.replace(/`([^`\n]+)`/g, (match, code) => {
    const placeholder = `__OP_INLINE_CODE_PLACEHOLDER_${inlineCodes.length}__`;
    inlineCodes.push(code);
    return placeholder;
  });

  // Extract markdown tables before escaping
  const tables = [];
  formatted = formatted.replace(/(?:^|\n)((?:\|[^\n]+\|\s*\n){2,})/gm, (match, tableBlock) => {
    const placeholder = `__OP_TABLE_PLACEHOLDER_${tables.length}__`;
    tables.push(tableBlock.trim());
    return '\n' + placeholder + '\n';
  });

  // Escape HTML
  formatted = escapeHtml(formatted);

  // Markdown Headings: ### text
  formatted = formatted.replace(/^#{3}\s+(.*?)$/gm, '<h4>$1</h4>');
  formatted = formatted.replace(/^#{2}\s+(.*?)$/gm, '<h3>$1</h3>');
  formatted = formatted.replace(/^#{1}\s+(.*?)$/gm, '<h3>$1</h3>');

  // Links, strikethrough, bold, italic
  formatted = applyInlineMarkup(formatted);

  // Blockquotes: > text
  formatted = formatted.replace(/^&gt;\s+(.*?)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rules: --- or ***
  formatted = formatted.replace(/^(---|\*\*\*)$/gm, '<hr>');

  // Unordered lists: - text
  formatted = formatted.replace(/^\s*-\s+(.*?)$/gm, '<ul><li>$1</li></ul>');
  formatted = formatted.replace(/<\/ul>\s*<ul>/g, '');

  // Ordered lists: 1. text
  formatted = formatted.replace(/^\s*\d+\.\s+(.*?)$/gm, '<ol><li>$1</li></ol>');
  formatted = formatted.replace(/<\/ol>\s*<ol>/g, '');

  // Assemble block structure.
  //
  // Previously every newline became a <br>, which produced no paragraphs at
  // all — prose ran together as one long block, and stray <br>s piled up
  // around headings, lists and tables. Instead, group consecutive prose lines
  // into <p> elements and leave block-level markup standing on its own.
  formatted = assembleBlocks(formatted);

  // Restore inline codes
  inlineCodes.forEach((code, index) => {
    formatted = formatted.replace(`__OP_INLINE_CODE_PLACEHOLDER_${index}__`, `<code>${escapeHtml(code)}</code>`);
  });

  // Restore tables as HTML tables
  tables.forEach((tableText, index) => {
    const rows = tableText.split('\n').filter(r => r.trim());
    if (rows.length < 2) {
      formatted = formatted.replace(`__OP_TABLE_PLACEHOLDER_${index}__`, escapeHtml(tableText));
      return;
    }
    // Strip the row's outer pipes before splitting. The previous filter kept
    // the empty string a trailing pipe produces, so every table gained a
    // spurious empty final column.
    const parseRow = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
    const renderCell = cell => {
      // Restore inline code placeholders that were extracted before the
      // table was captured; escape everything else as plain text.
      const parts = cell.split(/(__OP_INLINE_CODE_PLACEHOLDER_\d+__)/);
      return parts.map(part => {
        const m = part.match(/^__OP_INLINE_CODE_PLACEHOLDER_(\d+)__$/);
        if (m) {
          const code = inlineCodes[Number(m[1])];
          return code !== undefined ? `<code>${escapeHtml(code)}</code>` : escapeHtml(part);
        }
        return applyInlineMarkup(escapeHtml(part));
      }).join('');
    };
    const headerCells = parseRow(rows[0]);
    const isSeparator = row => /^\|?[\s\-:|]+\|?$/.test(row);
    const dataStartIdx = isSeparator(rows[1]) ? 2 : 1;
    let tableHtml = '<table class="omnipilot-table"><thead><tr>';
    headerCells.forEach(cell => { tableHtml += `<th>${renderCell(cell)}</th>`; });
    tableHtml += '</tr></thead><tbody>';
    for (let i = dataStartIdx; i < rows.length; i++) {
      const cells = parseRow(rows[i]);
      tableHtml += '<tr>';
      cells.forEach(cell => { tableHtml += `<td>${renderCell(cell)}</td>`; });
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table>';
    formatted = formatted.replace(`__OP_TABLE_PLACEHOLDER_${index}__`, tableHtml);
  });

  // Restore code blocks
  blocks.forEach((block, index) => {
    const cardHtml = `<div class="omnipilot-code-block-card">
      <div class="omnipilot-code-block-header">
        <span>${escapeHtml(block.lang)}</span>
        <button class="omnipilot-code-block-copy-btn">Copy</button>
      </div>
      <pre class="omnipilot-code-block-body">${escapeHtml(block.code)}</pre>
    </div>`;
    formatted = formatted.replace(`__OP_CODE_BLOCK_PLACEHOLDER_${index}__`, cardHtml);
  });

  // Restore think blocks as collapsible sections
  thinkBlocks.forEach((content, index) => {
    const thinkHtml = `<details class="omnipilot-think-block" open>
      <summary class="omnipilot-think-summary"><span class="omnipilot-think-icon">💭</span> ${thinkingLabel}</summary>
      <div class="omnipilot-think-body">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
    </details>`;
    formatted = formatted.replace(`__OP_THINK_PLACEHOLDER_${index}__`, thinkHtml);
  });

  return formatted;
}

export { renderMarkdown, escapeHtml };
