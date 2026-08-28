// End-to-end coverage for the popup.
//
// Written against the CURRENT implementation, deliberately, so it can act as
// the regression oracle when the popup is converted to a component model. If
// any assertion here needs editing during that conversion, behavior drifted
// and the code is wrong — not the test.
//
// Complements tests/popup-visual-parity.spec.js, which pins computed styles.
// This file pins behavior: readiness, persistence, and localization.
const { test, expect } = require('@playwright/test');
const path = require('path');

const POPUP_URL = 'file:///' + path.resolve(__dirname, '..', 'dist', 'popup.html').replace(/\\/g, '/');

const READY = 'Ready';
const NOT_SET = 'API key not set';

// Installs a scripted chrome.* stub before the bundle runs. `stored` seeds
// sync storage; every write and every registered change-listener is captured
// so tests can assert on persistence and drive external updates.
async function open(page, stored = {}) {
  await page.addInitScript(seed => {
    const store = { ...seed };
    const writes = [];
    const changeListeners = [];
    window.__writes = writes;
    window.__store = store;
    window.__openedOptions = 0;
    window.__fireChange = (changes, area = 'sync') => {
      Object.entries(changes).forEach(([key, value]) => { store[key] = value.newValue; });
      changeListeners.slice().forEach(fn => fn(changes, area));
    };

    window.chrome = {
      runtime: {
        openOptionsPage() { window.__openedOptions += 1; },
        connect() {
          return {
            onMessage: { addListener() {} },
            onDisconnect: { addListener() {} },
            postMessage() {},
            disconnect() {}
          };
        }
      },
      storage: {
        sync: {
          get(defaults, callback) {
            const result = {};
            Object.keys(defaults).forEach(key => {
              result[key] = key in store ? store[key] : defaults[key];
            });
            callback(result);
          },
          set(values, callback = () => {}) {
            writes.push(values);
            Object.assign(store, values);
            callback();
          }
        },
        local: {
          get(_keys, callback) { callback({}); },
          set(_values, callback = () => {}) { callback(); }
        },
        onChanged: {
          addListener(fn) { changeListeners.push(fn); },
          removeListener(fn) {
            const index = changeListeners.indexOf(fn);
            if (index >= 0) changeListeners.splice(index, 1);
          }
        }
      }
    };
  }, stored);

  await page.goto(POPUP_URL);
}

const writes = page => page.evaluate(() => window.__writes);

// ── Readiness ────────────────────────────────────────────────────────────

test('an unconfigured provider reports that no API key is set', async ({ page }) => {
  await open(page, {});

  await expect(page.locator('#statusText')).toHaveText(NOT_SET);
  await expect(page.locator('#statusDot')).not.toHaveClass(/\bok\b/);
});

for (const [label, stored] of [
  ['an API key is present', { apiKey: 'sk-test' }],
  ['the provider is GitHub Copilot', { providerType: 'github-copilot' }],
  ['the auth method is GitHub Copilot', { authMethod: 'github-copilot' }]
]) {
  test(`the popup reports ready when ${label}`, async ({ page }) => {
    await open(page, stored);

    await expect(page.locator('#statusText')).toHaveText(READY);
    await expect(page.locator('#statusDot')).toHaveClass(/\bok\b/);
  });
}

test('the status dot colour changes between states', async ({ page }) => {
  await open(page, {});
  const notReady = await page.evaluate(
    () => getComputedStyle(document.getElementById('statusDot')).backgroundColor
  );

  await open(page, { apiKey: 'sk-test' });
  const ready = await page.evaluate(
    () => getComputedStyle(document.getElementById('statusDot')).backgroundColor
  );

  expect(notReady).not.toBe(ready);
});

// ── Preferences are reflected and persisted ──────────────────────────────

test('stored preferences are reflected in the controls', async ({ page }) => {
  await open(page, {
    themePreference: 'light',
    visualStylePreference: 'terminal',
    languagePreference: 'zh'
  });

  await expect(page.locator('#themePreferenceSelect')).toHaveValue('light');
  await expect(page.locator('#visualStylePreferenceSelect')).toHaveValue('terminal');
  await expect(page.locator('#languageSelect')).toHaveValue('zh');
});

test('changing the colour theme persists it and applies it live', async ({ page }) => {
  await open(page, { themePreference: 'dark' });
  await page.selectOption('#themePreferenceSelect', 'light');

  expect(await writes(page)).toContainEqual({ themePreference: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
});

test('changing the visual style persists it and applies it live', async ({ page }) => {
  await open(page, {});
  await page.selectOption('#visualStylePreferenceSelect', 'neo-brutalist');

  expect(await writes(page)).toContainEqual({ visualStylePreference: 'neo-brutalist' });
  await expect(page.locator('html')).toHaveAttribute('data-visual-style', 'neo-brutalist');
});

test('changing the language persists it and re-labels the UI', async ({ page }) => {
  await open(page, { apiKey: 'sk-test' });
  await expect(page.locator('#statusText')).toHaveText(READY);

  await page.selectOption('#languageSelect', 'zh');

  expect(await writes(page)).toContainEqual({ languagePreference: 'zh' });
  await expect(page.locator('#statusText')).toHaveText('就绪');
  await expect(page.locator('#settingsLabel')).toHaveText('设置');
  await expect(page.locator('#appearanceLabel')).toHaveText('外观');
  await expect(page.locator('#desc')).toHaveText('在任意页面选择文本即可使用 AI 操作。');
  await expect(page.locator('#languageLabel')).toHaveText('语言');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
});

test('a theme preference resolves to a concrete theme attribute', async ({ page }) => {
  await open(page, { themePreference: 'dark' });
  await page.selectOption('#themePreferenceSelect', 'light');

  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('an appearance change made elsewhere updates the controls', async ({ page }) => {
  await open(page, {});

  await page.evaluate(() => window.__fireChange({
    visualStylePreference: { newValue: 'warm-editorial' }
  }));

  await expect(page.locator('#visualStylePreferenceSelect')).toHaveValue('warm-editorial');
  await expect(page.locator('html')).toHaveAttribute('data-visual-style', 'warm-editorial');
});

test('an unknown stored language falls back to the default', async ({ page }) => {
  await open(page, { languagePreference: 'klingon' });

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#settingsLabel')).toHaveText('Settings');
});

// ── External changes ─────────────────────────────────────────────────────

test('an API key saved elsewhere flips the status to ready', async ({ page }) => {
  await open(page, {});
  await expect(page.locator('#statusText')).toHaveText(NOT_SET);

  await page.evaluate(() => window.__fireChange({ apiKey: { newValue: 'sk-test' } }));

  await expect(page.locator('#statusText')).toHaveText(READY);
  await expect(page.locator('#statusDot')).toHaveClass(/\bok\b/);
});

test('clearing the API key elsewhere flips the status back', async ({ page }) => {
  await open(page, { apiKey: 'sk-test' });
  await expect(page.locator('#statusText')).toHaveText(READY);

  await page.evaluate(() => window.__fireChange({ apiKey: { newValue: '' } }));

  await expect(page.locator('#statusText')).toHaveText(NOT_SET);
  await expect(page.locator('#statusDot')).not.toHaveClass(/\bok\b/);
});

test('a language changed elsewhere re-labels the UI', async ({ page }) => {
  await open(page, {});

  await page.evaluate(() => window.__fireChange({ languagePreference: { newValue: 'zh' } }));

  await expect(page.locator('#settingsLabel')).toHaveText('设置');
  await expect(page.locator('#languageSelect')).toHaveValue('zh');
});

test('changes from other storage areas are ignored', async ({ page }) => {
  await open(page, {});

  await page.evaluate(() => window.__fireChange({ apiKey: { newValue: 'sk-test' } }, 'local'));

  await expect(page.locator('#statusText')).toHaveText(NOT_SET);
});

// ── Navigation ───────────────────────────────────────────────────────────

test('the settings button opens the options page', async ({ page }) => {
  await open(page, {});
  await page.click('#settingsBtn');

  expect(await page.evaluate(() => window.__openedOptions)).toBe(1);
});

test('the header links to the project repository', async ({ page }) => {
  await open(page, {});

  await expect(page.locator('.header-left')).toHaveAttribute(
    'href',
    'https://github.com/OmniLLM/omni-pilot'
  );
});
