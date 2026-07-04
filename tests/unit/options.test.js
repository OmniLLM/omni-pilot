const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('dist/options.js', 'utf8');
const htmlSource = fs.readFileSync('dist/options.html', 'utf8');

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

function createTestContext({ fetchImpl, sendMessageImpl, storageGetImpl, localStorageGetImpl, setTimeoutImpl, setIntervalImpl } = {}) {
  const fetchUrls = [];
  const sendMessageCalls = [];
  const domListeners = {};
  const timeoutCalls = [];
  const syncWrites = [];
  const syncRemoves = [];
  const localWrites = [];
  const localRemoves = [];
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
    providerType: createElement('custom-provider'),
    authMethod: createElement('custom-provider'),
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
    copilotPollStatus: createElement(),
    a2aServerName: createElement('Demo Server'),
    a2aServerEndpoint: createElement('https://a2a.example.com'),
    a2aServerToken: createElement('secret-token'),
    a2aEndpoint: createElement('https://a2a.example.com'),
    a2aToken: createElement('secret-token'),
    popupInitialWidth: createElement('720'),
    popupInitialHeight: createElement('360'),
    addA2aServerBtn: createElement(),
    a2aStatus: createElement(),
    a2aServerList: createElement()
  };

  const context = {
    console,
    URL,
    setTimeout(fn, delay) {
      timeoutCalls.push(delay);
      if (setTimeoutImpl) return setTimeoutImpl(fn, delay, context);
      return fn();
    },
    clearTimeout() {},
    setInterval(fn, delay) {
      if (setIntervalImpl) return setIntervalImpl(fn, delay, context);
      return 1;
    },
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
          set(value, callback) { syncWrites.push(value); callback?.(); },
          remove(value, callback) { syncRemoves.push(value); callback?.(); }
        },
        local: {
          get(keys, callback) {
            if (localStorageGetImpl) return localStorageGetImpl(keys, callback, context);
            callback({});
          },
          set(value, callback) { localWrites.push(value); callback?.(); },
          remove(value, callback) { localRemoves.push(value); callback?.(); }
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
  vm.runInContext(source, context);

  return { context, elements, fetchUrls, sendMessageCalls, domListeners, timeoutCalls, syncWrites, syncRemoves, localWrites, localRemoves };
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
  await Promise.resolve();
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
  elements.providerType.value = 'github-copilot';

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
  assert.deepStrictEqual(JSON.parse(JSON.stringify(syncWrites)), [{
    providerType: 'github-copilot',
    providerConfigs: {
      'custom-provider': {
        endpoint: 'https://api.omnillm.com/v1',
        apiKey: '',
        model: 'deepseek-v4-flash',
        models: 'deepseek-v4-flash',
        apiShape: 'openai-compatible'
      }
    }
  }]);
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

  assert.strictEqual(syncWrites.at(-1).providerType, 'azure-foundry');
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

async function testProviderChangeLoadsProviderSpecificConfig() {
  const { elements, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        providerType: 'custom-provider',
        endpoint: 'https://custom.example/v1',
        apiKey: 'custom-key',
        model: 'custom-model',
        models: 'custom-model, custom-alt',
        apiShape: 'anthropic-messages',
        languagePreference: 'en',
        providerConfigs: {
          'custom-provider': {
            endpoint: 'https://custom.example/v1',
            apiKey: 'custom-key',
            model: 'custom-model',
            models: 'custom-model, custom-alt',
            apiShape: 'anthropic-messages'
          },
          'azure-foundry': {
            endpoint: 'https://azure.example.services.ai.azure.com',
            apiKey: 'azure-key',
            model: 'azure-model',
            models: 'azure-model, azure-alt',
            apiShape: 'openai-responses'
          }
        }
      });
    }
  });

  await domListeners.DOMContentLoaded();

  elements.providerType.value = 'azure-foundry';
  elements.providerType.listeners.change({ target: { value: 'azure-foundry' } });

  assert.strictEqual(elements.endpoint.value, 'https://azure.example.services.ai.azure.com');
  assert.strictEqual(elements.apiKey.value, 'azure-key');
  assert.strictEqual(elements.model.value, 'azure-model');
  assert.strictEqual(elements.models.value, 'azure-model, azure-alt');
  assert.strictEqual(elements.apiShape.value, 'openai-responses');
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

async function testSaveWritesPopupInitialSize() {
  const { elements, domListeners, syncWrites } = createTestContext();
  await domListeners.DOMContentLoaded();

  elements.popupInitialWidth.value = '760';
  elements.popupInitialHeight.value = '420';
  await elements.saveBtn.listeners.click();

  const saved = syncWrites.at(-1);
  assert.strictEqual(saved.popupInitialWidth, 760);
  assert.strictEqual(saved.popupInitialHeight, 420);
}

async function testStoredPopupInitialSizeLoadsIntoFields() {
  const { elements, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        popupInitialWidth: 820,
        popupInitialHeight: 460,
        languagePreference: 'en'
      });
    }
  });

  await domListeners.DOMContentLoaded();

  assert.strictEqual(elements.popupInitialWidth.value, '820');
  assert.strictEqual(elements.popupInitialHeight.value, '460');
}

async function testSaveClampsPopupInitialSize() {
  const { elements, domListeners, syncWrites } = createTestContext();
  await domListeners.DOMContentLoaded();

  elements.popupInitialWidth.value = '100';
  elements.popupInitialHeight.value = '9999';
  await elements.saveBtn.listeners.click();

  const saved = syncWrites.at(-1);
  assert.strictEqual(saved.popupInitialWidth, 300);
  assert.strictEqual(saved.popupInitialHeight, 900);
}

async function testOptionsHtmlContainsPopupInitialSizeControls() {
  for (const expectedId of ['popupInitialWidth', 'popupInitialHeight']) {
    assert.match(htmlSource, new RegExp(`id=\"${expectedId}\"`), `options.html should contain #${expectedId}`);
  }
  assert.match(htmlSource, /data-i18n=\"popupInitialSize\"/, 'options.html should label popup initial size settings');
}

async function testOptionsHtmlContainsMemoryCardControls() {
  for (const expectedId of ['memoryEnabled', 'memoryLongTerm', 'saveMemory', 'clearDailyLogs']) {
    assert.match(htmlSource, new RegExp(`id=\"${expectedId}\"`), `options.html should contain #${expectedId}`);
  }
  assert.match(htmlSource, /data-i18n=\"memory\"/, 'options.html should label the memory card');
}

async function testGithubCopilotSlowDownKeepsPollingUiPending() {
  const { elements, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        providerType: 'github-copilot',
        model: 'gpt-5.4',
        languagePreference: 'en'
      });
    },
    localStorageGetImpl(keys, callback) {
      callback({
        copilotDeviceCode: 'device-code',
        copilotUserExpiry: Date.now() + 60_000
      });
    },
    sendMessageImpl(message, callback) {
      if (message.type === 'GET_MODELS') {
        callback({ models: ['gpt-5.4'] });
        return;
      }
      if (message.type === 'COPILOT_POLL_TOKEN') {
        callback({ status: 'pending' });
        return;
      }
      callback({ success: false, error: `Unexpected message ${message.type}` });
    },
    setIntervalImpl(fn) {
      fn();
      return 1;
    }
  });

  await domListeners.DOMContentLoaded();
  await Promise.resolve();
  await Promise.resolve();

  assert.strictEqual(elements.copilotDeviceFlow.style.display, '');
  assert.notStrictEqual(elements.copilotPollStatus.textContent, 'Authorization failed. Please try again.');
}

async function testGithubCopilotPendingFlowRestoresCodeOnLoad() {
  const { elements, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        providerType: 'github-copilot',
        model: 'gpt-5.4',
        languagePreference: 'en'
      });
    },
    localStorageGetImpl(keys, callback) {
      callback({
        copilotDeviceCode: 'device-code',
        copilotUserCode: 'ABCD-EFGH',
        copilotVerificationUri: 'https://github.com/login/device',
        copilotUserExpiry: Date.now() + 60_000
      });
    },
    sendMessageImpl(message, callback) {
      if (message.type === 'GET_MODELS') {
        callback({ models: ['gpt-5.4'] });
        return;
      }
      callback({ status: 'pending' });
    }
  });

  await domListeners.DOMContentLoaded();
  await Promise.resolve();

  assert.strictEqual(elements.copilotDeviceFlow.style.display, '');
  assert.strictEqual(elements.copilotUserCode.textContent, 'ABCD-EFGH');
  assert.strictEqual(elements.copilotVerifyLink.href, 'https://github.com/login/device');
  assert.strictEqual(elements.copilotVerifyLink.textContent, 'https://github.com/login/device');
}

async function testGithubCopilotPollingUsesStoredInterval() {
  const intervalCalls = [];
  const { elements, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        providerType: 'github-copilot',
        model: 'gpt-5.4',
        languagePreference: 'en'
      });
    },
    localStorageGetImpl(keys, callback) {
      callback({
        copilotDeviceCode: 'device-code',
        copilotUserCode: 'ABCD-EFGH',
        copilotVerificationUri: 'https://github.com/login/device',
        copilotUserExpiry: Date.now() + 60_000,
        copilotPollInterval: 7
      });
    },
    sendMessageImpl(message, callback) {
      if (message.type === 'GET_MODELS') {
        callback({ models: ['gpt-5.4'] });
        return;
      }
      callback({ status: 'pending' });
    },
    setIntervalImpl(fn, delay) {
      intervalCalls.push(delay);
      return 1;
    }
  });

  await domListeners.DOMContentLoaded();
  await Promise.resolve();

  assert.ok(intervalCalls.includes(7000));
}

async function testGithubCopilotSlowDownBacksOffPollingInterval() {
  const intervalCalls = [];
  let localState = {
    copilotDeviceCode: 'device-code',
    copilotUserCode: 'ABCD-EFGH',
    copilotVerificationUri: 'https://github.com/login/device',
    copilotUserExpiry: Date.now() + 60_000,
    copilotPollInterval: 5
  };

  const { domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        providerType: 'github-copilot',
        model: 'gpt-5.4',
        languagePreference: 'en'
      });
    },
    localStorageGetImpl(keys, callback) {
      callback({ ...localState });
    },
    sendMessageImpl(message, callback) {
      if (message.type === 'GET_MODELS') {
        callback({ models: ['gpt-5.4'] });
        return;
      }
      if (message.type === 'COPILOT_POLL_TOKEN') {
        localState = { ...localState, copilotPollInterval: 10 };
        callback({ status: 'pending', slowDown: true, interval: 10 });
        return;
      }
      callback({ status: 'pending' });
    },
    setIntervalImpl(fn, delay) {
      intervalCalls.push(delay);
      fn();
      return intervalCalls.length;
    }
  });

  await domListeners.DOMContentLoaded();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepStrictEqual(intervalCalls.slice(0, 2), [5000, 10000]);
}

async function testGithubCopilotFailureShowsRetryButton() {
  const { context, elements, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        providerType: 'github-copilot',
        model: 'gpt-5.4',
        languagePreference: 'en'
      });
    },
    localStorageGetImpl(keys, callback) {
      callback({
        copilotDeviceCode: 'device-code',
        copilotUserCode: 'ABCD-EFGH',
        copilotVerificationUri: 'https://github.com/login/device',
        copilotUserExpiry: Date.now() + 60_000,
        copilotPollInterval: 5
      });
    },
    sendMessageImpl(message, callback) {
      if (message.type === 'GET_MODELS') {
        callback({ models: ['gpt-5.4'] });
        return;
      }
      callback({ status: 'failed', error: 'expired_token' });
    },
    setIntervalImpl(fn) {
      fn();
      return 1;
    }
  });

  await domListeners.DOMContentLoaded();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.strictEqual(elements.copilotAuthBtn.style.display, '');
  assert.strictEqual(elements.copilotAuthBtn.disabled, false);
  assert.strictEqual(elements.copilotAuthBtn.onclick, context.startCopilotAuth);
}

async function testOptionsHtmlDoesNotUseInlineScripts() {
  assert.ok(!/<script(?:\s[^>]*)?>\s*[^<\s]/i.test(htmlSource), 'options.html must not include inline script because extension CSP blocks it');
}

async function testOptionsHtmlContainsA2aControls() {
  for (const expectedId of ['a2aCard', 'a2aServerName', 'a2aServerEndpoint', 'a2aServerToken', 'addA2aServerBtn', 'a2aStatus', 'a2aServerList', 'a2aAutoRoute']) {
    assert.match(htmlSource, new RegExp(`id=\"${expectedId}\"`), `options.html should contain #${expectedId}`);
  }
  assert.match(htmlSource, /class=\"[^\"]*a2a-auto-route-control[^\"]*\"/, 'auto-route checkbox should use explicit toggle styling');
  assert.match(htmlSource, /class=\"[^\"]*a2a-auto-route-checkbox[^\"]*\"/, 'auto-route checkbox input should not inherit generic text input styling');
}

async function testAddingA2aServerRequiresNameAndEndpoint() {
  const { context, elements, syncWrites, localWrites } = createTestContext();

  elements.a2aServerName.value = '';
  await context.addA2aServerFromForm();

  assert.deepStrictEqual(syncWrites, []);
  assert.deepStrictEqual(localWrites, []);
  assert.strictEqual(elements.a2aStatus.className, 'status error');

  elements.a2aServerName.value = 'Demo Server';
  elements.a2aServerEndpoint.value = '';
  await context.addA2aServerFromForm();

  assert.deepStrictEqual(syncWrites, []);
  assert.deepStrictEqual(localWrites, []);
  assert.strictEqual(elements.a2aStatus.className, 'status error');
}

async function testAddingA2aServerStoresMetadataInLocalAndTokenInLocalOnly() {
  const { context, elements, syncWrites, localWrites } = createTestContext();

  await context.addA2aServerFromForm();

  const savedServers = localWrites.find(write => Array.isArray(write.a2aServers))?.a2aServers;
  const savedTokens = localWrites.find(write => write.a2aServerTokens)?.a2aServerTokens;
  assert.ok(savedServers, 'a2aServers should be written to chrome.storage.local');
  assert.ok(!syncWrites.some(write => Array.isArray(write.a2aServers)), 'a2aServers must not be written to chrome.storage.sync');
  assert.strictEqual(savedServers.length, 1);
  assert.strictEqual(savedServers[0].name, 'Demo Server');
  assert.strictEqual(savedServers[0].endpoint, 'https://a2a.example.com');
  assert.ok(!Object.prototype.hasOwnProperty.call(savedServers[0], 'token'));
  assert.strictEqual(savedTokens[savedServers[0].id], 'secret-token');
}

async function testAddingA2aServerDiscoversAndStoresAgentSkills() {
  const { context, localWrites, sendMessageCalls } = createTestContext({
    sendMessageImpl(message, callback) {
      if (message.type === 'A2A_DISCOVER_SERVER') {
        callback({
          success: true,
          agentCard: {
            name: 'CloudBot',
            skills: [
              { id: 'alibaba', name: 'Alibaba Cloud', description: 'Query Alibaba Cloud ECS instances and VMs.', tags: ['alibaba', 'vm'] }
            ]
          }
        });
        return;
      }
      callback({ models: [] });
    }
  });

  await context.addA2aServerFromForm();

  assert.strictEqual(sendMessageCalls.at(-1).type, 'A2A_DISCOVER_SERVER');
  const savedServer = localWrites.findLast(write => Array.isArray(write.a2aServers))?.a2aServers[0];
  assert.strictEqual(savedServer.name, 'CloudBot');
  assert.strictEqual(savedServer.agentCard.skills[0].id, 'alibaba');
  assert.strictEqual(savedServer.agentCard.skills[0].tags[1], 'vm');
}

async function testRenderingStoredA2aServersShowsNameAndEndpointNotToken() {
  const { context, elements } = createTestContext();

  context.a2aServers = [{ id: 'server-1', name: 'Stored Server', endpoint: 'https://stored.example.com' }];
  context.a2aServerTokens = { 'server-1': 'super-secret' };
  context.renderA2aServers(context.a2aServers);

  assert.match(elements.a2aServerList.innerHTML, /Stored Server/);
  assert.match(elements.a2aServerList.innerHTML, /https:\/\/stored\.example\.com/);
  assert.doesNotMatch(elements.a2aServerList.innerHTML, /super-secret/);
}

async function testA2aServerListButtonsInvokeDiscoverAndRemove() {
  const { context, elements, sendMessageCalls, syncWrites, localWrites, domListeners } = createTestContext({
    sendMessageImpl(message, callback) {
      if (message.type === 'A2A_DISCOVER_SERVER') {
        callback({ success: true, agentCard: { name: 'Discovered Agent' } });
        return;
      }
      callback({ models: [] });
    }
  });

  await domListeners.DOMContentLoaded();
  context.a2aServers = [{ id: 'server-1', name: 'Stored Server', endpoint: 'https://stored.example.com' }];
  context.a2aServerTokens = { 'server-1': 'super-secret' };
  context.renderA2aServers(context.a2aServers);

  const discoverButton = {
    getAttribute(name) {
      if (name === 'data-action') return 'discover';
      if (name === 'data-server-id') return 'server-1';
      return '';
    }
  };
  elements.a2aServerList.listeners.click({ target: { closest: () => discoverButton } });
  await Promise.resolve();
  await Promise.resolve();

  assert.strictEqual(sendMessageCalls.at(-1).type, 'A2A_DISCOVER_SERVER');
  assert.strictEqual(sendMessageCalls.at(-1).serverId, 'server-1');
  assert.strictEqual(localWrites.findLast(write => Array.isArray(write.a2aServers))?.a2aServers[0].agentCard.name, 'Discovered Agent');

  const removeButton = {
    getAttribute(name) {
      if (name === 'data-action') return 'remove';
      if (name === 'data-server-id') return 'server-1';
      return '';
    }
  };
  elements.a2aServerList.listeners.click({ target: { closest: () => removeButton } });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepStrictEqual(localWrites.findLast(write => Array.isArray(write.a2aServers))?.a2aServers, []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(localWrites.at(-1).a2aServerTokens)), {});
}

async function testStartCopilotAuthRejectsUnsafeVerificationUri() {
  const tabsCreated = [];
  const { elements, context } = createTestContext({
    sendMessageImpl(message, callback, runtimeContext) {
      if (message.type === 'COPILOT_START_DEVICE_FLOW') {
        callback({
          success: true,
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://evil.example/login/device',
          deviceCode: 'device-code',
          interval: 5
        });
        return;
      }
      callback({ models: [] });
    }
  });
  context.chrome.tabs.create = payload => tabsCreated.push(payload);

  await context.startCopilotAuth();

  assert.strictEqual(elements.copilotDeviceFlow.style.display, undefined);
  assert.strictEqual(elements.copilotAuthBtn.style.display, '');
  assert.strictEqual(elements.copilotAuthBtn.disabled, false);
  assert.match(elements.copilotPollStatus.textContent, /Invalid GitHub verification URL\./);
  assert.deepStrictEqual(tabsCreated, []);
}

async function testDiscoverUpdatesAgentCardMetadataAndSavesToLocal() {
  const { context, localWrites, sendMessageCalls } = createTestContext({
    sendMessageImpl(message, callback) {
      if (message.type === 'A2A_DISCOVER_SERVER') {
        callback({ success: true, agentCard: { name: 'Discovered Agent', version: '1.0.0' } });
        return;
      }
      callback({ models: [] });
    }
  });

  context.renderA2aServers([{
    id: 'server-1',
    name: 'Pending Server',
    endpoint: 'https://discovered.example.com'
  }]);

  const server = await context.discoverAndSaveA2aServer({
    id: 'server-1',
    name: 'Pending Server',
    endpoint: 'https://discovered.example.com'
  });

  assert.strictEqual(sendMessageCalls.at(-1).type, 'A2A_DISCOVER_SERVER');
  assert.strictEqual(sendMessageCalls.at(-1).serverId, 'server-1');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(server.agentCard)), { name: 'Discovered Agent', version: '1.0.0' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(localWrites.findLast(write => Array.isArray(write.a2aServers))?.a2aServers[0].agentCard)), { name: 'Discovered Agent', version: '1.0.0' });
}

async function testLegacyA2aServerWithoutIdIsPersistedBeforeDiscovery() {
  const { context, domListeners, localWrites, sendMessageCalls } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        providerType: 'custom-provider',
        endpoint: 'http://localhost:5000',
        apiKey: 'test-key',
        model: 'deepseek-v4-flash',
        languagePreference: 'en'
      });
    },
    localStorageGetImpl(keys, callback) {
      callback({
        a2aServers: [
          { name: 'OmniLauncher', endpoint: 'http://127.0.0.1:1423', enabled: true }
        ]
      });
    },
    sendMessageImpl(message, callback) {
      if (message.type === 'A2A_DISCOVER_SERVER') {
        callback({ success: true, agentCard: { name: 'OmniLauncher' } });
        return;
      }
      callback({ models: [] });
    }
  });

  await domListeners.DOMContentLoaded();
  await Promise.resolve();

  const migratedServers = localWrites.find(write => Array.isArray(write.a2aServers))?.a2aServers;
  assert.strictEqual(migratedServers?.length, 1);
  assert.ok(migratedServers[0].id);
  assert.notStrictEqual(migratedServers[0].id, 'undefined');
  assert.strictEqual(migratedServers[0].name, 'OmniLauncher');
  assert.strictEqual(migratedServers[0].endpoint, 'http://127.0.0.1:1423');

  await context.discoverAndSaveA2aServer(migratedServers[0].id);

  assert.strictEqual(sendMessageCalls.at(-1).type, 'A2A_DISCOVER_SERVER');
  assert.strictEqual(sendMessageCalls.at(-1).serverId, migratedServers[0].id);
}

async function testInitMigratesLegacyA2aServersFromSyncToLocal() {
  const { context, domListeners, syncWrites, syncRemoves, localWrites } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        providerType: 'custom-provider',
        endpoint: 'http://localhost:5000',
        apiKey: 'test-key',
        model: 'deepseek-v4-flash',
        languagePreference: 'en',
        a2aServers: [
          { id: 'legacy-1', name: 'Legacy Server', endpoint: 'http://127.0.0.1:1423', enabled: true }
        ]
      });
    },
    localStorageGetImpl(keys, callback) {
      callback({});
    }
  });

  await domListeners.DOMContentLoaded();
  await Promise.resolve();

  const migratedServers = localWrites.find(write => Array.isArray(write.a2aServers))?.a2aServers;
  assert.ok(migratedServers, 'legacy servers should be written to chrome.storage.local');
  assert.strictEqual(migratedServers.length, 1);
  assert.strictEqual(migratedServers[0].id, 'legacy-1');
  assert.ok(!syncWrites.some(write => Array.isArray(write.a2aServers)), 'init must not write a2aServers back to sync');
  assert.ok(syncRemoves.some(keys => [].concat(keys).includes('a2aServers')), 'legacy sync a2aServers key should be cleared');
}

async function main() {
  await testOptionsHtmlDoesNotUseInlineScripts();
  await testOptionsHtmlContainsA2aControls();
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
  await testProviderChangeLoadsProviderSpecificConfig();
  await testSaveWritesProviderTypeAndNotLegacyAuthMethod();
  await testSaveWritesPopupInitialSize();
  await testStoredPopupInitialSizeLoadsIntoFields();
  await testSaveClampsPopupInitialSize();
  await testOptionsHtmlContainsPopupInitialSizeControls();
  await testOptionsHtmlContainsMemoryCardControls();
  await testGithubCopilotSlowDownKeepsPollingUiPending();
  await testGithubCopilotPendingFlowRestoresCodeOnLoad();
  await testGithubCopilotPollingUsesStoredInterval();
  await testGithubCopilotSlowDownBacksOffPollingInterval();
  await testGithubCopilotFailureShowsRetryButton();
  await testAddingA2aServerRequiresNameAndEndpoint();
  await testAddingA2aServerStoresMetadataInLocalAndTokenInLocalOnly();
  await testAddingA2aServerDiscoversAndStoresAgentSkills();
  await testRenderingStoredA2aServersShowsNameAndEndpointNotToken();
  await testA2aServerListButtonsInvokeDiscoverAndRemove();
  await testStartCopilotAuthRejectsUnsafeVerificationUri();
  await testDiscoverUpdatesAgentCardMetadataAndSavesToLocal();
  await testLegacyA2aServerWithoutIdIsPersistedBeforeDiscovery();
  await testInitMigratesLegacyA2aServersFromSyncToLocal();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
