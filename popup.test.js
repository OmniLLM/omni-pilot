const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const i18nSource = fs.readFileSync('i18n.js', 'utf8');
const popupSource = fs.readFileSync('popup.js', 'utf8');

function createElement(id = '') {
  return {
    id,
    textContent: '',
    value: '',
    checked: false,
    dataset: {},
    listeners: {},
    classList: { add(className) { this[className] = true; } },
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
    addEventListener(event, handler) {
      if (event === 'DOMContentLoaded') handler();
    },
    getElementById(id) {
      return elements[id];
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

function loadPopup(storedConfig) {
  const writes = [];
  const elements = {
    statusDot: createElement('statusDot'),
    statusText: createElement('statusText'),
    themeToggle: createElement('themeToggle'),
    themeValue: createElement('themeValue'),
    languageSelect: createElement('languageSelect'),
    settingsBtn: createElement('settingsBtn'),
    desc: createElement('desc'),
    themeLabel: createElement('themeLabel'),
    languageLabel: createElement('languageLabel'),
    settingsLabel: createElement('settingsLabel')
  };

  elements.desc.dataset.i18n = 'selectTextDesc';
  elements.themeLabel.dataset.i18n = 'theme';
  elements.languageLabel.dataset.i18n = 'language';
  elements.settingsLabel.dataset.i18n = 'settings';

  const context = {
    globalThis: {},
    document: createDocument(elements),
    chrome: {
      runtime: { openOptionsPage() {} },
      storage: {
        sync: {
          get(defaults, cb) { cb({ ...defaults, ...storedConfig }); },
          set(value) { writes.push(value); }
        }
      }
    }
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(i18nSource, context);
  vm.runInContext(popupSource, context);

  return { elements, writes, documentElement: context.document.documentElement };
}

{
  const { elements, writes, documentElement } = loadPopup({
    apiKey: 'test-key',
    languagePreference: 'zh',
    themePreference: 'dark'
  });

  assert.strictEqual(documentElement.lang, 'zh');
  assert.strictEqual(elements.desc.textContent, '在任意页面选择文本即可使用 AI 操作。');
  assert.strictEqual(elements.statusText.textContent, '就绪');
  assert.strictEqual(elements.themeLabel.textContent, '主题');
  assert.strictEqual(elements.themeValue.textContent, '深色');
  assert.strictEqual(elements.languageLabel.textContent, '语言');
  assert.strictEqual(elements.languageSelect.value, 'zh');
  assert.strictEqual(elements.settingsLabel.textContent, '设置');

  elements.languageSelect.value = 'en';
  elements.languageSelect.listeners.change();
  assert.strictEqual(writes.at(-1).languagePreference, 'en');
  assert.strictEqual(elements.statusText.textContent, 'Ready');
}

{
  const { elements } = loadPopup({
    authMethod: 'github-copilot',
    apiKey: '',
    languagePreference: 'en',
    themePreference: 'dark'
  });

  assert.strictEqual(elements.statusText.textContent, 'Ready');
}
