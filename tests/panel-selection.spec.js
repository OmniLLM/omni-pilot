const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'content.js'), 'utf8');
const stylesSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'styles.css'), 'utf8');

async function setupPage(page) {
  await page.goto('about:blank');
  await page.setContent(`<!DOCTYPE html><html><head><style>${stylesSource}</style></head>` +
    `<body style="padding:40px">` +
    `<p id="para">Bonjour le monde ceci est un texte de test a traduire.</p>` +
    `<p id="p2">Comment allez vous aujourd hui mon ami.</p>` +
    `<div id="blank" style="height:400px"></div>` +
    `</body></html>`);
  await page.evaluate(({ contentSource }) => {
    window.__msgs = [];
    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        connect(opts) {
          const listeners = [];
          return {
            name: opts && opts.name || '',
            onMessage: { addListener(fn) { listeners.push(fn); } },
            onDisconnect: { addListener() {} },
            postMessage(msg) {
              window.__msgs.push(msg);
              // Simulate streaming response
              setTimeout(function() {
                var result = '';
                if (msg.type === 'AI_ACTION_STREAM') result = 'ACTION:' + msg.action + ' -> Hello world';
                else if (msg.type === 'AI_CHAT_STREAM') result = 'CHAT reply';
                for (var i = 0; i < listeners.length; i++) {
                  listeners[i]({ type: 'chunk', text: result });
                  listeners[i]({ type: 'done' });
                }
              }, 0);
            },
            disconnect() {}
          };
        },
        sendMessage(message, callback) {
          window.__msgs.push(message);
          if (message.type === 'GET_MODELS') return callback({ models: ['gpt-4o'] });
          if (message.type === 'AI_ACTION') return callback({ success: true, result: 'ACTION:' + message.action + ' -> Hello world' });
          if (message.type === 'AI_CHAT') return callback({ success: true, result: 'CHAT reply' });
          return callback({ success: true });
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
  }, { contentSource });
}

// Set the window selection over a node (models the real-browser invariant that the
// page selection stays active while the user interacts with the user-select:none panel).
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

async function openTranslatePanel(page) {
  await selectAndMouseup(page, '#para');
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  await page.waitForTimeout(60);
}

test('floating panel title opens the GitHub repository', async ({ page }) => {
  await setupPage(page);
  const openedUrls = [];
  await page.exposeFunction('__captureOpen', url => openedUrls.push(url));
  await page.evaluate(() => {
    window.open = url => window.__captureOpen(String(url));
  });

  await openTranslatePanel(page);
  await page.locator('#omnipilot-panel .omnipilot-panel-title').click();

  expect(openedUrls).toEqual(['https://github.com/OmniLLM/omni-pilot']);
});

test('BUG1: single click on the ✕ removes the selection context', async ({ page }) => {
  await setupPage(page);
  await openTranslatePanel(page);

  // Add a second context so there are two remove buttons (accidental extra selection).
  await selectAndMouseup(page, '#p2');
  expect(await page.locator('#omnipilot-panel .omnipilot-selected-context').count()).toBe(2);

  // Real-browser invariant: the page text selection is still active while the panel is open.
  await selectNode(page, '#p2');

  // ONE real mouse click on the last ✕ button.
  const xbox = await page.locator('#omnipilot-panel .omnipilot-context-remove').last().boundingBox();
  await page.mouse.click(xbox.x + xbox.width / 2, xbox.y + xbox.height / 2);
  await page.waitForTimeout(80); // allow the 10ms trailing-mouseup timeout to run

  // Must drop to exactly one context — not reappear.
  expect(await page.locator('#omnipilot-panel .omnipilot-selected-context').count()).toBe(1);
});

// Like setupPage, but the stream port is *controllable*: it never auto-responds.
// Tests drive it via window.__port.emit(msg) / window.__port.fireDisconnect(),
// modelling a service worker that streams, stalls, or dies mid-request.
async function setupPageWithControllablePort(page) {
  await page.goto('about:blank');
  await page.setContent(`<!DOCTYPE html><html><head><style>${stylesSource}</style></head>` +
    `<body style="padding:40px">` +
    `<p id="para">Bonjour le monde ceci est un texte de test a traduire.</p>` +
    `</body></html>`);
  await page.evaluate(({ contentSource }) => {
    window.__msgs = [];
    const makePort = () => {
      const listeners = [];
      const disconnectListeners = [];
      const port = {
        name: 'omnipilot-stream',
        onMessage: { addListener(fn) { listeners.push(fn); } },
        onDisconnect: { addListener(fn) { disconnectListeners.push(fn); } },
        postMessage(msg) {
          window.__msgs.push(msg);
          // Auto-complete the initial action stream so the panel opens cleanly.
          // Leave AI_CHAT_STREAM (the follow-up under test) fully controllable.
          if (msg.type === 'AI_ACTION_STREAM') {
            setTimeout(() => {
              listeners.forEach(fn => fn({ type: 'chunk', text: 'ACTION:' + msg.action }));
              listeners.forEach(fn => fn({ type: 'done' }));
            }, 0);
          }
        },
        disconnect() {},
        emit(msg) { listeners.forEach(fn => fn(msg)); },
        fireDisconnect() { disconnectListeners.forEach(fn => fn()); }
      };
      if (window.__pendingChat) window.__port = port;
      window.__lastPort = port;
      return port;
    };
    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        connect() { return makePort(); },
        sendMessage(message, callback) {
          window.__msgs.push(message);
          if (message.type === 'GET_MODELS') return callback({ models: ['gpt-4o'] });
          return callback({ success: true });
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
  }, { contentSource });
}

async function openChatAndSendFollowUp(page, text) {
  // Open the panel via the translate dropdown action (auto-completes), then send
  // a chat follow-up — follow-ups always post AI_CHAT_STREAM on a fresh port.
  await selectAndMouseup(page, '#para');
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  await page.waitForTimeout(60);

  await page.evaluate(() => { window.__pendingChat = true; });
  const input = page.locator('#omnipilot-panel .omnipilot-panel-input');
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(40);
}

// End-to-end reproduction of the reported bug in a real browser: a chat whose
// stream port disconnects before any content used to leave the panel blank
// (spinner removed, no answer, no error). It must now show an error.
test('chat follow-up shows an error when the worker disconnects silently', async ({ page }) => {
  await setupPageWithControllablePort(page);
  await openChatAndSendFollowUp(page, 'how many VMs in alibaba');

  // Spinner is up, request was sent, nothing has come back yet.
  await expect(page.locator('#omnipilot-panel .omnipilot-loading')).toHaveCount(1);
  expect(await page.evaluate(() => window.__msgs.some(m => m.type === 'AI_CHAT_STREAM'))).toBe(true);

  // Service worker dies before sending anything.
  await page.evaluate(() => window.__port.fireDisconnect());
  await page.waitForTimeout(20);

  await expect(page.locator('#omnipilot-panel .omnipilot-loading')).toHaveCount(0);
  await expect(page.locator('#omnipilot-panel .omnipilot-error')).toHaveCount(1);
});

// A 'delegating' status keeps the spinner (relabeled) and a later chunk+done
// still renders the delegated answer.
test('chat follow-up surfaces delegating status then renders the answer', async ({ page }) => {
  await setupPageWithControllablePort(page);
  await openChatAndSendFollowUp(page, 'how many VMs in alibaba');

  await page.evaluate(() => window.__port.emit({ type: 'status', status: 'delegating' }));
  await expect(page.locator('#omnipilot-panel .omnipilot-loading-text')).toContainText(/deleg/i);

  await page.evaluate(() => {
    window.__port.emit({ type: 'chunk', text: '5 Alibaba VMs' });
    window.__port.emit({ type: 'done' });
  });
  await page.waitForTimeout(20);

  await expect(page.locator('#omnipilot-panel .omnipilot-loading')).toHaveCount(0);
  await expect(page.locator('#omnipilot-panel .omnipilot-msg-assistant').last()).toContainText('5 Alibaba VMs');
});
