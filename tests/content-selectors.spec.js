// Oracle for the content script's three floating selectors (action, provider,
// model). Written against the pre-conversion implementation and intended to
// pass UNMODIFIED afterwards, so it can prove the Preact conversion is
// behaviour-preserving rather than merely "looks right".
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'content.js'), 'utf8');

// Model names include a hostile entry: remote data is concatenated into the
// list, so it must arrive as literal text, never as markup.
const MODELS = ['gpt-4o', 'gpt-4o-mini', 'claude-sonnet', '<img src=x onerror=alert(1)>'];

async function setupPage(page) {
  await page.goto('about:blank');
  await page.setContent('<!DOCTYPE html><html><head></head>' +
    '<body style="padding:40px">' +
    '<p id="para">Bonjour le monde ceci est un texte de test a traduire.</p>' +
    '</body></html>');
  await page.evaluate(({ contentSource, MODELS }) => {
    window.__msgs = [];
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
            postMessage(msg) {
              window.__msgs.push(msg);
              setTimeout(() => {
                for (const fn of listeners) { fn({ type: 'chunk', text: 'reply' }); fn({ type: 'done' }); }
              }, 0);
            },
            disconnect() {}
          };
        },
        sendMessage(message, callback) {
          window.__msgs.push(message);
          // Real chrome.runtime.sendMessage allows omitting the callback, and
          // fire-and-forget messages like SET_MODEL / SET_PROVIDER do exactly that.
          if (typeof callback !== 'function') return;
          if (message.type === 'GET_MODELS') return callback({ models: MODELS });
          return callback({ success: true, result: 'reply' });
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
  }, { contentSource, MODELS });
}

// Open the floating panel by running an action on a selection, which is the
// only route that renders the panel header carrying the three chips.
async function openPanel(page) {
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
  await page.locator('#omnipilot-panel').waitFor({ state: 'visible' });
}

// ── Action selector ────────────────────────────────────────────────────────

test('the action chip opens a selector listing chat plus every action', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-action-wrap').click();
  const items = page.locator('#omnipilot-action-selector .omnipilot-model-item');
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeGreaterThan(1);
  await expect(items.first()).toContainText('Chat');
});

test('the action selector marks exactly one entry as current', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-action-wrap').click();
  await expect(page.locator('#omnipilot-action-selector .omnipilot-model-current')).toHaveCount(1);
});

test('clicking the action chip a second time closes the selector', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  const wrap = page.locator('.omnipilot-meta-action-wrap');
  await wrap.click();
  await expect(page.locator('#omnipilot-action-selector')).toHaveCount(1);
  await wrap.click();
  await expect(page.locator('#omnipilot-action-selector')).toHaveCount(0);
});

test('choosing an action closes the selector and updates the chip', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-action-wrap').click();
  const target = page.locator('#omnipilot-action-selector .omnipilot-model-item').nth(2);
  const chosen = (await target.textContent()).trim();
  await target.click();

  await expect(page.locator('#omnipilot-action-selector')).toHaveCount(0);
  await expect(page.locator('.omnipilot-meta-action-wrap')).toContainText(chosen.replace(/^\S+\s*/, ''));
});

test('a click outside dismisses the action selector', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-action-wrap').click();
  await expect(page.locator('#omnipilot-action-selector')).toHaveCount(1);
  await page.mouse.click(5, 5);
  await expect(page.locator('#omnipilot-action-selector')).toHaveCount(0);
});

// ── Provider selector ──────────────────────────────────────────────────────

test('the provider chip opens a selector with one current entry', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-provider-wrap').click();
  const items = page.locator('#omnipilot-provider-selector .omnipilot-model-item');
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThan(1);
  await expect(page.locator('#omnipilot-provider-selector .omnipilot-model-current')).toHaveCount(1);
});

test('choosing a provider sends SET_PROVIDER and closes the selector', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-provider-wrap').click();
  await page.locator('#omnipilot-provider-selector .omnipilot-model-item').nth(1).click();

  await expect(page.locator('#omnipilot-provider-selector')).toHaveCount(0);
  const sent = await page.evaluate(() => window.__msgs.filter(m => m.type === 'SET_PROVIDER'));
  expect(sent).toHaveLength(1);
});

// ── Model selector ─────────────────────────────────────────────────────────

test('the model chip requests models and lists them', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  const items = page.locator('#omnipilot-model-selector .omnipilot-model-item');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toHaveText('gpt-4o');
  const asked = await page.evaluate(() => window.__msgs.filter(m => m.type === 'GET_MODELS'));
  expect(asked.length).toBeGreaterThan(0);
});

test('a hostile model name is rendered as literal text', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  const hostile = page.locator('#omnipilot-model-selector .omnipilot-model-item').nth(3);
  await expect(hostile).toHaveText('<img src=x onerror=alert(1)>');
  // The markup must never have become a real element.
  await expect(page.locator('#omnipilot-model-selector img')).toHaveCount(0);
});

test('the filter narrows the model list', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  await page.locator('.omnipilot-model-filter').fill('mini');
  const items = page.locator('#omnipilot-model-selector .omnipilot-model-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveText('gpt-4o-mini');
});

test('the filter is case-insensitive', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  await page.locator('.omnipilot-model-filter').fill('CLAUDE');
  await expect(page.locator('#omnipilot-model-selector .omnipilot-model-item')).toHaveCount(1);
});

test('a filter matching nothing shows the no-matches message', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  await page.locator('.omnipilot-model-filter').fill('zzzznope');
  await expect(page.locator('#omnipilot-model-selector .omnipilot-model-item')).toHaveCount(0);
  await expect(page.locator('#omnipilot-model-selector .omnipilot-model-loading')).toBeVisible();
});

test('clearing the filter restores the full model list', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  const filter = page.locator('.omnipilot-model-filter');
  await filter.fill('mini');
  await expect(page.locator('#omnipilot-model-selector .omnipilot-model-item')).toHaveCount(1);
  await filter.fill('');
  await expect(page.locator('#omnipilot-model-selector .omnipilot-model-item')).toHaveCount(4);
});

test('choosing a model sends SET_MODEL, closes the selector and updates the chip', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  await page.locator('#omnipilot-model-selector .omnipilot-model-item').nth(1).click();

  await expect(page.locator('#omnipilot-model-selector')).toHaveCount(0);
  const sent = await page.evaluate(() => window.__msgs.filter(m => m.type === 'SET_MODEL'));
  expect(sent).toHaveLength(1);
  expect(sent[0].model).toBe('gpt-4o-mini');
  await expect(page.locator('.omnipilot-meta-model-wrap')).toContainText('gpt-4o-mini');
});

test('the model selector marks the current model', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  await page.locator('#omnipilot-model-selector .omnipilot-model-item').nth(2).click();
  await page.locator('.omnipilot-meta-model-wrap').click();

  const current = page.locator('#omnipilot-model-selector .omnipilot-model-current');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('claude-sonnet');
});

test('the model filter keeps keystrokes from reaching the host page', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.evaluate(() => {
    window.__hostKeys = 0;
    document.addEventListener('keydown', () => { window.__hostKeys++; });
  });
  await page.locator('.omnipilot-meta-model-wrap').click();
  await page.locator('.omnipilot-model-filter').press('a');

  expect(await page.evaluate(() => window.__hostKeys)).toBe(0);
});

test('a click outside dismisses the model selector', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  await expect(page.locator('#omnipilot-model-selector')).toHaveCount(1);
  await page.mouse.click(5, 5);
  await expect(page.locator('#omnipilot-model-selector')).toHaveCount(0);
});

test('only one selector is open at a time per chip toggle', async ({ page }) => {
  await setupPage(page);
  await openPanel(page);

  await page.locator('.omnipilot-meta-model-wrap').click();
  await expect(page.locator('#omnipilot-model-selector')).toHaveCount(1);
  await page.locator('.omnipilot-meta-model-wrap').click();
  await expect(page.locator('#omnipilot-model-selector')).toHaveCount(0);
});
