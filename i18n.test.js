const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('i18n.js', 'utf8');

function createElement() {
  return {
    textContent: '',
    placeholder: '',
    title: '',
    ariaLabel: '',
    dataset: {},
    children: [],
    setAttribute(name, value) {
      this[name] = value;
      if (name === 'aria-label') this.ariaLabel = value;
    },
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return this.children.filter(child => child.dataset.i18n);
      if (selector === '[data-i18n-placeholder]') return this.children.filter(child => child.dataset.i18nPlaceholder);
      if (selector === '[data-i18n-title]') return this.children.filter(child => child.dataset.i18nTitle);
      if (selector === '[data-i18n-aria-label]') return this.children.filter(child => child.dataset.i18nAriaLabel);
      return [];
    }
  };
}

function loadI18n() {
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.globalThis.OmniPilotI18n;
}

function assertMessages() {
  const i18n = loadI18n();

  assert.strictEqual(i18n.normalizeLanguage('zh'), 'zh');
  assert.strictEqual(i18n.normalizeLanguage('fr'), 'en');
  assert.strictEqual(i18n.t('settings', 'zh'), '设置');
  assert.strictEqual(i18n.t('settings', 'en'), 'Settings');
  assert.strictEqual(i18n.t('missing-key', 'zh'), 'missing-key');
}

function assertDomTranslation() {
  const i18n = loadI18n();
  const root = createElement();
  const textEl = createElement();
  const inputEl = createElement();
  const buttonEl = createElement();
  const ariaEl = createElement();

  textEl.dataset.i18n = 'settings';
  inputEl.dataset.i18nPlaceholder = 'askFollowUp';
  buttonEl.dataset.i18nTitle = 'fetchModels';
  ariaEl.dataset.i18nAriaLabel = 'language';
  root.children.push(textEl, inputEl, buttonEl, ariaEl);

  i18n.applyTranslations(root, 'zh');

  assert.strictEqual(textEl.textContent, '设置');
  assert.strictEqual(inputEl.placeholder, '询问后续问题...');
  assert.strictEqual(buttonEl.title, '获取模型');
  assert.strictEqual(ariaEl.ariaLabel, '语言');
}

assertMessages();
assertDomTranslation();
