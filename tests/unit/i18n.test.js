const assert = require('assert');

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

async function main() {
  // i18n is now an ES module (src/utils/i18n.mjs); import it directly to test its exports.
  const { normalizeLanguage, t, applyTranslations } = await import('../../src/utils/i18n.mjs');

  // assertMessages
  assert.strictEqual(normalizeLanguage('zh'), 'zh');
  assert.strictEqual(normalizeLanguage('fr'), 'en');
  assert.strictEqual(t('settings', 'zh'), '设置');
  assert.strictEqual(t('settings', 'en'), 'Settings');
  assert.strictEqual(t('missing-key', 'zh'), 'missing-key');

  // assertDomTranslation
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

  applyTranslations(root, 'zh');

  assert.strictEqual(textEl.textContent, '设置');
  assert.strictEqual(inputEl.placeholder, '询问后续问题...');
  assert.strictEqual(buttonEl.title, '获取模型');
  assert.strictEqual(ariaEl.ariaLabel, '语言');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
