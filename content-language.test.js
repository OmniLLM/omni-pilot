const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const i18nSource = fs.readFileSync('i18n.js', 'utf8');
const contentSource = fs.readFileSync('content.js', 'utf8');

function createElement(documentRef, tagName = 'div') {
  const listeners = {};
  const element = {
    tagName,
    children: [],
    style: {},
    dataset: {},
    className: '',
    _id: '',
    _innerHTML: '',
    textContent: '',
    value: '',
    placeholder: '',
    rows: 0,
    offsetWidth: 420,
    offsetHeight: 220,
    classList: { add() {}, remove() {} },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (child.id) documentRef.elementsById[child.id] = child;
      return child;
    },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      }
      if (this.id) delete documentRef.elementsById[this.id];
    },
    addEventListener(event, handler) { listeners[event] = handler; },
    focus() {},
    dispatch(event, payload = {}) { listeners[event]?.({ preventDefault() {}, stopPropagation() {}, ...payload }); },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    querySelector(selector) {
      if (selector.startsWith('.')) return findByClass(this, selector.slice(1));
      if (selector.startsWith('#')) return documentRef.elementsById[selector.slice(1)] || null;
      return null;
    },
    contains(target) { return target === this || this.children.some(child => child.contains?.(target)); },
    closest(selector) {
      if (selector.startsWith('#') && this.id === selector.slice(1)) return this;
      return null;
    },
    getBoundingClientRect() { return { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }; },
    get listeners() { return listeners; }
  };

  Object.defineProperty(element, 'id', {
    get() { return this._id; },
    set(value) {
      this._id = value;
      if (value) documentRef.elementsById[value] = this;
    }
  });

  Object.defineProperty(element, 'innerHTML', {
    get() { return this._innerHTML; },
    set(value) {
      this._innerHTML = value;
      this.textContent = String(value).replace(/<[^>]*>/g, '');
      this.children = [];

      for (const match of String(value).matchAll(/class="([^"]+)"[^>]*>([^<]*)/g)) {
        const child = createElement(documentRef);
        child.className = match[1];
        child.textContent = match[2];
        this.appendChild(child);
      }
    }
  });

  return element;
}

function findByClass(root, className) {
  for (const child of root.children) {
    if (String(child.className).split(/\s+/).includes(className)) return child;
    const nested = findByClass(child, className);
    if (nested) return nested;
  }
  return null;
}

async function createContentContext(storedConfig = {}) {
  const documentRef = {
    elementsById: {},
    listeners: {},
    documentElement: { setAttribute() {}, removeAttribute() {} },
    createElement(tagName) { return createElement(documentRef, tagName); },
    addEventListener(event, handler) { this.listeners[event] = handler; },
    getElementById(id) { return this.elementsById[id] || null; },
    querySelectorAll() { return []; }
  };
  documentRef.body = createElement(documentRef, 'body');
  documentRef.body.setAttribute = function () {};

  const storageListeners = [];
  const sendMessageCalls = [];
  const syncWrites = [];
  const context = {
    globalThis: {},
    document: documentRef,
    window: {
      innerWidth: 1024,
      innerHeight: 768,
      getSelection() {
        return {
          rangeCount: 1,
          toString: () => 'selected text',
          getRangeAt: () => ({
            getBoundingClientRect: () => ({ left: 20, top: 30, right: 120, bottom: 50, width: 100, height: 20 })
          })
        };
      }
    },
    chrome: {
      runtime: {
        openOptionsPage() {},
        sendMessage(message, callback = () => {}) {
          sendMessageCalls.push(message);
          if (message.type === 'GET_MODELS') callback({ models: ['claude-sonnet-4-5', 'gpt-4o'] });
          else if (message.type === 'AI_ACTION' || message.type === 'AI_CHAT') callback({ success: true, result: 'ok' });
          else callback({ success: true });
        }
      },
      storage: {
        sync: {
          get(defaults, cb) { cb({ ...defaults, languagePreference: 'zh', ...storedConfig }); },
          set(values, cb = () => {}) {
            syncWrites.push(values);
            cb();
          }
        },
        onChanged: { addListener(handler) { storageListeners.push(handler); } }
      }
    },
    setTimeout,
    AbortController,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    URL
  };
  context.globalThis = context;
  context.window.document = documentRef;

  vm.createContext(context);
  vm.runInContext(i18nSource, context);
  vm.runInContext(contentSource, context);

  return { documentRef, storageListeners, context, sendMessageCalls, syncWrites };
}

async function openDropdown(storedConfig) {
  const { documentRef } = await createContentContext(storedConfig);

  documentRef.listeners.mouseup({ clientX: 20, clientY: 30, target: documentRef.body });
  await new Promise(resolve => setTimeout(resolve, 20));

  const bubble = documentRef.getElementById('omnipilot-bubble');
  assert.ok(bubble, 'bubble should be created for selected text');
  bubble.listeners.click({ preventDefault() {}, stopPropagation() {} });

  const dropdown = documentRef.getElementById('omnipilot-dropdown');
  assert.ok(dropdown, 'dropdown should be created after bubble click');
  return dropdown;
}

async function main() {
  const dropdown = await openDropdown({ apiKey: 'test-key' });
  assert.ok(dropdown.children.some(child => child.textContent.includes('翻译')));
  assert.ok(dropdown.children.some(child => child.textContent.includes('总结')));

  const copilotDropdown = await openDropdown({ providerType: 'github-copilot', apiKey: '' });
  assert.ok(copilotDropdown.children.some(child => child.textContent.includes('翻译')));
  assert.ok(copilotDropdown.children.some(child => child.textContent.includes('总结')));
  assert.ok(!copilotDropdown.children.some(child => child.textContent.includes('设置 API 密钥')));

  const { documentRef, storageListeners, sendMessageCalls } = await createContentContext({
    providerType: 'azure-foundry',
    endpoint: 'https://example.services.ai.azure.com',
    apiKey: 'azure-key',
    model: 'gpt-5.4',
    languagePreference: 'en'
  });
  documentRef.listeners.mouseup({ clientX: 20, clientY: 30, target: documentRef.body });
  await new Promise(resolve => setTimeout(resolve, 20));
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const providerEl = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-meta-provider');
  assert.strictEqual(providerEl.textContent, 'Azure Foundry');

  storageListeners[0]({ providerType: { newValue: 'github-copilot' } });

  assert.strictEqual(providerEl.textContent, 'GitHub Copilot');

  const providerWrap = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-meta-provider-wrap');
  assert.ok(providerWrap, 'provider label should be rendered as a clickable dropdown control');
  providerWrap.listeners.click({ stopPropagation() {} });

  const providerSelector = documentRef.getElementById('omnipilot-provider-selector');
  assert.ok(providerSelector, 'provider selector should open from the panel header');
  const copilotItem = providerSelector.children.find(child => child.textContent === 'GitHub Copilot');
  assert.ok(copilotItem, 'provider selector should include GitHub Copilot');
  copilotItem.listeners.click({ stopPropagation() {} });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(sendMessageCalls.at(-1))), { type: 'SET_PROVIDER', providerType: 'github-copilot' });

  const modelWrap = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-meta-model-wrap');
  modelWrap.listeners.click({ stopPropagation() {} });

  const modelSelector = documentRef.getElementById('omnipilot-model-selector');
  assert.ok(modelSelector, 'model selector should open from the panel header');
  const gpt4oItem = modelSelector.querySelector('.omnipilot-model-list').children.find(child => child.textContent === 'gpt-4o');
  assert.ok(gpt4oItem, 'model selector should include fetched models');
  gpt4oItem.listeners.click({ stopPropagation() {} });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(sendMessageCalls.at(-1))), { type: 'SET_MODEL', model: 'gpt-4o' });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
