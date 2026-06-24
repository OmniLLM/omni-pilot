const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('options.js', 'utf8');
const i18nSource = fs.readFileSync('i18n.js', 'utf8');

function createElement(initialValue = '') {
  return {
    value: initialValue,
    style: {},
    className: '',
    innerHTML: '',
    textContent: '',
    options: [],
    onchange: null,
    listeners: {},
    classList: { add() {}, remove() {} },
    appendChild(child) {
      this.options.push(child);
      if (child.selected) this.value = child.value;
    },
    insertBefore(child) {
      this.options.unshift(child);
      if (child.selected) this.value = child.value;
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    }
  };
}

function createTestContext({ fetchImpl, sendMessageImpl, storageGetImpl, setTimeoutImpl } = {}) {
  const fetchUrls = [];
  const sendMessageCalls = [];
  const domListeners = {};
  const timeoutCalls = [];
  const syncWrites = [];
  const elements = {
    modelSelect: createElement(),
    model: createElement('deepseek-v4-flash'),
    models: createElement(''),
    editModelsBtn: createElement(),
    modelStatus: createElement(),
    refreshBtn: createElement(),
    apiShape: createElement('openai-compatible'),
    endpoint: createElement('http://localhost:5000'),
    apiKey: createElement('test-key'),
    saveBtn: createElement(),
    status: createElement(),
    languageSelect: createElement('en'),
    providerType: createElement('api-key'),
    authMethod: createElement('api-key'),
    apiKeyField: createElement(),
    copilotSection: createElement(),
    endpointField: createElement(),
    apiShapeField: createElement(),
    modelCard: createElement(),
    copilotStatusDot: createElement(),
    copilotStatusText: createElement(),
    copilotAuthBtn: createElement(),
    copilotDeviceFlow: createElement(),
    copilotUserCode: createElement(),
    copilotVerifyLink: createElement(),
    copilotPollStatus: createElement()
  };

  const context = {
    console,
    setTimeout(fn, delay) {
      timeoutCalls.push(delay);
      if (setTimeoutImpl) return setTimeoutImpl(fn, delay, context);
      return fn();
    },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    document: {
      documentElement: { lang: '', setAttribute() {} },
      createElement: () => createElement(),
      getElementById: id => elements[id],
      querySelectorAll: () => [],
      addEventListener(type, handler) {
        domListeners[type] = handler;
      }
    },
    globalThis: {},
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          sendMessageCalls.push(message);
          if (sendMessageImpl) return sendMessageImpl(message, callback, context);
          callback({ models: [] });
        }
      },
      storage: {
        sync: {
          get(keys, callback) {
            if (storageGetImpl) return storageGetImpl(keys, callback, context);
            callback({});
          },
          set(value, callback) { syncWrites.push(value); callback?.(); }
        },
        local: {
          get(keys, callback) {
            callback({});
          },
          set() {},
          remove() {}
        }
      },
      tabs: { create() {} }
    },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async (url, options) => {
      fetchUrls.push(String(url));
      if (fetchImpl) return fetchImpl(url, options);
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] })
      };
    }
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(i18nSource, context);
  vm.runInContext(source, context);

  return { context, elements, fetchUrls, sendMessageCalls, domListeners, timeoutCalls, syncWrites };
}

async function testStandardFetchUsesEndpointModels() {
  const { context, fetchUrls } = createTestContext();
  await context.fetchModels('http://localhost:5000', 'test-key', 'openai-compatible');
  assert.deepStrictEqual(fetchUrls, ['http://localhost:5000/v1/models']);
}

async function testGithubCopilotFetchUsesBackgroundModels() {
  const { context, elements, fetchUrls, sendMessageCalls } = createTestContext({
    sendMessageImpl(message, callback) {
      callback({ models: ['gpt-4o', 'claude-sonnet-4-5'] });
    }
  });

  await context.fetchModels('https://api.githubcopilot.com', '', 'openai-compatible', 'github-copilot');

  assert.strictEqual(sendMessageCalls.length, 1);
  assert.strictEqual(sendMessageCalls[0].type, 'GET_MODELS');
  assert.deepStrictEqual(fetchUrls, []);
  assert.strictEqual(elements.modelSelect.style.display, 'block');
  assert.strictEqual(elements.model.style.display, 'none');
  assert.deepStrictEqual(elements.modelSelect.options.map(option => option.value), ['deepseek-v4-flash', 'gpt-4o', 'claude-sonnet-4-5']);
  assert.strictEqual(elements.model.value, 'deepseek-v4-flash');
}

async function testGithubCopilotEmptyModelsFallsBackToManualInput() {
  const { context, elements, fetchUrls, sendMessageCalls } = createTestContext({
    sendMessageImpl(message, callback) {
      callback({ models: [] });
    }
  });

  await context.fetchModels('', '', 'openai-compatible', 'github-copilot');

  assert.strictEqual(sendMessageCalls.length, 1);
  assert.strictEqual(sendMessageCalls[0].type, 'GET_MODELS');
  assert.deepStrictEqual(fetchUrls, []);
  assert.strictEqual(elements.modelSelect.style.display, 'none');
  assert.strictEqual(elements.model.style.display, 'block');
  assert.strictEqual(elements.modelStatus.className, 'model-status warn');
}

async function testGetModelsFromBackgroundRejectsOnRuntimeError() {
  const { context } = createTestContext({
    sendMessageImpl(message, callback, runtimeContext) {
      runtimeContext.chrome.runtime.lastError = { message: 'boom' };
      callback(undefined);
      runtimeContext.chrome.runtime.lastError = null;
    }
  });

  await assert.rejects(
    () => context.getModelsFromBackground(),
    error => error && error.message === 'boom'
  );
}

async function testGithubCopilotUiShowsCopilotSection() {
  const { context, elements } = createTestContext();
  await context.updateAuthMethodUI('github-copilot');
  assert.strictEqual(elements.modelCard.style.display, '');
  assert.strictEqual(elements.endpointField.style.display, 'none');
  assert.strictEqual(elements.apiKeyField.style.display, 'none');
  assert.strictEqual(elements.copilotSection.style.display, '');
}

async function testGithubCopilotSignInButtonStartsDeviceFlow() {
  const { elements, domListeners, sendMessageCalls } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        authMethod: 'github-copilot',
        endpoint: '',
        apiKey: '',
        model: 'deepseek-v4-flash',
        languagePreference: 'en'
      });
    },
    sendMessageImpl(message, callback) {
      if (message.type === 'GET_MODELS') {
        callback({ models: [] });
        return;
      }
      if (message.type === 'COPILOT_START_DEVICE_FLOW') {
        callback({
          success: true,
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          deviceCode: 'device-code',
          interval: 5
        });
        return;
      }
      callback({ success: false, error: `Unexpected message ${message.type}` });
    }
  });

  await domListeners.DOMContentLoaded();
  sendMessageCalls.length = 0;

  await elements.copilotAuthBtn.onclick();

  assert.strictEqual(sendMessageCalls[0].type, 'COPILOT_START_DEVICE_FLOW');
  assert.strictEqual(elements.copilotUserCode.textContent, 'ABCD-EFGH');
  assert.strictEqual(elements.copilotVerifyLink.href, 'https://github.com/login/device');
  assert.strictEqual(elements.copilotDeviceFlow.style.display, '');
  assert.strictEqual(elements.copilotAuthBtn.style.display, 'none');
}

async function testScheduleFetchRunsForGithubCopilotWithoutEndpoint() {
  const { context, elements, sendMessageCalls, fetchUrls, timeoutCalls } = createTestContext({
    sendMessageImpl(message, callback) {
      callback({ models: ['gpt-4o'] });
    }
  });

  elements.endpoint.value = '';
  elements.apiKey.value = '';
  elements.authMethod.value = 'github-copilot';

  context.scheduleFetch();
  await Promise.resolve();

  assert.deepStrictEqual(timeoutCalls, [700]);
  assert.strictEqual(sendMessageCalls.length, 1);
  assert.strictEqual(sendMessageCalls[0].type, 'GET_MODELS');
  assert.deepStrictEqual(fetchUrls, []);
}

async function testDOMContentLoadedInitialFetchRunsForGithubCopilotWithoutEndpoint() {
  const { elements, sendMessageCalls, fetchUrls, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        authMethod: 'github-copilot',
        endpoint: '',
        apiKey: '',
        model: 'deepseek-v4-flash',
        languagePreference: 'en'
      });
    },
    sendMessageImpl(message, callback) {
      callback({ models: ['gpt-4o'] });
    }
  });

  await domListeners.DOMContentLoaded();

  assert.strictEqual(elements.authMethod.value, 'github-copilot');
  assert.strictEqual(sendMessageCalls.length, 1);
  assert.strictEqual(sendMessageCalls[0].type, 'GET_MODELS');
  assert.deepStrictEqual(fetchUrls, []);
}

async function testRefreshFetchRunsForGithubCopilotWithoutEndpoint() {
  const { elements, sendMessageCalls, fetchUrls, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        authMethod: 'github-copilot',
        endpoint: '',
        apiKey: '',
        model: 'deepseek-v4-flash',
        languagePreference: 'en'
      });
    },
    sendMessageImpl(message, callback) {
      callback({ models: ['gpt-4o'] });
    }
  });

  await domListeners.DOMContentLoaded();
  sendMessageCalls.length = 0;
  fetchUrls.length = 0;

  await elements.refreshBtn.listeners.click();
  await Promise.resolve();

  assert.strictEqual(sendMessageCalls.length, 1);
  assert.strictEqual(sendMessageCalls[0].type, 'GET_MODELS');
  assert.deepStrictEqual(fetchUrls, []);
}

async function testAuthMethodChangeListenerShowsCopilotUiAndFetchesBackgroundModels() {
  const { elements, sendMessageCalls, fetchUrls, domListeners, timeoutCalls, syncWrites } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        authMethod: 'api-key',
        endpoint: 'http://localhost:5000',
        apiKey: 'test-key',
        model: 'deepseek-v4-flash',
        languagePreference: 'en'
      });
    },
    sendMessageImpl(message, callback) {
      callback({ models: ['gpt-4o'] });
    }
  });

  await domListeners.DOMContentLoaded();
  sendMessageCalls.length = 0;
  fetchUrls.length = 0;
  timeoutCalls.length = 0;
  elements.endpoint.value = '';
  elements.apiKey.value = '';
  elements.authMethod.value = 'github-copilot';

  elements.authMethod.listeners.change({ target: { value: 'github-copilot' } });
  await Promise.resolve();

  assert.strictEqual(elements.modelCard.style.display, '');
  assert.strictEqual(elements.endpointField.style.display, 'none');
  assert.strictEqual(elements.apiKeyField.style.display, 'none');
  assert.strictEqual(elements.copilotSection.style.display, '');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(syncWrites)), [{ providerType: 'github-copilot' }]);
  assert.deepStrictEqual(timeoutCalls, [700]);
  assert.strictEqual(sendMessageCalls.length, 1);
  assert.strictEqual(sendMessageCalls[0].type, 'GET_MODELS');
  assert.deepStrictEqual(fetchUrls, []);
}

async function testInitialApiKeyFlowStillUsesPageFetchNotBackgroundMessaging() {
  const { sendMessageCalls, fetchUrls, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        authMethod: 'api-key',
        endpoint: 'http://localhost:5000',
        apiKey: 'test-key',
        model: 'deepseek-v4-flash',
        languagePreference: 'en',
        apiShape: 'openai-compatible'
      });
    }
  });

  await domListeners.DOMContentLoaded();
  await Promise.resolve();

  assert.deepStrictEqual(fetchUrls, ['http://localhost:5000/v1/models']);
  assert.deepStrictEqual(sendMessageCalls, []);
}

async function testAzureFoundryUiShowsEndpointApiKeyApiShapeAndModel() {
  const { context, elements } = createTestContext();

  context.updateProviderTypeUI('azure-foundry');

  assert.strictEqual(elements.modelCard.style.display, '');
  assert.strictEqual(elements.endpointField.style.display, '');
  assert.strictEqual(elements.apiKeyField.style.display, '');
  assert.strictEqual(elements.apiShapeField.style.display, '');
  assert.strictEqual(elements.copilotSection.style.display, 'none');
}

async function testProviderChangeSavesProviderType() {
  const { elements, domListeners, syncWrites } = createTestContext();
  await domListeners.DOMContentLoaded();

  elements.providerType.value = 'azure-foundry';
  elements.providerType.listeners.change({ target: { value: 'azure-foundry' } });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(syncWrites.at(-1))), { providerType: 'azure-foundry' });
}

async function testLegacyAuthMethodInitializesProviderType() {
  const { elements, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        authMethod: 'github-copilot',
        endpoint: '',
        apiKey: '',
        model: 'deepseek-v4-flash',
        languagePreference: 'en'
      });
    }
  });

  await domListeners.DOMContentLoaded();

  assert.strictEqual(elements.providerType.value, 'github-copilot');
}

async function testCustomProviderModelFetchFailureFallsBackToManualInput() {
  const { context, elements, fetchUrls, sendMessageCalls } = createTestContext({
    fetchImpl: async () => ({ ok: false, status: 404 })
  });

  await context.fetchModels('http://localhost:5000', 'test-key', 'openai-compatible', 'custom-provider');

  assert.deepStrictEqual(fetchUrls, ['http://localhost:5000/v1/models']);
  assert.deepStrictEqual(sendMessageCalls, []);
  assert.strictEqual(elements.modelSelect.style.display, 'none');
  assert.strictEqual(elements.model.style.display, 'block');
  assert.strictEqual(elements.modelStatus.className, 'model-status warn');
}

async function testAzureFoundryApiShapeUiRemainsVisible() {
  const { context, elements } = createTestContext();

  context.updateProviderTypeUI('azure-foundry');

  assert.strictEqual(elements.apiShapeField.style.display, '');
}

async function testAzureFoundryModelFetchUsesManualModelsOnly() {
  const { context, elements, fetchUrls, sendMessageCalls } = createTestContext({
    fetchImpl: async url => {
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  elements.models.value = 'azure-gpt-4o, azure-phi-4\nazure-mai-ds-r1';
  await context.fetchModels('https://example.services.ai.azure.com', 'azure-key', 'openai-compatible', 'azure-foundry');

  assert.deepStrictEqual(fetchUrls, []);
  assert.deepStrictEqual(sendMessageCalls, []);
  assert.strictEqual(elements.modelSelect.style.display, 'block');
  assert.strictEqual(elements.model.style.display, 'none');
  assert.strictEqual(elements.models.style.display, 'none');
  assert.deepStrictEqual(elements.modelSelect.options.map(option => option.value), [
    'deepseek-v4-flash',
    'azure-gpt-4o',
    'azure-phi-4',
    'azure-mai-ds-r1'
  ]);
}

async function testAzureFoundryEditModelsButtonReopensManualInput() {
  const { context, elements, domListeners } = createTestContext();
  await domListeners.DOMContentLoaded();

  elements.providerType.value = 'azure-foundry';
  elements.models.value = 'gpt-5.4, gpt-4.1';
  await context.fetchModels('https://example.services.ai.azure.com', 'azure-key', 'openai-compatible', 'azure-foundry');

  assert.strictEqual(elements.models.style.display, 'none');
  assert.strictEqual(elements.editModelsBtn.style.display, '');

  elements.editModelsBtn.listeners.click();

  assert.strictEqual(elements.models.style.display, 'block');
  assert.strictEqual(elements.modelSelect.style.display, 'none');
  assert.strictEqual(elements.model.style.display, 'none');
}

async function testSaveWritesProviderTypeAndNotLegacyAuthMethod() {
  const { elements, domListeners, syncWrites } = createTestContext();
  await domListeners.DOMContentLoaded();

  elements.providerType.value = 'azure-foundry';
  await elements.saveBtn.listeners.click();

  const saved = syncWrites.at(-1);
  assert.strictEqual(saved.providerType, 'azure-foundry');
  assert.ok(!Object.prototype.hasOwnProperty.call(saved, 'authMethod'));
}

async function main() {
  await testStandardFetchUsesEndpointModels();
  await testGithubCopilotFetchUsesBackgroundModels();
  await testGithubCopilotEmptyModelsFallsBackToManualInput();
  await testGetModelsFromBackgroundRejectsOnRuntimeError();
  await testGithubCopilotUiShowsCopilotSection();
  await testGithubCopilotSignInButtonStartsDeviceFlow();
  await testScheduleFetchRunsForGithubCopilotWithoutEndpoint();
  await testDOMContentLoadedInitialFetchRunsForGithubCopilotWithoutEndpoint();
  await testRefreshFetchRunsForGithubCopilotWithoutEndpoint();
  await testAuthMethodChangeListenerShowsCopilotUiAndFetchesBackgroundModels();
  await testInitialApiKeyFlowStillUsesPageFetchNotBackgroundMessaging();
  await testAzureFoundryUiShowsEndpointApiKeyApiShapeAndModel();
  await testProviderChangeSavesProviderType();
  await testLegacyAuthMethodInitializesProviderType();
  await testCustomProviderModelFetchFailureFallsBackToManualInput();
  await testAzureFoundryApiShapeUiRemainsVisible();
  await testAzureFoundryModelFetchUsesManualModelsOnly();
  await testAzureFoundryEditModelsButtonReopensManualInput();
  await testSaveWritesProviderTypeAndNotLegacyAuthMethod();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
