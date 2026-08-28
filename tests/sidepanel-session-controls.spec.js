// Coverage for the side panel's session controls: the action, provider, and
// model chips in its header.
//
// Same harness shape as sidepanel-page-context.spec.js — the panel is loaded
// from dist/ over file:// with a scripted chrome.* stub installed before the
// bundle runs. This stub records runtime messages and exposes the storage
// change listeners so settings changes made "elsewhere" can be simulated.
const { test, expect } = require('@playwright/test');
const path = require('path');

const SIDEPANEL_URL = 'file:///' + path.resolve(__dirname, '..', 'dist', 'sidepanel.html').replace(/\\/g, '/');

const PAGE = {
  title: 'Quarterly Report',
  url: 'https://example.com/report',
  content: 'Revenue grew 12% year over year.'
};

const MODELS = ['claude-sonnet-4-5', 'claude-haiku-4.5', 'gpt-5-mini'];

async function open(page, {
  pageResponse = PAGE,
  settings = {},
  models = MODELS
} = {}) {
  await page.addInitScript(({ pageResponse, settings, models }) => {
    const ports = [];
    window.__ports = ports;
    window.__lastPort = () => ports[ports.length - 1];
    window.__sent = [];
    window.__storageListeners = [];
    const stored = { model: 'claude-sonnet-4-5', providerType: 'custom-provider', languagePreference: 'en', ...settings };

    window.chrome = {
      runtime: {
        lastError: null,
        connect(info) {
          const onMessage = [];
          const onDisconnect = [];
          const port = {
            name: info && info.name,
            posted: [],
            onMessage: { addListener: fn => onMessage.push(fn) },
            onDisconnect: { addListener: fn => onDisconnect.push(fn) },
            postMessage(message) { port.posted.push(message); },
            disconnect() {},
            emit(message) { onMessage.slice().forEach(fn => fn(message)); }
          };
          ports.push(port);
          return port;
        },
        // Deliberately tolerates a missing callback: SET_MODEL and SET_PROVIDER
        // are fire-and-forget, exactly as the extension sends them.
        sendMessage(message, callback) {
          window.__sent.push(message);
          if (message.type === 'GET_MODELS' && typeof callback === 'function') {
            setTimeout(() => callback({ models }), 0);
          }
        },
        openOptionsPage() {}
      },
      tabs: {
        query(_info, callback) { callback([{ id: 7, title: pageResponse ? pageResponse.title : 'x', url: 'https://example.com/report' }]); },
        sendMessage(_tabId, message, callback) {
          if (message.type !== 'GET_PAGE_CONTEXT') { callback(undefined); return; }
          if (!pageResponse) {
            window.chrome.runtime.lastError = { message: 'Could not establish connection.' };
            callback(undefined);
            window.chrome.runtime.lastError = null;
            return;
          }
          callback({ success: true, ...pageResponse });
        },
        onActivated: { addListener() {}, removeListener() {} },
        onUpdated: { addListener() {}, removeListener() {} }
      },
      storage: {
        sync: {
          get(defaults, callback) {
            const result = { ...defaults };
            for (const key of Object.keys(result)) {
              if (key in stored) result[key] = stored[key];
            }
            callback(result);
          },
          set(_values, callback = () => {}) { callback(); }
        },
        local: {
          get(_keys, callback) { callback({}); },
          set(_values, callback = () => {}) { callback(); }
        },
        onChanged: {
          addListener(fn) { window.__storageListeners.push(fn); },
          removeListener(fn) {
            const at = window.__storageListeners.indexOf(fn);
            if (at !== -1) window.__storageListeners.splice(at, 1);
          }
        }
      }
    };
  }, { pageResponse, settings, models });

  await page.goto(SIDEPANEL_URL);
  await expect(page.locator('#spModelChip')).toBeVisible();
}

const sentMessages = page => page.evaluate(() => window.__sent);
const portCount = page => page.evaluate(() => window.__ports.length);

async function openChip(page, id) {
  await page.click(`#${id}`);
  await expect(page.locator(`#${id}-selector`)).toBeVisible();
}

// ── The header reports the session ──────────────────────────────────────────

test('the header names the stored model and provider', async ({ page }) => {
  await open(page, { settings: { model: 'claude-haiku-4.5', providerType: 'github-copilot' } });

  await expect(page.locator('#spModelChip')).toContainText('claude-haiku-4.5');
  await expect(page.locator('#spProviderChip')).toContainText('GitHub Copilot');
  await expect(page.locator('#spActionChip')).toContainText('Chat');
});

test('a model change made elsewhere is reflected without reopening', async ({ page }) => {
  await open(page);
  await expect(page.locator('#spModelChip')).toContainText('claude-sonnet-4-5');

  await page.evaluate(() => {
    window.__storageListeners.forEach(fn => fn({ model: { newValue: 'gpt-5-mini' } }, 'sync'));
  });

  await expect(page.locator('#spModelChip')).toContainText('gpt-5-mini');
});

test('a provider change made elsewhere is reflected without reopening', async ({ page }) => {
  await open(page);
  await expect(page.locator('#spProviderChip')).toContainText('Custom');

  await page.evaluate(() => {
    window.__storageListeners.forEach(fn => fn({ providerType: { newValue: 'azure-foundry' } }, 'sync'));
  });

  await expect(page.locator('#spProviderChip')).toContainText('Azure Foundry');
});

// ── The model selector ──────────────────────────────────────────────────────

test('opening the model selector requests the model list and renders it', async ({ page }) => {
  await open(page);
  await openChip(page, 'spModelChip');

  await expect(page.locator('#spModelChip-selector .sp-selector-item')).toHaveCount(MODELS.length);
  expect((await sentMessages(page)).some(message => message.type === 'GET_MODELS')).toBe(true);
});

test('the model selector marks exactly one current entry', async ({ page }) => {
  await open(page, { settings: { model: 'gpt-5-mini' } });
  await openChip(page, 'spModelChip');

  const current = page.locator('#spModelChip-selector .sp-selector-current');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('gpt-5-mini');
});

test('typing narrows the model list', async ({ page }) => {
  await open(page);
  await openChip(page, 'spModelChip');
  await expect(page.locator('#spModelChip-selector .sp-selector-item')).toHaveCount(3);

  await page.fill('.sp-selector-filter', 'haiku');

  await expect(page.locator('#spModelChip-selector .sp-selector-item')).toHaveCount(1);
  await expect(page.locator('#spModelChip-selector .sp-selector-item')).toHaveText('claude-haiku-4.5');
});

test('a filter matching nothing says so', async ({ page }) => {
  await open(page);
  await openChip(page, 'spModelChip');

  await page.fill('.sp-selector-filter', 'zzzz');

  await expect(page.locator('#spModelChip-selector .sp-selector-item')).toHaveCount(0);
  await expect(page.locator('#spModelChip-selector .sp-selector-empty')).toHaveText('No matches');
});

test('a model name that looks like markup is shown literally', async ({ page }) => {
  await open(page, { models: ['<img src=x onerror=alert(1)>'] });
  await openChip(page, 'spModelChip');

  await expect(page.locator('#spModelChip-selector .sp-selector-item')).toHaveText('<img src=x onerror=alert(1)>');
  expect(await page.locator('#spModelChip-selector img').count()).toBe(0);
});

test('choosing a model sends SET_MODEL, closes the selector and updates the chip', async ({ page }) => {
  await open(page);
  await openChip(page, 'spModelChip');

  await page.click('#spModelChip-selector .sp-selector-item:has-text("gpt-5-mini")');

  await expect(page.locator('#spModelChip-selector')).toHaveCount(0);
  await expect(page.locator('#spModelChip')).toContainText('gpt-5-mini');
  expect(await sentMessages(page)).toContainEqual({ type: 'SET_MODEL', model: 'gpt-5-mini' });
});

// ── The provider selector ───────────────────────────────────────────────────

test('the provider selector lists every provider and marks the current one', async ({ page }) => {
  await open(page, { settings: { providerType: 'github-copilot' } });
  await openChip(page, 'spProviderChip');

  await expect(page.locator('#spProviderChip-selector .sp-selector-item')).toHaveText([
    'Custom', 'GitHub Copilot', 'Azure Foundry'
  ]);
  await expect(page.locator('#spProviderChip-selector .sp-selector-current')).toHaveText('GitHub Copilot');
});

test('choosing a provider sends SET_PROVIDER and updates the chip', async ({ page }) => {
  await open(page);
  await openChip(page, 'spProviderChip');

  await page.click('#spProviderChip-selector .sp-selector-item:has-text("Azure Foundry")');

  await expect(page.locator('#spProviderChip-selector')).toHaveCount(0);
  await expect(page.locator('#spProviderChip')).toContainText('Azure Foundry');
  expect(await sentMessages(page)).toContainEqual({ type: 'SET_PROVIDER', providerType: 'azure-foundry' });
});

// ── The action selector ─────────────────────────────────────────────────────

test('the action selector lists chat followed by every built-in function', async ({ page }) => {
  await open(page);
  await openChip(page, 'spActionChip');

  await expect(page.locator('#spActionChip-selector .sp-selector-item')).toHaveText([
    '💬Chat', '🌍Translate', '📝Summarize', '💡Explain', '✨Improve', '😊Sentiment',
    '🔧Code Explain', '📋Divide Paragraphs', '❓Ask'
  ]);
  await expect(page.locator('#spActionChip-selector .sp-selector-current')).toHaveText('💬Chat');
});

test('choosing a function runs it against the page content', async ({ page }) => {
  await open(page);
  await openChip(page, 'spActionChip');

  await page.click('#spActionChip-selector .sp-selector-item:has-text("Summarize")');

  await expect(page.locator('#spActionChip')).toContainText('Summarize');
  await expect(page.locator('.sp-divider')).toContainText('Summarize');

  expect(await page.evaluate(() => window.__lastPort().posted)).toEqual([
    { type: 'AI_ACTION_STREAM', action: 'summarize', text: PAGE.content }
  ]);
});

test('a function result streams into the transcript', async ({ page }) => {
  await open(page);
  await openChip(page, 'spActionChip');
  await page.click('#spActionChip-selector .sp-selector-item:has-text("Explain")');

  await page.evaluate(() => {
    const port = window.__lastPort();
    port.emit({ type: 'chunk', text: 'It is a report.' });
    port.emit({ type: 'done' });
  });

  await expect(page.locator('.sp-msg-assistant')).toHaveText('It is a report.');
  await expect(page.locator('.sp-msg-assistant.sp-streaming')).toHaveCount(0);
});

test('choosing chat runs nothing', async ({ page }) => {
  await open(page);
  await openChip(page, 'spActionChip');

  await page.click('#spActionChip-selector .sp-selector-item:has-text("Chat")');

  await expect(page.locator('#spActionChip-selector')).toHaveCount(0);
  expect(await portCount(page)).toBe(0);
  await expect(page.locator('.sp-divider')).toHaveCount(0);
});

test('an unreadable page cannot run a function', async ({ page }) => {
  await open(page, { pageResponse: null });
  await expect(page.locator('.sp-context-empty')).toBeVisible();

  await openChip(page, 'spActionChip');
  await page.click('#spActionChip-selector .sp-selector-item:has-text("Summarize")');

  await expect(page.locator('.sp-error')).toContainText("can't be read");
  expect(await portCount(page)).toBe(0);
});

// ── Selector behaviour ──────────────────────────────────────────────────────

test('a second click on the same chip closes the selector', async ({ page }) => {
  await open(page);
  await openChip(page, 'spActionChip');

  await page.click('#spActionChip');

  await expect(page.locator('#spActionChip-selector')).toHaveCount(0);
});

test('opening one selector closes another', async ({ page }) => {
  await open(page);
  await openChip(page, 'spActionChip');

  await openChip(page, 'spProviderChip');

  await expect(page.locator('#spActionChip-selector')).toHaveCount(0);
  await expect(page.locator('.sp-selector')).toHaveCount(1);
});

test('clicking away dismisses the selector without applying a choice', async ({ page }) => {
  await open(page);
  await openChip(page, 'spProviderChip');

  await page.click('.sp-body');

  await expect(page.locator('.sp-selector')).toHaveCount(0);
  await expect(page.locator('#spProviderChip')).toContainText('Custom');
  expect((await sentMessages(page)).some(message => message.type === 'SET_PROVIDER')).toBe(false);
});

// ── Localization ────────────────────────────────────────────────────────────

test('function names follow the language preference', async ({ page }) => {
  await open(page, { settings: { languagePreference: 'zh' } });
  await openChip(page, 'spActionChip');

  const first = page.locator('#spActionChip-selector .sp-selector-item').first();
  await expect(first).not.toHaveText('Chat');
  await expect(page.locator('#spActionChip')).not.toContainText('Chat');
});
