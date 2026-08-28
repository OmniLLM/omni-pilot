// Formatting oracle for assistant responses rendered in the content script.
//
// The reported bug: replies rendered as one long undifferentiated run of text,
// with an odd gap under headings. The cause was that every newline became a
// <br>, so there were no paragraphs at all and block elements collected stray
// <br>s around them. These tests pin the block structure.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'content.js'), 'utf8');

// The reply text from the reported screenshot, shortened but structurally identical.
const SUMMARY_REPLY = [
  '## Summary',
  '',
  'This chart displays the cost breakdown of various AI language models.',
  'Claude Opus 5 dominates the expenses at $380.09.',
  '',
  'The remaining models show significantly lower costs, ranging from $10.41 down to $0.00.',
  '',
  'This distribution suggests a heavy reliance on two premium models.'
].join('\n');

async function setupPage(page, reply) {
  await page.goto('about:blank');
  await page.setContent('<!DOCTYPE html><html><head></head><body style="padding:40px">' +
    '<p id="para">Bonjour le monde ceci est un texte de test a traduire.</p></body></html>');
  await page.evaluate(({ contentSource, reply }) => {
    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        connect(opts) {
          const listeners = [];
          return {
            name: (opts && opts.name) || '',
            onMessage: { addListener(fn) { listeners.push(fn); } },
            onDisconnect: { addListener() {} },
            postMessage() {
              setTimeout(() => {
                for (const fn of listeners) { fn({ type: 'chunk', text: reply }); fn({ type: 'done' }); }
              }, 0);
            },
            disconnect() {}
          };
        },
        sendMessage(message, callback) {
          if (typeof callback !== 'function') return;
          if (message.type === 'GET_MODELS') return callback({ models: ['gpt-4o'] });
          return callback({ success: true, result: reply });
        },
        openOptionsPage() {}
      },
      storage: {
        sync: { get(d, cb) { cb({ ...d, apiKey: 'k', languagePreference: 'en' }); }, set(v, cb = () => {}) { cb(); } },
        local: { get(k, cb) { cb({}); }, set(v, cb = () => {}) { cb(); } },
        onChanged: { addListener() {} }
      }
    };
    // eslint-disable-next-line no-eval
    window.eval(contentSource);
  }, { contentSource, reply });
}

// Run an action so the reply is rendered into the panel, then hand back the
// result container.
async function renderReply(page, reply) {
  await setupPage(page, reply);
  await page.evaluate(() => {
    const node = document.querySelector('#para');
    const range = document.createRange();
    range.selectNodeContents(node);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    const r = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
  });
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  const result = page.locator('.omnipilot-result, .omnipilot-msg-assistant').first();
  await result.waitFor({ state: 'visible' });
  return result;
}

test('prose is split into separate paragraphs, not one run of text', async ({ page }) => {
  const result = await renderReply(page, SUMMARY_REPLY);

  const paragraphs = result.locator('p');
  await expect(paragraphs).toHaveCount(3);
  await expect(paragraphs.nth(1)).toContainText('The remaining models show significantly lower costs');
});

test('a heading is a real heading element, not text followed by breaks', async ({ page }) => {
  const result = await renderReply(page, SUMMARY_REPLY);

  await expect(result.locator('h3')).toHaveText('Summary');
});

test('no stray break elements are emitted around block content', async ({ page }) => {
  const result = await renderReply(page, SUMMARY_REPLY);

  // Breaks are legitimate *inside* a paragraph (a single newline in the source).
  // The bug was breaks at block level, padding out the space around headings
  // and between paragraphs. None should exist as direct children.
  const strayBreaks = await result.evaluate(el =>
    [...el.children].filter(child => child.tagName === 'BR').length
  );
  expect(strayBreaks).toBe(0);
});

test('paragraphs are visually separated rather than butted together', async ({ page }) => {
  const result = await renderReply(page, SUMMARY_REPLY);

  const gap = await result.evaluate(el => {
    const ps = [...el.querySelectorAll('p')];
    const a = ps[0].getBoundingClientRect();
    const b = ps[1].getBoundingClientRect();
    return b.top - a.bottom;
  });
  expect(gap).toBeGreaterThan(4);
});

test('a heading does not leave a large empty gap before the first paragraph', async ({ page }) => {
  const result = await renderReply(page, SUMMARY_REPLY);

  const gap = await result.evaluate(el => {
    const h = el.querySelector('h3').getBoundingClientRect();
    const p = el.querySelector('p').getBoundingClientRect();
    return p.top - h.bottom;
  });
  // The old <br>-based output left a gap of roughly two blank lines here.
  expect(gap).toBeLessThan(24);
});

test('a single newline inside a paragraph stays a line break', async ({ page }) => {
  const result = await renderReply(page, 'Line one\nLine two\n\nSecond paragraph.');

  await expect(result.locator('p')).toHaveCount(2);
  await expect(result.locator('p').first().locator('br')).toHaveCount(1);
});

test('list items render as a real list outside any paragraph', async ({ page }) => {
  const result = await renderReply(page, 'Here are the models:\n\n- Claude Opus 5\n- GPT-5.6\n- GPT-5 mini\n\nThat is all.');

  await expect(result.locator('ul')).toHaveCount(1);
  await expect(result.locator('ul li')).toHaveCount(3);
  await expect(result.locator('p ul')).toHaveCount(0);
  await expect(result.locator('p')).toHaveCount(2);
});

test('a code block is not wrapped in a paragraph', async ({ page }) => {
  const result = await renderReply(page, 'Run this:\n\n```bash\nnpm run build\n```\n\nThen reload.');

  await expect(result.locator('.omnipilot-code-block-card')).toHaveCount(1);
  await expect(result.locator('p .omnipilot-code-block-card')).toHaveCount(0);
  await expect(result.locator('pre')).toContainText('npm run build');
});

test('a table is not wrapped in a paragraph', async ({ page }) => {
  const result = await renderReply(page, 'Costs:\n\n| Model | Cost |\n| --- | --- |\n| Opus | $380 |\n| GPT | $182 |\n\nDone.');

  await expect(result.locator('table.omnipilot-table')).toHaveCount(1);
  await expect(result.locator('p table')).toHaveCount(0);
  await expect(result.locator('table tbody tr')).toHaveCount(2);
});

test('a table has no spurious trailing column from its closing pipe', async ({ page }) => {
  const result = await renderReply(page, 'Costs:\n\n| Model | Cost |\n| --- | --- |\n| Opus | $380 |\n| GPT | $182 |\n\nDone.');

  await expect(result.locator('table th')).toHaveText(['Model', 'Cost']);
  await expect(result.locator('table tbody tr').first().locator('td')).toHaveText(['Opus', '$380']);
});

test('inline emphasis survives paragraph assembly', async ({ page }) => {
  const result = await renderReply(page, 'This is **bold** and this is *italic*.\n\nNext paragraph.');

  await expect(result.locator('p strong')).toHaveText('bold');
  await expect(result.locator('p em')).toHaveText('italic');
});

test('markup in the reply is still rendered as literal text', async ({ page }) => {
  const result = await renderReply(page, 'Careful: <img src=x onerror=alert(1)>\n\nSecond paragraph.');

  await expect(result.locator('img')).toHaveCount(0);
  await expect(result.first()).toContainText('<img src=x onerror=alert(1)>');
});

test('a single-paragraph reply produces exactly one paragraph', async ({ page }) => {
  const result = await renderReply(page, 'Just one short answer.');

  await expect(result.locator('p')).toHaveCount(1);
  await expect(result.locator('p')).toHaveText('Just one short answer.');
});
