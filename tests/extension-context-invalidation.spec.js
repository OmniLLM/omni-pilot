// End-to-end reproduction of the "Uncaught Error: Extension context invalidated."
// crash reported at dist/content.js:2010 while browsing developers.openai.com/codex.
//
// Scenario: the extension is reloaded/updated while the content script is still
// alive in the page. Chrome keeps chrome.runtime defined but every call to
// chrome.runtime.connect() / chrome.runtime.sendMessage() throws synchronously
// with "Extension context invalidated." — surfaced by the browser as an uncaught
// error because the content script never catches it.
//
// This spec pretends to be the omni-pilot chrome extension by evaluating the
// built dist/content.js against a Playwright page with a mocked chrome API.
// It simulates the invalidation after init, then drives the same user actions
// the crash trace pointed to (opening the translate action → streamAction()
// → createStreamPort() → runtime.connect(...)), plus the sendMessage-based
// selectors and A2A follow-ups.

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'content.js'), 'utf8');

// Boot the page with a healthy chrome.runtime, load the built content script,
// then expose window.__invalidate() so tests can flip the runtime into an
// "extension context invalidated" state — every subsequent connect/sendMessage
// throws synchronously, matching real Chrome behavior after an extension reload.
async function setupPageWithInvalidatableRuntime(page) {
  await page.goto('about:blank');
  await page.setContent(`<!DOCTYPE html><html><head></head>` +
    `<body style="padding:40px">` +
    `<p id="para">Bonjour le monde ceci est un texte de test a traduire.</p>` +
    `<p id="p2">Comment allez vous aujourd hui mon ami.</p>` +
    `</body></html>`);

  await page.evaluate(({ contentSource }) => {
    window.__msgs = [];
    window.__connectCalls = 0;
    window.__sendMessageCalls = 0;

    // Start with a healthy runtime so init completes cleanly.
    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        connect(opts) {
          window.__connectCalls++;
          const listeners = [];
          return {
            name: opts && opts.name || '',
            onMessage: { addListener(fn) { listeners.push(fn); } },
            onDisconnect: { addListener() {} },
            postMessage(msg) { window.__msgs.push(msg); },
            disconnect() {}
          };
        },
        sendMessage(message, callback) {
          window.__sendMessageCalls++;
          window.__msgs.push(message);
          if (message.type === 'GET_MODELS') return callback && callback({ models: ['gpt-4o'] });
          return callback && callback({ success: true });
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

    // Flip the runtime into the invalidated state. Matches what Chrome does when
    // an extension is reloaded/updated while a content script is still resident.
    window.__invalidate = function () {
      const invalidated = () => { throw new Error('Extension context invalidated.'); };
      window.chrome.runtime.connect = invalidated;
      window.chrome.runtime.sendMessage = invalidated;
      window.chrome.runtime.openOptionsPage = invalidated;
      // Storage APIs also throw synchronously after invalidation.
      window.chrome.storage.sync.get = invalidated;
      window.chrome.storage.sync.set = invalidated;
      window.chrome.storage.local.get = invalidated;
      window.chrome.storage.local.set = invalidated;
      window.chrome.storage.onChanged.addListener = invalidated;
    };

    // Capture the storage.onChanged listener so tests can fire it manually.
    window.__storageListeners = [];
    const originalAddListener = window.chrome.storage.onChanged.addListener;
    window.chrome.storage.onChanged.addListener = function (fn) {
      window.__storageListeners.push(fn);
      return originalAddListener(fn);
    };
  }, { contentSource });
}

async function selectNode(page, selector) {
  await page.evaluate(sel => {
    const node = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(node);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selector);
}

async function selectAndMouseup(page, selector) {
  await selectNode(page, selector);
  await page.evaluate(sel => {
    const node = document.querySelector(sel);
    const r = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
  }, selector);
  await page.waitForTimeout(40);
}

// Regression for the reported crash: opening a stream action after the extension
// context is invalidated must NOT bubble "Extension context invalidated." to the
// page — it must render a localized error inside the panel instead.
test('stream action does not throw when the extension context is invalidated', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err));

  await setupPageWithInvalidatableRuntime(page);
  await page.evaluate(() => window.__invalidate());

  await selectAndMouseup(page, '#para');
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  await page.waitForTimeout(80);

  const contextErrors = pageErrors.filter(e => /Extension context invalidated/i.test(e.message));
  expect(contextErrors).toEqual([]);

  await expect(page.locator('#omnipilot-panel .omnipilot-loading')).toHaveCount(0);
  await expect(page.locator('#omnipilot-panel .omnipilot-error')).toHaveCount(1);
  await expect(page.locator('#omnipilot-panel .omnipilot-error')).toContainText(/context|refresh/i);
});

// The model selector fetches models via runtime.sendMessage. When the runtime
// throws synchronously it must not surface as an uncaught error and it must not
// leave the selector stuck in a "Loading models…" state.
test('model selector does not throw when the extension context is invalidated', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err));

  await setupPageWithInvalidatableRuntime(page);

  // Open a panel first (this uses a still-healthy connect so a panel exists).
  await selectAndMouseup(page, '#para');
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  await page.waitForTimeout(60);
  await expect(page.locator('#omnipilot-panel')).toBeVisible();

  // Now invalidate and click the model selector chip. It calls sendMessage twice
  // (GET_MODELS list + SET_MODEL on click). Both used to throw uncaught.
  await page.evaluate(() => window.__invalidate());
  await page.locator('#omnipilot-panel .omnipilot-meta-model-wrap').click();
  await page.waitForTimeout(60);

  const contextErrors = pageErrors.filter(e => /Extension context invalidated/i.test(e.message));
  expect(contextErrors).toEqual([]);

  // Selector should have closed itself instead of showing a permanent spinner.
  await expect(page.locator('#omnipilot-model-selector')).toHaveCount(0);
});

// The provider selector's SET_PROVIDER click also goes through runtime.sendMessage.
// A synchronous throw there must not crash the page either.
test('provider selector does not throw when the extension context is invalidated', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err));

  await setupPageWithInvalidatableRuntime(page);
  await selectAndMouseup(page, '#para');
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  await page.waitForTimeout(60);

  await page.evaluate(() => window.__invalidate());
  await page.locator('#omnipilot-panel .omnipilot-meta-provider-wrap').click();
  await page.waitForTimeout(20);
  // Click the first provider entry — this posts SET_PROVIDER via sendMessage.
  const first = page.locator('#omnipilot-provider-selector .omnipilot-model-item').first();
  if (await first.count()) await first.click();
  await page.waitForTimeout(20);

  const contextErrors = pageErrors.filter(e => /Extension context invalidated/i.test(e.message));
  expect(contextErrors).toEqual([]);
});

// A follow-up chat message drives streamChat() → createStreamPort() → runtime.connect().
// Same crash site as the reported bug (dist/content.js:2010) but reached via the
// panel input rather than the initial dropdown.
test('chat follow-up does not throw when the extension context is invalidated', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err));

  await setupPageWithInvalidatableRuntime(page);
  await selectAndMouseup(page, '#para');
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  await page.waitForTimeout(60);

  await page.evaluate(() => window.__invalidate());
  const input = page.locator('#omnipilot-panel .omnipilot-panel-input');
  await input.fill('hello?');
  await input.press('Enter');
  await page.waitForTimeout(60);

  const contextErrors = pageErrors.filter(e => /Extension context invalidated/i.test(e.message));
  expect(contextErrors).toEqual([]);

  await expect(page.locator('#omnipilot-panel .omnipilot-loading')).toHaveCount(0);
  await expect(page.locator('#omnipilot-panel .omnipilot-error').last()).toContainText(/context|refresh/i);
});

// Even if connect() succeeds but the invalidation happens between connect and
// postMessage (a real race when the worker is being restarted), the throw from
// port.postMessage() must be caught and surfaced as an in-panel error rather
// than escaping the content script.
test('port.postMessage throw after connect does not crash the page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err));

  await setupPageWithInvalidatableRuntime(page);
  await page.evaluate(() => {
    // Keep connect working but make the returned port.postMessage throw. This
    // models the race where the worker restarts between connect and the first
    // postMessage frame.
    window.chrome.runtime.connect = function (opts) {
      return {
        name: opts && opts.name || '',
        onMessage: { addListener() {} },
        onDisconnect: { addListener() {} },
        postMessage() { throw new Error('Extension context invalidated.'); },
        disconnect() {}
      };
    };
  });

  await selectAndMouseup(page, '#para');
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  await page.waitForTimeout(80);

  const contextErrors = pageErrors.filter(e => /Extension context invalidated/i.test(e.message));
  expect(contextErrors).toEqual([]);

  await expect(page.locator('#omnipilot-panel .omnipilot-loading')).toHaveCount(0);
  await expect(page.locator('#omnipilot-panel .omnipilot-error')).toHaveCount(1);
});

// The reported bug's actual crash context was github.com/asimons81/hermes-a2a-bridge —
// a page that was already loaded when the extension was reloaded. In that state,
// firing a chrome.storage.onChanged listener from another page (e.g. options.html
// saving new settings) used to throw synchronously because the listener body
// touched chrome.storage.local and chrome.runtime.* through helper functions.
// The safeAddListener wrapper must catch the invalidated-context throw so it
// doesn't surface as "Uncaught Error: Extension context invalidated."
test('storage.onChanged listener does not crash when the context is invalidated', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err));

  await setupPageWithInvalidatableRuntime(page);
  await page.evaluate(() => window.__invalidate());

  // Fire the same storage.onChanged event options.js would emit when the user
  // saves a new provider — the listener body references chrome.storage.local
  // (invalidated) and calls updatePanelMeta which is safe, but any invalidated
  // chrome.* touch inside must not escape.
  await page.evaluate(() => {
    for (const fn of window.__storageListeners) {
      fn({ providerType: { newValue: 'custom-provider' }, endpoint: { newValue: 'https://x.example' } }, 'sync');
      fn({ a2aServers: { newValue: [{ id: 'a2a-1', name: 'x', enabled: true }] } }, 'local');
      fn({ themePreference: { newValue: 'light' } }, 'sync');
    }
  });
  await page.waitForTimeout(30);

  const contextErrors = pageErrors.filter(e => /Extension context invalidated/i.test(e.message));
  expect(contextErrors).toEqual([]);
});

// If the extension is invalidated BEFORE the content script even runs its
// top-level init, the chrome.storage.sync.get calls at load time throw. That
// must also be caught so the content script doesn't blow up on page load
// after a re-injection into a stale page.
test('initial storage.get throws do not crash the page', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err));

  await page.goto('about:blank');
  await page.setContent(`<!DOCTYPE html><html><head></head><body><p id="para">hello world text</p></body></html>`);
  await page.evaluate(({ contentSource }) => {
    // Provide a chrome object whose storage.sync.get and everything else throws
    // synchronously from the very first call — mirrors a re-injection into a
    // page whose owning extension is already invalidated.
    const invalidated = () => { throw new Error('Extension context invalidated.'); };
    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener: invalidated },
        connect: invalidated,
        sendMessage: invalidated,
        openOptionsPage: invalidated
      },
      storage: {
        sync: { get: invalidated, set: invalidated },
        local: { get: invalidated, set: invalidated },
        onChanged: { addListener: invalidated }
      }
    };
    // eslint-disable-next-line no-eval
    window.eval(contentSource);
  }, { contentSource });

  await page.waitForTimeout(50);

  const contextErrors = pageErrors.filter(e => /Extension context invalidated/i.test(e.message));
  expect(contextErrors).toEqual([]);
});
