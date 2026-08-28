// Coverage for markdown rendering of assistant replies in the side panel.
//
// The side panel previously showed raw model output: literal `**bold**`,
// collapsed lists, and markdown table pipes as text. It now shares the
// floating panel's renderer.
const { test, expect } = require('@playwright/test');
const path = require('path');

const SIDEPANEL_URL = 'file:///' + path.resolve(__dirname, '..', 'dist', 'sidepanel.html').replace(/\\/g, '/');

async function open(page) {
  await page.addInitScript(() => {
    const ports = [];
    window.__ports = ports;
    window.__lastPort = () => ports[ports.length - 1];
    window.chrome = {
      runtime: {
        lastError: null,
        connect(info) {
          const onMessage = [];
          const port = {
            name: info && info.name,
            posted: [],
            onMessage: { addListener: fn => onMessage.push(fn) },
            onDisconnect: { addListener() {} },
            postMessage() {},
            disconnect() {},
            emit(message) { onMessage.slice().forEach(fn => fn(message)); }
          };
          ports.push(port);
          return port;
        },
        sendMessage() {}
      },
      tabs: {
        query: (_info, cb) => cb([{ id: 1, title: 'Page', url: 'https://example.com' }]),
        sendMessage: (_id, _m, cb) => cb({ success: true, title: 'Page', url: 'https://example.com', content: 'text' }),
        onActivated: { addListener() {}, removeListener() {} },
        onUpdated: { addListener() {}, removeListener() {} }
      },
      storage: {
        sync: { get: (defaults, cb) => cb({ ...defaults }), set: (_v, cb = () => {}) => cb() },
        local: { get: (_k, cb) => cb({}), set: (_v, cb = () => {}) => cb() },
        onChanged: { addListener() {}, removeListener() {} }
      }
    };
  });
  await page.goto(SIDEPANEL_URL);
  await expect(page.locator('#chatInput')).toBeVisible();
}

/** Sends a turn and streams `reply` back as one settled assistant message. */
async function reply(page, text) {
  await page.fill('#chatInput', 'go');
  await page.click('#sendBtn');
  await page.evaluate(content => {
    const port = window.__lastPort();
    port.emit({ type: 'chunk', text: content });
    port.emit({ type: 'done' });
  }, text);
  await expect(page.locator('.sp-msg-assistant')).toBeVisible();
}

const bubble = page => page.locator('.sp-msg-assistant');

test('bold and italic emphasis is rendered, not shown as asterisks', async ({ page }) => {
  await open(page);
  await reply(page, 'There are **5 providers** and *one* caveat.');

  await expect(bubble(page).locator('strong')).toHaveText('5 providers');
  await expect(bubble(page).locator('em')).toHaveText('one');
  await expect(bubble(page)).not.toContainText('**');
});

test('an ordered list becomes list items rather than one run-on line', async ({ page }) => {
  await open(page);
  await reply(page, 'Providers:\n\n1. Anthropic\n2. OpenAI\n3. Google');

  await expect(bubble(page).locator('ol li')).toHaveText(['Anthropic', 'OpenAI', 'Google']);
});

test('an unordered list becomes list items', async ({ page }) => {
  await open(page);
  await reply(page, 'Costs:\n\n- Opus 5 — $392.42\n- GPT-5.6 — $182.42');

  await expect(bubble(page).locator('ul li')).toHaveCount(2);
});

test('a markdown table becomes a real table', async ({ page }) => {
  await open(page);
  await reply(page, [
    'The page shows:',
    '',
    '| Provider | Models |',
    '|---|---|',
    '| Anthropic | Opus 5 |',
    '| OpenAI | GPT-5.6 |',
    ''
  ].join('\n'));

  await expect(bubble(page).locator('table.omnipilot-table')).toHaveCount(1);
  await expect(bubble(page).locator('th')).toHaveText(['Provider', 'Models']);
  await expect(bubble(page).locator('tbody tr')).toHaveCount(2);
  await expect(bubble(page)).not.toContainText('|---|');
});

test('emphasis inside a table cell is rendered, not shown as asterisks', async ({ page }) => {
  await open(page);
  await reply(page, [
    '| Provider | Models |',
    '|---|---|',
    '| **Anthropic** (Claude) | Opus 5 |',
    ''
  ].join('\n'));

  await expect(bubble(page).locator('td strong').first()).toHaveText('Anthropic');
  await expect(bubble(page)).not.toContainText('**');
});

test('headings are rendered as headings', async ({ page }) => {
  await open(page);
  await reply(page, '## Summary\n\nThe totals are large.');

  await expect(bubble(page).locator('h3')).toHaveText('Summary');
  await expect(bubble(page).locator('p')).toHaveText('The totals are large.');
});

test('prose is grouped into paragraphs rather than one long line', async ({ page }) => {
  await open(page);
  await reply(page, 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');

  await expect(bubble(page).locator('p')).toHaveCount(3);
});

test('a fenced code block becomes a copyable card', async ({ page }) => {
  await open(page);
  await reply(page, 'Try:\n\n```js\nconst x = 1;\n```');

  await expect(bubble(page).locator('.omnipilot-code-block-body')).toHaveText('const x = 1;');
  await expect(bubble(page).locator('.omnipilot-code-block-copy-btn')).toBeVisible();

  await page.click('.omnipilot-code-block-copy-btn');
  await expect(bubble(page).locator('.omnipilot-code-block-copy-btn')).toHaveText('Copied');
});

test('inline code is rendered as code', async ({ page }) => {
  await open(page);
  await reply(page, 'Call `fetchPageContext()` first.');

  await expect(bubble(page).locator('code')).toHaveText('fetchPageContext()');
});

test('markup in a reply stays literal text', async ({ page }) => {
  await open(page);
  await reply(page, 'Careful with <img src=x onerror=alert(1)> tags.');

  expect(await bubble(page).locator('img').count()).toBe(0);
  await expect(bubble(page)).toContainText('<img src=x onerror=alert(1)>');
});

test('links are rendered as links that open in a new tab', async ({ page }) => {
  await open(page);
  await reply(page, 'See [the docs](https://example.com/docs).');

  const link = bubble(page).locator('a');
  await expect(link).toHaveText('the docs');
  await expect(link).toHaveAttribute('href', 'https://example.com/docs');
  await expect(link).toHaveAttribute('target', '_blank');
});

test('user messages are never treated as markdown', async ({ page }) => {
  await open(page);
  await page.fill('#chatInput', 'what about **this**?');
  await page.click('#sendBtn');

  await expect(page.locator('.sp-msg-user')).toHaveText('what about **this**?');
  expect(await page.locator('.sp-msg-user strong').count()).toBe(0);
});

test('a rendered reply leaves no gap above its first block', async ({ page }) => {
  await open(page);
  await reply(page, '## Summary\n\nThe totals are large.');

  const gap = await page.evaluate(() => {
    const box = document.querySelector('.sp-msg-assistant');
    const heading = box.querySelector('h3');
    return heading.getBoundingClientRect().top - box.getBoundingClientRect().top;
  });
  // Only the bubble's own padding, no collapsed heading margin on top.
  expect(gap).toBeLessThan(14);
});
