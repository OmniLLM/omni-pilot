// Coverage for the side panel's page-context feature: reading the active tab
// through the content script, showing it as a toggleable chip, and grounding
// the conversation in it.
//
// Same harness shape as sidepanel.spec.js — the panel is loaded from dist/ over
// file:// with a scripted chrome.* stub installed before the bundle runs. This
// stub additionally implements chrome.tabs so the page lookup can be driven.
const { test, expect } = require('@playwright/test');
const path = require('path');

const SIDEPANEL_URL = 'file:///' + path.resolve(__dirname, '..', 'dist', 'sidepanel.html').replace(/\\/g, '/');

const PAGE = {
  title: 'Quarterly Report',
  url: 'https://example.com/report',
  content: 'Revenue grew 12% year over year.'
};

/**
 * @param {object|null} pageResponse what the content script replies with, or
 *   null to simulate a page that has no content script (restricted URLs).
 */
async function open(page, { pageResponse = PAGE, tab = { id: 7, title: 'Quarterly Report', url: 'https://example.com/report' } } = {}) {
  await page.addInitScript(({ pageResponse, tab }) => {
    const ports = [];
    window.__ports = ports;
    window.__lastPort = () => ports[ports.length - 1];
    window.__tabListeners = { activated: [], updated: [] };

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
        openOptionsPage() {}
      },
      tabs: {
        query(_info, callback) { callback(tab ? [tab] : []); },
        sendMessage(_tabId, message, callback) {
          if (message.type !== 'GET_PAGE_CONTEXT') { callback(undefined); return; }
          if (!pageResponse) {
            // Mirrors Chrome's behaviour when no content script is present.
            window.chrome.runtime.lastError = { message: 'Could not establish connection.' };
            callback(undefined);
            window.chrome.runtime.lastError = null;
            return;
          }
          callback({ success: true, ...pageResponse });
        },
        onActivated: { addListener(fn) { window.__tabListeners.activated.push(fn); }, removeListener() {} },
        onUpdated: { addListener(fn) { window.__tabListeners.updated.push(fn); }, removeListener() {} }
      },
      storage: {
        sync: {
          get(defaults, callback) { callback({ ...defaults }); },
          set(_values, callback = () => {}) { callback(); }
        },
        local: {
          get(_keys, callback) { callback({}); },
          set(_values, callback = () => {}) { callback(); }
        },
        onChanged: { addListener() {}, removeListener() {} }
      }
    };
  }, { pageResponse, tab });

  await page.goto(SIDEPANEL_URL);
}

async function send(page, text) {
  await page.fill('#chatInput', text);
  await page.click('#sendBtn');
}

const lastPosted = page => page.evaluate(() => window.__lastPort().posted);

test('shows the current page title in the context chip', async ({ page }) => {
  await open(page);

  const chip = page.locator('.sp-context');
  await expect(chip).toBeVisible();
  await expect(chip.locator('.sp-context-text')).toHaveText('Quarterly Report');
  await expect(chip.locator('input[type="checkbox"]')).toBeChecked();
  await expect(chip).toHaveAttribute('title', 'https://example.com/report');
});

test('reports when the page cannot be read', async ({ page }) => {
  await open(page, { pageResponse: null });

  const chip = page.locator('.sp-context');
  await expect(chip).toHaveClass(/sp-context-empty/);
  await expect(chip.locator('.sp-context-text')).toHaveText("This page can't be read");
  await expect(chip.locator('input[type="checkbox"]')).toHaveCount(0);
});

test('falls back to the URL when neither the page nor the tab has a title', async ({ page }) => {
  await open(page, {
    pageResponse: { ...PAGE, title: '' },
    tab: { id: 7, title: '', url: 'https://example.com/report' }
  });

  await expect(page.locator('.sp-context-text')).toHaveText('https://example.com/report');
});

test('falls back to the tab title when the page reports none', async ({ page }) => {
  await open(page, {
    pageResponse: { ...PAGE, title: '' },
    tab: { id: 7, title: 'Tab Title', url: 'https://example.com/report' }
  });

  await expect(page.locator('.sp-context-text')).toHaveText('Tab Title');
});

test('grounds the first request in the page content', async ({ page }) => {
  await open(page);
  await expect(page.locator('.sp-context-text')).toHaveText('Quarterly Report');

  await send(page, 'What was revenue growth?');

  const posted = await lastPosted(page);
  const messages = posted[0].messages;
  expect(posted[0].type).toBe('AI_CHAT_STREAM');
  expect(messages).toHaveLength(2);
  expect(messages[0].role).toBe('system');
  expect(messages[0].content).toContain('Revenue grew 12% year over year.');
  expect(messages[0].content).toContain('Title: Quarterly Report');
  expect(messages[0].content).toContain('URL: https://example.com/report');
  expect(messages[1]).toEqual({ role: 'user', content: 'What was revenue growth?' });
});

test('sends the page context only once across turns', async ({ page }) => {
  await open(page);
  await expect(page.locator('.sp-context-text')).toHaveText('Quarterly Report');

  await send(page, 'First');
  await page.evaluate(() => {
    window.__lastPort().emit({ type: 'chunk', text: 'Answer' });
    window.__lastPort().emit({ type: 'done' });
  });
  await send(page, 'Second');

  const messages = (await lastPosted(page))[0].messages;
  const systemMessages = messages.filter(message => message.role === 'system');
  expect(systemMessages).toHaveLength(1);
  expect(messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
});

test('unchecking the chip keeps the page out of the request', async ({ page }) => {
  await open(page);
  await expect(page.locator('.sp-context-text')).toHaveText('Quarterly Report');

  await page.locator('.sp-context input[type="checkbox"]').uncheck();
  await send(page, 'Ignore the page');

  const messages = (await lastPosted(page))[0].messages;
  expect(messages).toEqual([{ role: 'user', content: 'Ignore the page' }]);
});

test('sends no page context when the page cannot be read', async ({ page }) => {
  await open(page, { pageResponse: null });

  await send(page, 'Hello');

  const messages = (await lastPosted(page))[0].messages;
  expect(messages).toEqual([{ role: 'user', content: 'Hello' }]);
});

test('sends no page context when the page has no extractable text', async ({ page }) => {
  await open(page, { pageResponse: { ...PAGE, content: '' } });

  await send(page, 'Hello');

  const messages = (await lastPosted(page))[0].messages;
  expect(messages).toEqual([{ role: 'user', content: 'Hello' }]);
});

test('refreshes the chip when the user switches tabs', async ({ page }) => {
  await open(page);
  await expect(page.locator('.sp-context-text')).toHaveText('Quarterly Report');

  await page.evaluate(() => {
    window.chrome.tabs.sendMessage = (_tabId, message, callback) => {
      if (message.type !== 'GET_PAGE_CONTEXT') { callback(undefined); return; }
      callback({ success: true, title: 'Another Page', url: 'https://example.org/other', content: 'Other text.' });
    };
    window.__tabListeners.activated.forEach(fn => fn({ tabId: 9 }));
  });

  await expect(page.locator('.sp-context-text')).toHaveText('Another Page');
});
