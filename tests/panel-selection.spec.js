const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'content.js'), 'utf8');
const i18nSource = fs.readFileSync(path.resolve(__dirname, '..', 'i18n.js'), 'utf8');
const stylesSource = fs.readFileSync(path.resolve(__dirname, '..', 'styles.css'), 'utf8');

async function setupPage(page) {
  await page.goto('about:blank');
  await page.setContent(`<!DOCTYPE html><html><head><style>${stylesSource}</style></head>` +
    `<body style="padding:40px">` +
    `<p id="para">Bonjour le monde ceci est un texte de test a traduire.</p>` +
    `<p id="p2">Comment allez vous aujourd hui mon ami.</p>` +
    `<div id="blank" style="height:400px"></div>` +
    `</body></html>`);
  await page.evaluate(({ i18nSource, contentSource }) => {
    window.__msgs = [];
    window.chrome = {
      runtime: {
        lastError: null,
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
    window.eval(i18nSource);
    // eslint-disable-next-line no-eval
    window.eval(contentSource);
  }, { i18nSource, contentSource });
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

test('BUG2: picking Translate from the header re-runs the action', async ({ page }) => {
  await setupPage(page);
  await openTranslatePanel(page);
  expect(await page.evaluate(() => window.__msgs.filter(m => m.type === 'AI_ACTION').length)).toBe(1);

  // User clicks a blank area of the page — this clears lastSelection via the mouseup handler.
  await page.mouse.click(50, 500);
  await page.waitForTimeout(40);

  // Open header action selector and pick "Translate" (index 1; chat is index 0).
  await page.locator('#omnipilot-panel .omnipilot-meta-action-wrap').click();
  await page.waitForTimeout(20);
  await page.locator('#omnipilot-action-selector .omnipilot-model-item').nth(1).click();
  await page.waitForTimeout(60);

  // A new translate request must have been sent — not a silent no-op.
  const actionMsgs = await page.evaluate(() => window.__msgs.filter(m => m.type === 'AI_ACTION'));
  expect(actionMsgs.length).toBe(2);
  expect(actionMsgs[1].action).toBe('translate');

  // And the translation result must actually render in the panel.
  const body = await page.locator('#omnipilot-panel .omnipilot-panel-body').innerHTML();
  expect(body).toContain('ACTION:translate');
});
