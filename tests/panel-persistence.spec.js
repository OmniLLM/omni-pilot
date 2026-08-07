const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'content.js'), 'utf8');
const stylesSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'styles.css'), 'utf8');

// A real HTTP origin is required: sessionStorage is unavailable on about:blank,
// and page.reload() only re-runs a document served over the network.
function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><head><style>${stylesSource}</style></head>` +
      `<body style="padding:40px"><p id="para">Bonjour le monde ceci est un texte de test.</p></body></html>`);
  });
  return new Promise(resolve => server.listen(0, () => resolve(server)));
}

// The content script normally runs at document_idle on every load, including
// after a refresh; re-inject it manually to model that.
async function injectContentScript(page) {
  await page.evaluate(({ contentSource }) => {
    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        connect() {
          const listeners = [];
          return {
            onMessage: { addListener(fn) { listeners.push(fn); } },
            onDisconnect: { addListener() {} },
            postMessage() {
              setTimeout(() => {
                listeners.forEach(fn => { fn({ type: 'chunk', text: 'Hello world' }); fn({ type: 'done' }); });
              }, 0);
            },
            disconnect() {}
          };
        },
        sendMessage(message, callback) { callback({ success: true, result: 'ok' }); },
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

async function openTranslatePanel(page) {
  await page.evaluate(() => {
    const node = document.querySelector('#para');
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 50, clientY: 50 }));
  });
  await page.waitForTimeout(60);
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  await page.waitForTimeout(300);
}

let server;
let baseUrl;

test.beforeAll(async () => {
  server = await startServer();
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

test.afterAll(() => server.close());

test('open panel is restored after a page refresh', async ({ page }) => {
  await page.goto(baseUrl);
  await injectContentScript(page);
  await openTranslatePanel(page);
  await expect(page.locator('#omnipilot-panel')).toBeVisible();

  await page.reload();
  await injectContentScript(page);

  await expect(page.locator('#omnipilot-panel')).toBeVisible();
  await expect(page.locator('#omnipilot-panel .omnipilot-selected-context')).toBeVisible();
});

test('minimized panel is restored as the floating orb after a refresh', async ({ page }) => {
  await page.goto(baseUrl);
  await injectContentScript(page);
  await openTranslatePanel(page);
  await page.locator('#omnipilot-panel .omnipilot-minimize-btn').click();
  await page.waitForTimeout(100);

  await page.reload();
  await injectContentScript(page);

  await expect(page.locator('#omnipilot-minimized-orb')).toBeVisible();
  await expect(page.locator('#omnipilot-panel')).toBeHidden();

  await page.locator('#omnipilot-minimized-orb').click();
  await expect(page.locator('#omnipilot-panel')).toBeVisible();
});

test('explicitly closing the panel clears the saved session', async ({ page }) => {
  await page.goto(baseUrl);
  await injectContentScript(page);
  await openTranslatePanel(page);
  await page.locator('#omnipilot-panel .omnipilot-close-btn').click();

  await page.reload();
  await injectContentScript(page);
  await page.waitForTimeout(300);

  await expect(page.locator('#omnipilot-panel')).toHaveCount(0);
  await expect(page.locator('#omnipilot-minimized-orb')).toHaveCount(0);
});
