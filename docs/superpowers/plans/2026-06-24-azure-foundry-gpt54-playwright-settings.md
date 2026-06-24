# Azure Foundry GPT-5.4 and Settings Playwright Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Azure Foundry `gpt-5.4` chat-completions requests to use `max_completion_tokens`, and add Playwright coverage for the settings page fields and provider-specific UI behavior.

**Architecture:** Keep request-shape selection in `background.js` and add one focused helper for the OpenAI-compatible token limit field. Add page-level Playwright tests that load `options.html` directly, inject mocked extension APIs before page scripts run, and assert DOM/storage behavior without a real extension runtime.

**Tech Stack:** Plain JavaScript, Chrome extension MV3 APIs mocked in tests, Node `assert`/`vm` unit tests, Playwright Chromium.

---

## File Structure

- Modify `background.js`: add a helper that builds OpenAI chat-completions token params, and use it only for OpenAI-compatible chat-completions request bodies.
- Modify `background.test.js`: add tests for Azure Foundry `gpt-5.4` using `max_completion_tokens`, and for non-target models/providers keeping `max_tokens`.
- Create `package.json`: define Node and Playwright test scripts and dev dependencies.
- Create `playwright.config.js`: configure local page-level Playwright tests.
- Create `tests/settings-page.spec.js`: mock `chrome.*`, load `options.html`, and test all settings fields/provider behaviors.
- Modify `.gitignore`: stop ignoring `package.json` and `package-lock.json` so Playwright setup is reproducible.

---

### Task 1: Add targeted Azure Foundry `gpt-5.4` request-body behavior

**Files:**
- Modify: `background.js`
- Modify: `background.test.js`

- [ ] **Step 1: Add failing tests in `background.test.js`**

Add these functions after `assertAzureFoundryRequestUsesSelectedApiShape()`:

```js
async function assertAzureFoundryGpt54UsesMaxCompletionTokens() {
  const { request } = await runActionTest({
    config: {
      providerType: 'azure-foundry',
      endpoint: 'https://example.services.ai.azure.com',
      apiKey: 'azure-secret',
      apiShape: 'openai-compatible',
      model: 'gpt-5.4'
    },
    responseJson: RESPONSE_BY_SHAPE['openai-compatible']
  });

  const body = JSON.parse(request.options.body);
  assert.strictEqual(request.url, 'https://example.services.ai.azure.com/v1/chat/completions');
  assert.strictEqual(body.model, 'gpt-5.4');
  assert.strictEqual(body.max_completion_tokens, 1024);
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'max_tokens'));
}

async function assertAzureFoundryOtherGptModelsKeepMaxTokens() {
  const { request } = await runActionTest({
    config: {
      providerType: 'azure-foundry',
      endpoint: 'https://example.services.ai.azure.com',
      apiKey: 'azure-secret',
      apiShape: 'openai-compatible',
      model: 'gpt-4.1'
    },
    responseJson: RESPONSE_BY_SHAPE['openai-compatible']
  });

  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.max_tokens, 1024);
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'max_completion_tokens'));
}

async function assertCustomProviderGpt54KeepsMaxTokens() {
  const { request } = await runActionTest({
    config: {
      providerType: 'custom-provider',
      endpoint: 'http://localhost:5000',
      apiKey: 'custom-secret',
      apiShape: 'openai-compatible',
      model: 'gpt-5.4'
    },
    responseJson: RESPONSE_BY_SHAPE['openai-compatible']
  });

  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.max_tokens, 1024);
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'max_completion_tokens'));
}
```

Add these calls in `main()` immediately after `assertAzureFoundryRequestUsesSelectedApiShape()`:

```js
  await assertAzureFoundryGpt54UsesMaxCompletionTokens();
  await assertAzureFoundryOtherGptModelsKeepMaxTokens();
  await assertCustomProviderGpt54KeepsMaxTokens();
```

- [ ] **Step 2: Run the failing background tests**

Run: `node background.test.js`

Expected: FAIL because Azure Foundry `gpt-5.4` still sends `max_tokens` and does not send `max_completion_tokens`.

- [ ] **Step 3: Implement the helper in `background.js`**

Add this helper after `createAuthHeaders()`:

```js
function getOpenAIChatTokenLimitParams(config) {
  const isAzureFoundryGpt54 = normalizeProviderType(config.providerType, config.authMethod) === PROVIDER_TYPES.AZURE_FOUNDRY
    && config.model === 'gpt-5.4';

  return isAzureFoundryGpt54
    ? { max_completion_tokens: 1024 }
    : { max_tokens: 1024 };
}
```

In both OpenAI-compatible chat-completions request bodies in `buildApiRequest()`, replace the literal `max_tokens: 1024` line with:

```js
        ...getOpenAIChatTokenLimitParams(config),
```

Do not change Anthropic Messages, OpenAI Responses, or GitHub Copilot request bodies.

- [ ] **Step 4: Run background tests**

Run: `node background.test.js`

Expected: PASS.

---

### Task 2: Add Playwright project setup

**Files:**
- Create: `package.json`
- Create: `playwright.config.js`
- Modify: `.gitignore`

- [ ] **Step 1: Make package files trackable**

Edit `.gitignore` so it contains:

```gitignore
node_modules/
gen_icons.py
test_extension.js
*.log
.DS_Store
.serena/
```

- [ ] **Step 2: Create `package.json`**

Create `package.json` with:

```json
{
  "name": "omni-pilot",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "test": "node background.test.js && node options.test.js && node popup.test.js && node i18n.test.js && node content-language.test.js && node options-language.test.js && npx playwright test",
    "test:unit": "node background.test.js && node options.test.js && node popup.test.js && node i18n.test.js && node content-language.test.js && node options-language.test.js",
    "test:playwright": "npx playwright test"
  },
  "devDependencies": {
    "@playwright/test": "latest"
  }
}
```

- [ ] **Step 3: Create `playwright.config.js`**

Create `playwright.config.js` with:

```js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true
  }
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`

Expected: creates `node_modules/` and `package-lock.json`.

- [ ] **Step 5: Install Chromium for Playwright**

Run: `npx playwright install chromium`

Expected: Chromium browser is installed or already present.

---

### Task 3: Add Playwright settings page coverage

**Files:**
- Create: `tests/settings-page.spec.js`

- [ ] **Step 1: Create the settings-page test harness**

Create `tests/settings-page.spec.js` with:

```js
const { test, expect } = require('@playwright/test');
const path = require('path');

const optionsUrl = `file://${path.resolve(__dirname, '..', 'options.html').replace(/\\/g, '/')}`;

async function openOptionsPage(page, { syncStorage = {}, localStorage = {}, modelResponse = ['gpt-4.1', 'gpt-5.4'] } = {}) {
  await page.addInitScript(({ syncStorage, localStorage, modelResponse }) => {
    const syncStore = { ...syncStorage };
    const localStore = { ...localStorage };
    const writes = [];
    const messages = [];
    const tabs = [];

    function makeArea(store) {
      return {
        get(keys, callback) {
          if (Array.isArray(keys)) {
            callback(Object.fromEntries(keys.map(key => [key, store[key]])));
            return;
          }
          if (keys && typeof keys === 'object') {
            const result = { ...keys };
            for (const key of Object.keys(keys)) {
              if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
            }
            callback(result);
            return;
          }
          callback({ ...store });
        },
        set(values, callback) {
          Object.assign(store, values);
          writes.push(values);
          callback?.();
        },
        remove(keys, callback) {
          for (const key of [].concat(keys)) delete store[key];
          callback?.();
        }
      };
    }

    window.__omniPilotTestState = { syncStore, localStore, writes, messages, tabs };
    window.chrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          messages.push(message);
          if (message.type === 'GET_MODELS') {
            callback({ models: modelResponse });
            return;
          }
          if (message.type === 'COPILOT_START_DEVICE_FLOW') {
            callback({
              success: true,
              userCode: 'ABCD-EFGH',
              verificationUri: 'https://github.com/login/device',
              deviceCode: 'device-code'
            });
            return;
          }
          if (message.type === 'COPILOT_CLEAR_AUTH') {
            callback({ success: true });
            return;
          }
          callback({ status: 'pending' });
        }
      },
      storage: {
        sync: makeArea(syncStore),
        local: makeArea(localStore)
      },
      tabs: {
        create(details) {
          tabs.push(details);
        }
      }
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => {} },
      configurable: true
    });
  }, { syncStorage, localStorage, modelResponse });

  await page.goto(optionsUrl);
  await page.waitForLoadState('domcontentloaded');
}

test('loads saved custom-provider settings into every field and saves edits', async ({ page }) => {
  await openOptionsPage(page, {
    syncStorage: {
      providerType: 'custom-provider',
      endpoint: 'http://localhost:5000',
      apiKey: 'stored-key',
      apiShape: 'openai-compatible',
      model: 'stored-model',
      models: 'stored-model, other-model',
      languagePreference: 'en'
    }
  });

  await expect(page.locator('#providerType')).toHaveValue('custom-provider');
  await expect(page.locator('#endpoint')).toHaveValue('http://localhost:5000');
  await expect(page.locator('#apiKey')).toHaveValue('stored-key');
  await expect(page.locator('#apiShape')).toHaveValue('openai-compatible');
  await expect(page.locator('#model')).toHaveValue('stored-model');
  await expect(page.locator('#languageSelect')).toHaveValue('en');
  await expect(page.locator('#endpointField')).toBeVisible();
  await expect(page.locator('#apiKeyField')).toBeVisible();
  await expect(page.locator('#apiShapeField')).toBeVisible();

  await page.locator('#endpoint').fill('https://api.example.com/v1');
  await page.locator('#apiKey').fill('new-key');
  await page.locator('#apiShape').selectOption('anthropic-messages');
  await page.locator('#model').fill('new-model');
  await page.locator('#languageSelect').selectOption('zh');
  await page.locator('#saveBtn').click();

  const lastWrite = await page.evaluate(() => window.__omniPilotTestState.writes.at(-1));
  expect(lastWrite).toMatchObject({
    providerType: 'custom-provider',
    endpoint: 'https://api.example.com/v1',
    apiKey: 'new-key',
    apiShape: 'anthropic-messages',
    model: 'new-model',
    languagePreference: 'zh'
  });
  expect(lastWrite).not.toHaveProperty('authMethod');
});

test('switches provider-specific settings UI for GitHub Copilot, Custom Provider, and Azure Foundry', async ({ page }) => {
  await openOptionsPage(page, {
    syncStorage: {
      providerType: 'custom-provider',
      endpoint: 'http://localhost:5000',
      apiKey: 'stored-key',
      model: 'stored-model'
    }
  });

  await page.locator('#providerType').selectOption('github-copilot');
  await expect(page.locator('#endpointField')).toBeHidden();
  await expect(page.locator('#apiKeyField')).toBeHidden();
  await expect(page.locator('#apiShapeField')).toBeHidden();
  await expect(page.locator('#copilotSection')).toBeVisible();

  await page.locator('#providerType').selectOption('custom-provider');
  await expect(page.locator('#endpointField')).toBeVisible();
  await expect(page.locator('#apiKeyField')).toBeVisible();
  await expect(page.locator('#apiShapeField')).toBeVisible();
  await expect(page.locator('#copilotSection')).toBeHidden();

  await page.locator('#providerType').selectOption('azure-foundry');
  await expect(page.locator('#endpointField')).toBeVisible();
  await expect(page.locator('#apiKeyField')).toBeVisible();
  await expect(page.locator('#apiShapeField')).toBeVisible();
  await expect(page.locator('#copilotSection')).toBeHidden();
  await expect(page.locator('#models')).toBeVisible();
  await expect(page.locator('#model')).toBeHidden();
});

test('uses manual model list for Azure Foundry and persists selected gpt-5.4', async ({ page }) => {
  await openOptionsPage(page, {
    syncStorage: {
      providerType: 'azure-foundry',
      endpoint: 'https://example.services.ai.azure.com',
      apiKey: 'azure-key',
      apiShape: 'openai-compatible',
      model: 'gpt-5.4',
      models: 'gpt-5.4, gpt-4.1'
    }
  });

  await expect(page.locator('#providerType')).toHaveValue('azure-foundry');
  await page.locator('#refreshBtn').click();
  await expect(page.locator('#modelSelect')).toBeVisible();
  await expect(page.locator('#models')).toBeHidden();
  await expect(page.locator('#editModelsBtn')).toBeVisible();
  await expect(page.locator('#modelSelect')).toHaveValue('gpt-5.4');

  await page.locator('#modelSelect').selectOption('gpt-4.1');
  await expect(page.locator('#model')).toHaveValue('gpt-4.1');
  await page.locator('#editModelsBtn').click();
  await expect(page.locator('#models')).toBeVisible();

  await page.locator('#models').fill('gpt-5.4\ngpt-4.1');
  await page.locator('#model').evaluate(element => { element.value = 'gpt-5.4'; });
  await page.locator('#saveBtn').click();

  const lastWrite = await page.evaluate(() => window.__omniPilotTestState.writes.at(-1));
  expect(lastWrite).toMatchObject({
    providerType: 'azure-foundry',
    model: 'gpt-5.4',
    models: 'gpt-5.4\ngpt-4.1'
  });
});

test('refreshes GitHub Copilot models through background messaging and starts sign-in flow', async ({ page }) => {
  await openOptionsPage(page, {
    syncStorage: {
      providerType: 'github-copilot',
      model: 'gpt-5.4',
      languagePreference: 'en'
    },
    modelResponse: ['gpt-4.1', 'gpt-5.4']
  });

  await page.locator('#refreshBtn').click();
  await expect(page.locator('#modelSelect')).toBeVisible();
  await expect(page.locator('#modelSelect')).toHaveValue('gpt-5.4');

  const messagesAfterRefresh = await page.evaluate(() => window.__omniPilotTestState.messages.map(message => message.type));
  expect(messagesAfterRefresh).toContain('GET_MODELS');

  await page.locator('#copilotAuthBtn').click();
  await expect(page.locator('#copilotUserCode')).toHaveText('ABCD-EFGH');
  await expect(page.locator('#copilotDeviceFlow')).toBeVisible();
  await expect(page.locator('#copilotAuthBtn')).toBeHidden();

  const state = await page.evaluate(() => window.__omniPilotTestState);
  expect(state.messages.map(message => message.type)).toContain('COPILOT_START_DEVICE_FLOW');
  expect(state.tabs).toEqual([{ url: 'https://github.com/login/device' }]);
});
```

- [ ] **Step 2: Run Playwright tests**

Run: `npx playwright test`

Expected: PASS.

---

### Task 4: Run full verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run unit tests**

Run: `npm run test:unit`

Expected: all Node unit tests pass.

- [ ] **Step 2: Run Playwright tests**

Run: `npm run test:playwright`

Expected: all Playwright settings tests pass.

- [ ] **Step 3: Run combined test script**

Run: `npm test`

Expected: unit tests and Playwright tests pass.

- [ ] **Step 4: Inspect git diff**

Run: `git diff -- background.js background.test.js .gitignore package.json playwright.config.js tests/settings-page.spec.js`

Expected: diff only contains the targeted Azure Foundry token-param fix and Playwright settings tests/setup.

---

## Self-Review Notes

- Spec coverage: Task 1 covers the GitHub issue fix for Azure Foundry `gpt-5.4`; Tasks 2-3 add Playwright settings-page coverage across all fields and provider-specific UI; Task 4 verifies the work.
- Placeholder scan: no placeholder implementation steps remain.
- Type/property consistency: `providerType`, `apiShape`, `max_completion_tokens`, `max_tokens`, and DOM IDs match the current codebase.
