const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('dist/popup.js', 'utf8');

function createElement(id = '') {
  return {
    id,
    textContent: '',
    value: '',
    checked: false,
    dataset: {},
    listeners: {},
    classList: {
      add(className) { this[className] = true; },
      toggle(className, force) { this[className] = force === undefined ? !this[className] : Boolean(force); }
    },
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
  const storageListeners = [];
  const elements = {
    statusDot: createElement('statusDot'),
    statusText: createElement('statusText'),
    themeToggle: createElement('themeToggle'),
    themePreferenceSelect: createElement('themePreferenceSelect'),
    visualStylePreferenceSelect: createElement('visualStylePreferenceSelect'),
    languageSelect: createElement('languageSelect'),
    settingsBtn: createElement('settingsBtn'),
    desc: createElement('desc'),
    appearanceLabel: createElement('appearanceLabel'),
    languageLabel: createElement('languageLabel'),
    settingsLabel: createElement('settingsLabel')
  };

  elements.desc.dataset.i18n = 'selectTextDesc';
  elements.appearanceLabel.dataset.i18n = 'appearance';
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
        },
        onChanged: {
          addListener(listener) { storageListeners.push(listener); },
          removeListener(listener) {
            const index = storageListeners.indexOf(listener);
            if (index >= 0) storageListeners.splice(index, 1);
          }
        }
      }
    }
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(source, context);

  return { elements, writes, storageListeners, documentElement: context.document.documentElement };
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
  assert.strictEqual(elements.appearanceLabel.textContent, '外观');
  assert.strictEqual(elements.themePreferenceSelect.value, 'dark');
  assert.strictEqual(elements.visualStylePreferenceSelect.value, 'current');
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
    providerType: 'github-copilot',
    apiKey: '',
    languagePreference: 'en',
    themePreference: 'dark'
  });

  assert.strictEqual(elements.statusText.textContent, 'Ready');
}

{
  const { elements, writes, storageListeners, documentElement } = loadPopup({
    languagePreference: 'en',
    themePreference: 'light',
    visualStylePreference: 'terminal'
  });

  assert.strictEqual(elements.themePreferenceSelect.value, 'light');
  assert.strictEqual(elements.visualStylePreferenceSelect.value, 'terminal');
  assert.strictEqual(documentElement.attrs['data-theme'], 'light');
  assert.strictEqual(documentElement.attrs['data-visual-style'], 'terminal');

  elements.themePreferenceSelect.value = 'system';
  elements.themePreferenceSelect.listeners.change();
  assert.strictEqual(writes.at(-1).themePreference, 'system');
  assert.strictEqual(documentElement.attrs['data-theme-preference'], 'system');

  elements.visualStylePreferenceSelect.value = 'neo-brutalist';
  elements.visualStylePreferenceSelect.listeners.change();
  assert.strictEqual(writes.at(-1).visualStylePreference, 'neo-brutalist');
  assert.strictEqual(documentElement.attrs['data-visual-style'], 'neo-brutalist');

  for (const listener of storageListeners) {
    listener({ visualStylePreference: { newValue: 'warm-editorial' } }, 'sync');
  }
  assert.strictEqual(elements.visualStylePreferenceSelect.value, 'warm-editorial');
  assert.strictEqual(documentElement.attrs['data-visual-style'], 'warm-editorial');
}
