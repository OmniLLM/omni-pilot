const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const i18nSource = fs.readFileSync('i18n.js', 'utf8');
const optionsSource = fs.readFileSync('options.js', 'utf8');

function createElement(initialValue = '') {
  return {
    value: initialValue,
    style: {},
    className: '',
    innerHTML: '',
    textContent: '',
    placeholder: '',
    title: '',
    dataset: {},
    listeners: {},
    classList: { add() {}, remove() {} },
    appendChild() {},
    insertBefore() {},
    addEventListener(event, handler) { this.listeners[event] = handler; },
    setAttribute(name, value) { this[name] = value; }
  };
}

function createDocument(elements) {
  return {
    documentElement: {
      lang: '',
      attrs: {},
      setAttribute(name, value) { this.attrs[name] = value; }
    },
    createElement: () => createElement(),
    getElementById: id => elements[id],
    addEventListener(event, handler) {
      if (event === 'DOMContentLoaded') handler();
    },
    querySelectorAll(selector) {
      const all = Object.values(elements);
      if (selector === '[data-i18n]') return all.filter(el => el.dataset.i18n);
      if (selector === '[data-i18n-placeholder]') return all.filter(el => el.dataset.i18nPlaceholder);
      if (selector === '[data-i18n-title]') return all.filter(el => el.dataset.i18nTitle);
      if (selector === '[data-i18n-aria-label]') return all.filter(el => el.dataset.i18nAriaLabel);
      return [];
    }
  };
}

function loadOptions(storedConfig) {
  const writes = [];
  const elements = {
    modelSelect: createElement(),
    model: createElement('deepseek-v4-flash'),
    models: createElement(''),
    modelStatus: createElement(),
    refreshBtn: createElement(),
    apiShape: createElement('openai-compatible'),
    endpoint: createElement('http://localhost:5000'),
    apiKey: createElement('test-key'),
    providerType: createElement('custom-provider'),
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
    copilotPollStatus: createElement(),
    saveBtn: createElement(),
    status: createElement(),
    languageSelect: createElement(),
    subtitle: createElement(),
    connectionTitle: createElement(),
    apiEndpointLabel: createElement(),
    providerLabel: createElement(),
    saveLabel: createElement()
  };

  elements.subtitle.dataset.i18n = 'settings';
  elements.connectionTitle.dataset.i18n = 'connection';
  elements.apiEndpointLabel.dataset.i18n = 'apiEndpoint';
  elements.providerLabel.dataset.i18n = 'provider';
  elements.saveLabel.dataset.i18n = 'save';

  const context = {
    console,
    setTimeout,
    clearTimeout,
    globalThis: {},
    document: createDocument(elements),
    chrome: {
      runtime: { lastError: null },
      storage: {
        sync: {
          get(keys, cb) { cb(storedConfig); },
          set(value, cb) { writes.push(value); if (cb) cb(); }
        }
      }
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] })
    })
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(i18nSource, context);
  vm.runInContext(optionsSource, context);

  return { elements, writes, documentElement: context.document.documentElement };
}

const { elements, writes, documentElement } = loadOptions({
  endpoint: 'http://localhost:5000',
  apiKey: 'test-key',
  model: 'deepseek-v4-flash',
  apiShape: 'openai-compatible',
  themePreference: 'dark',
  languagePreference: 'zh'
});

assert.strictEqual(documentElement.lang, 'zh');
assert.strictEqual(elements.subtitle.textContent, '设置');
assert.strictEqual(elements.connectionTitle.textContent, '连接');
assert.strictEqual(elements.apiEndpointLabel.textContent, 'API 端点');
assert.strictEqual(elements.providerLabel.textContent, '提供商');
assert.strictEqual(elements.saveLabel.textContent, '保存');
assert.strictEqual(elements.languageSelect.value, 'zh');

elements.languageSelect.value = 'en';
elements.languageSelect.listeners.change();
assert.strictEqual(writes.at(-1).languagePreference, 'en');
assert.strictEqual(elements.subtitle.textContent, 'Settings');
