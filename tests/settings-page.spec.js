const { test, expect } = require('@playwright/test');
const path = require('path');

const optionsUrl = `file://${path.resolve(__dirname, '..', 'dist', 'options.html').replace(/\\/g, '/')}`;

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
    window.fetch = async () => ({
      ok: true,
      json: async () => ({ data: modelResponse.map(id => ({ id })) })
    });
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
  await expect(page.locator('#modelSelect')).toBeVisible();
  await expect(page.locator('#model')).toHaveValue('stored-model');
  await expect(page.locator('#languageSelect')).toHaveValue('en');
  await expect(page.locator('#endpointField')).toBeVisible();
  await expect(page.locator('#apiKeyField')).toBeVisible();
  await expect(page.locator('#apiShapeField')).toBeVisible();

  await page.locator('#endpoint').fill('https://api.example.com/v1');
  await page.locator('#apiKey').fill('new-key');
  await page.locator('#apiShape').selectOption('anthropic-messages');
  await page.locator('#modelSelect').selectOption('gpt-5.4');
  await expect(page.locator('#model')).toHaveValue('gpt-5.4');
  await page.locator('#languageSelect').selectOption('zh');
  await page.locator('#saveBtn').click();

  const lastWrite = await page.evaluate(() => window.__omniPilotTestState.writes.at(-1));
  expect(lastWrite).toMatchObject({
    providerType: 'custom-provider',
    endpoint: 'https://api.example.com/v1',
    apiKey: 'new-key',
    apiShape: 'anthropic-messages',
    model: 'gpt-5.4',
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
