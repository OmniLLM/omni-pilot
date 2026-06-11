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
    classList: { add() {}, remove() {} },
    appendChild() {},
    insertBefore() {},
    addEventListener() {}
  };
}

async function main() {
  const fetchUrls = [];
  const elements = {
    modelSelect: createElement(),
    model: createElement('deepseek-v4-flash'),
    modelStatus: createElement(),
    refreshBtn: createElement(),
    apiShape: createElement('openai-compatible'),
    endpoint: createElement('http://localhost:5000'),
    apiKey: createElement('test-key'),
    saveBtn: createElement(),
    status: createElement(),
    languageSelect: createElement('en')
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    document: {
      documentElement: { lang: '', setAttribute() {} },
      createElement: () => createElement(),
      getElementById: id => elements[id],
      querySelectorAll: () => [],
      addEventListener() {}
    },
    globalThis: {},
    chrome: {
      runtime: { lastError: null },
      storage: { sync: { get() {}, set() {} } }
    },
    fetch: async (url) => {
      fetchUrls.push(String(url));
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

  await context.fetchModels('http://localhost:5000', 'test-key', 'openai-compatible');

  assert.deepStrictEqual(fetchUrls, ['http://localhost:5000/v1/models']);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
