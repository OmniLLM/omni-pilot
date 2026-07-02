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
    _textContent: '',
    get textContent() {
      if (this.children.length === 0) return this._textContent;
      return this._textContent + this.children.map(c => c.textContent || '').join('');
    },
    set textContent(value) { this._textContent = value; },
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
      if (selector.startsWith('.') && String(this.className).split(/\s+/).includes(selector.slice(1))) return this;
      return this.parentNode?.closest?.(selector) || null;
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
      this._textContent = String(value).replace(/<[^>]*>/g, '');
      this.children = [];

      for (const match of String(value).matchAll(/class="([^"]+)"[^>]*>([^<]*)/g)) {
        const child = createElement(documentRef);
        child.className = match[1];
        child.textContent = match[2];
        const contextId = match[0].match(/data-context-id="([^"]+)"/)?.[1];
        if (contextId) child.dataset.contextId = contextId;
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
    addEventListener(event, handler) {
      const previous = this.listeners[event];
      this.listeners[event] = previous
        ? payload => { previous(payload); handler(payload); }
        : handler;
    },
    getElementById(id) { return this.elementsById[id] || null; },
    querySelectorAll() { return []; }
  };
  documentRef.body = createElement(documentRef, 'body');
  documentRef.body.setAttribute = function () {};

  const storageListeners = [];
  const sendMessageCalls = [];
  const syncWrites = [];
  const localWrites = [];
  const { a2aServers: seededA2aServers, ...syncSeed } = storedConfig;
  const localStore = seededA2aServers === undefined ? {} : { a2aServers: seededA2aServers };
  let selectionText = 'selected text';
  const context = {
    globalThis: {},
    document: documentRef,
    window: {
      innerWidth: 1024,
      innerHeight: 768,
      getSelection() {
        return {
          rangeCount: selectionText ? 1 : 0,
          toString: () => selectionText,
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
          else if (message.type === 'A2A_DELEGATE_TASK') callback({ success: true, result: 'delegated' });
          else callback({ success: true });
        }
      },
      storage: {
        sync: {
          get(defaults, cb) {
            const result = { ...defaults, languagePreference: 'zh', ...syncSeed };
            if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)
              && Object.prototype.hasOwnProperty.call(defaults, 'a2aServers')
              && !Object.prototype.hasOwnProperty.call(syncSeed, 'a2aServers')) {
              delete result.a2aServers;
            }
            cb(result);
          },
          set(values, cb = () => {}) {
            syncWrites.push(values);
            cb();
          }
        },
        local: {
          get(keys, cb) {
            if (Array.isArray(keys)) {
              cb(Object.fromEntries(keys.filter(key => key in localStore).map(key => [key, localStore[key]])));
              return;
            }
            if (keys && typeof keys === 'object') {
              const result = { ...keys };
              for (const key of Object.keys(keys)) {
                if (key in localStore) result[key] = localStore[key];
              }
              cb(result);
              return;
            }
            cb({ ...localStore });
          },
          set(values, cb = () => {}) {
            localWrites.push(values);
            Object.assign(localStore, values);
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

  return {
    documentRef,
    storageListeners,
    context,
    sendMessageCalls,
    syncWrites,
    localWrites,
    localStore,
    setSelectionText(text) { selectionText = text; }
  };
}

function countOccurrences(value, substring) {
  return (String(value).match(new RegExp(substring, 'g')) || []).length;
}

async function selectText(documentRef, setSelectionText, text, target = documentRef.body) {
  setSelectionText(text);
  documentRef.listeners.mouseup({ clientX: 20, clientY: 30, target });
  await new Promise(resolve => setTimeout(resolve, 20));
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

async function testOrdinaryFollowUpUsesAIChatNotDirectA2a() {
  const { documentRef, sendMessageCalls, setSelectionText } = await createContentContext({
    apiKey: 'test-key',
    languagePreference: 'en',
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true, agentCard: { name: 'A2A localhost' } }]
  });

  await selectText(documentRef, setSelectionText, 'selected context for A2A');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const input = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-input');
  input.value = 'show me disk usage';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  assert.ok(sendMessageCalls.some(message => message.type === 'AI_CHAT'));
  assert.ok(!sendMessageCalls.some(message => message.type === 'A2A_DELEGATE_TASK'));
}

async function testA2aMentionFollowUpUsesConversationContextWhenPresent() {
  const { documentRef, sendMessageCalls, setSelectionText } = await createContentContext({
    apiKey: 'test-key',
    languagePreference: 'en',
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  await selectText(documentRef, setSelectionText, 'selected context for A2A');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const input = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-input');
  input.value = 'What does this mean?';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  input.value = '@A2Alocalhost summarize using this popup';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  const delegateMessage = sendMessageCalls.findLast(message => message.type === 'A2A_DELEGATE_TASK');
  assert.ok(delegateMessage, 'A2A mention should delegate');
  assert.ok(delegateMessage.contextText.includes('selected context for A2A'));
  assert.ok(delegateMessage.contextText.includes('What does this mean?'));
}

async function testA2aMentionFollowUpDelegatesInsteadOfChat() {
  const { documentRef, sendMessageCalls, setSelectionText } = await createContentContext({
    apiKey: 'test-key',
    languagePreference: 'en',
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  await selectText(documentRef, setSelectionText, 'selected context for A2A');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const input = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-input');
  input.value = '@A2Alocalhost hihihi';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  const delegateMessage = sendMessageCalls.findLast(message => message.type === 'A2A_DELEGATE_TASK');
  assert.ok(delegateMessage, 'A2A mention should send A2A_DELEGATE_TASK');
  assert.strictEqual(delegateMessage.serverId, 'server-1');
  assert.strictEqual(delegateMessage.task, 'hihihi');
  assert.ok(delegateMessage.contextText.includes('selected context for A2A'));
  assert.ok(!sendMessageCalls.some(message => message.type === 'AI_CHAT' && message.messages?.some(item => item.content === '@A2Alocalhost hihihi')));
}

async function testA2aMentionFollowUpSendsPopupTranscriptContext() {
  const { documentRef, sendMessageCalls, setSelectionText } = await createContentContext({
    apiKey: 'test-key',
    languagePreference: 'en',
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  await selectText(documentRef, setSelectionText, 'popup selected context');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const input = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-input');
  input.value = 'What does this mean?';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  input.value = '@A2Alocalhost summarize using this popup';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  const delegateMessage = sendMessageCalls.findLast(message => message.type === 'A2A_DELEGATE_TASK');
  assert.ok(delegateMessage, 'A2A mention should delegate');
  assert.ok(delegateMessage.contextText.includes('popup selected context'));
  assert.ok(delegateMessage.contextText.includes('What does this mean?'));
  assert.ok(!delegateMessage.contextText.includes('@A2Alocalhost summarize using this popup'));
}

async function testA2aMentionMatchingIgnoresCaseSpacesAndPunctuation() {
  const { context } = await createContentContext({
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  assert.strictEqual(context.globalThis.__omnipilotTestApi.parseA2aMentionTask('@a2a-localhost run').server.id, 'server-1');
  assert.strictEqual(context.globalThis.__omnipilotTestApi.parseA2aMentionTask('@A2Alocalhost run').server.id, 'server-1');
}

async function testGenericA2aMentionUsesOnlyEnabledServer() {
  const { context } = await createContentContext({
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  assert.strictEqual(context.globalThis.__omnipilotTestApi.parseA2aMentionTask('@a2a hi').server.id, 'server-1');
}

async function testUnknownA2aMentionShowsErrorWithoutChat() {
  const { documentRef, sendMessageCalls, setSelectionText } = await createContentContext({
    apiKey: 'test-key',
    languagePreference: 'en',
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  await selectText(documentRef, setSelectionText, 'selected context');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const input = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-input');
  input.value = '@A2Aunknown hi';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  const body = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-body');
  assert.ok(body.textContent.includes('A2A server not found: @A2Aunknown'));
  assert.ok(!sendMessageCalls.some(message => message.type === 'AI_CHAT'));
  assert.ok(!sendMessageCalls.some(message => message.type === 'A2A_DELEGATE_TASK'));
}

async function testA2aServersDoNotAppearAsProviderEntries() {
  const { context } = await createContentContext({
    providerType: 'a2a:a2a-1',
    a2aServers: [
      { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
    ]
  });

  assert.strictEqual(context.getProviderLabel('a2a:a2a-1', ''), 'Custom');
  assert.ok(!context.getProviderEntries().some(entry => entry.providerType === 'a2a:a2a-1'));
  assert.ok(!context.getProviderEntries().some(entry => entry.label === 'Planner'));
}

async function testSyncRemovalOfLegacyA2aServersDoesNotClearLocalServers() {
  const { documentRef, storageListeners, sendMessageCalls, setSelectionText } = await createContentContext({
    apiKey: 'test-key',
    languagePreference: 'en',
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  // Simulate options.js migration clearing the legacy sync key.
  storageListeners[0]({ a2aServers: { oldValue: [{ id: 'server-1' }], newValue: undefined } }, 'sync');

  await selectText(documentRef, setSelectionText, 'selected context');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const input = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-input');
  input.value = '@A2Alocalhost ping';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  assert.ok(sendMessageCalls.some(message => message.type === 'A2A_DELEGATE_TASK'), 'sync removal must not wipe locally-stored servers');
}

async function testLocalA2aServerChangesUpdateContentState() {
  const { documentRef, storageListeners, sendMessageCalls, setSelectionText } = await createContentContext({
    apiKey: 'test-key',
    languagePreference: 'en'
  });

  storageListeners[0]({
    a2aServers: { newValue: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }] }
  }, 'local');

  await selectText(documentRef, setSelectionText, 'selected context');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const input = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-input');
  input.value = '@A2Alocalhost ping';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  assert.ok(sendMessageCalls.some(message => message.type === 'A2A_DELEGATE_TASK'), 'local a2aServers changes should update content state');
}

async function main() {
  await testA2aServersDoNotAppearAsProviderEntries();
  await testSyncRemovalOfLegacyA2aServersDoesNotClearLocalServers();
  await testLocalA2aServerChangesUpdateContentState();
  await testOrdinaryFollowUpUsesAIChatNotDirectA2a();
  await testA2aMentionFollowUpUsesConversationContextWhenPresent();
  await testA2aMentionFollowUpDelegatesInsteadOfChat();
  await testA2aMentionFollowUpSendsPopupTranscriptContext();
  await testA2aMentionMatchingIgnoresCaseSpacesAndPunctuation();
  await testGenericA2aMentionUsesOnlyEnabledServer();
  await testUnknownA2aMentionShowsErrorWithoutChat();

  const dropdown = await openDropdown({ apiKey: 'test-key' });
  assert.ok(dropdown.children.some(child => child.textContent.includes('翻译')));
  assert.ok(dropdown.children.some(child => child.textContent.includes('总结')));

  const { context: delegateContext } = await createContentContext({
    apiKey: 'test-key',
    a2aServers: [{ id: 'server-1', name: 'Server 1', enabled: true }]
  });
  const delegateDropdown = await openDropdown({
    apiKey: 'test-key',
    a2aServers: [{ id: 'server-1', name: 'Server 1', enabled: true }]
  });
  assert.ok(!delegateDropdown.children.some(child => child.textContent.includes('委派到 A2A')));
  assert.ok(Array.isArray(delegateContext.globalThis.__omnipilotTestApi.getDropdownActionIds()));
  assert.ok(!delegateContext.globalThis.__omnipilotTestApi.getDropdownActionIds().includes('delegate-a2a'));

  const { context: noDelegateContext } = await createContentContext({
    apiKey: 'test-key',
    a2aServers: [{ id: 'server-1', name: 'Server 1', enabled: false }]
  });
  const noDelegateDropdown = await openDropdown({
    apiKey: 'test-key',
    a2aServers: [{ id: 'server-1', name: 'Server 1', enabled: false }]
  });
  assert.ok(!noDelegateDropdown.children.some(child => child.textContent.includes('委派到 A2A')));
  assert.ok(!noDelegateContext.globalThis.__omnipilotTestApi.getDropdownActionIds().includes('delegate-a2a'));

  const copilotDropdown = await openDropdown({ providerType: 'github-copilot', apiKey: '' });
  assert.ok(copilotDropdown.children.some(child => child.textContent.includes('翻译')));
  assert.ok(copilotDropdown.children.some(child => child.textContent.includes('总结')));
  assert.ok(!copilotDropdown.children.some(child => child.textContent.includes('设置 API 密钥')));

  const { documentRef, storageListeners, sendMessageCalls, context } = await createContentContext({
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

  await testOpenPanelAppendsNewSelectionContext();
  await testOpenPanelCanRemoveAccidentalSelectionContext();
  await testOpenPanelIgnoresDuplicateAndPanelSelections();
}

async function testOpenPanelAppendsNewSelectionContext() {
  const { documentRef, sendMessageCalls, setSelectionText } = await createContentContext({ apiKey: 'test-key', languagePreference: 'en' });

  await selectText(documentRef, setSelectionText, 'first selected text');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const panel = documentRef.getElementById('omnipilot-panel');
  const body = panel.querySelector('.omnipilot-panel-body');
  assert.strictEqual(panel.style.display, 'flex');
  assert.strictEqual(countOccurrences(body.innerHTML, 'omnipilot-selected-context'), 1);

  await selectText(documentRef, setSelectionText, 'second selected context');

  assert.strictEqual(panel.style.display, 'flex');
  assert.notStrictEqual(documentRef.getElementById('omnipilot-bubble')?.style.display, 'block');
  assert.strictEqual(countOccurrences(body.innerHTML, 'omnipilot-selected-context'), 2);
  assert.ok(body.innerHTML.includes('second selected context'));

  const input = panel.querySelector('.omnipilot-panel-input');
  input.value = 'Use all context';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  const chatMessage = sendMessageCalls.findLast(message => message.type === 'AI_CHAT');
  assert.ok(chatMessage, 'follow-up should send AI_CHAT');
  const messages = JSON.parse(JSON.stringify(chatMessage.messages));
  assert.ok(messages.some(message => message.content.includes('first selected text')));
  assert.ok(messages.some(message => message.content.includes('second selected context')));
  assert.ok(messages.some(message => message.content === 'Use all context'));
}

async function testOpenPanelCanRemoveAccidentalSelectionContext() {
  const { documentRef, sendMessageCalls, setSelectionText } = await createContentContext({ apiKey: 'test-key', languagePreference: 'en' });

  await selectText(documentRef, setSelectionText, 'keep this context');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const panel = documentRef.getElementById('omnipilot-panel');
  const body = panel.querySelector('.omnipilot-panel-body');

  await selectText(documentRef, setSelectionText, 'remove this accidental context');
  assert.strictEqual(countOccurrences(body.innerHTML, 'omnipilot-selected-context'), 2);

  const accidentalRemove = body.children
    .filter(child => String(child.className).split(/\s+/).includes('omnipilot-context-remove'))
    .find(child => child.dataset.contextId === 'selection-context-2');
  assert.ok(accidentalRemove, 'accidental context should render a remove button');

  body.listeners.click({ target: accidentalRemove, preventDefault() {}, stopPropagation() {} });

  assert.strictEqual(countOccurrences(body.innerHTML, 'omnipilot-selected-context'), 1);
  assert.ok(body.innerHTML.includes('keep this context'));
  assert.ok(!body.innerHTML.includes('remove this accidental context'));

  const input = panel.querySelector('.omnipilot-panel-input');
  input.value = 'Use remaining context';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  const chatMessage = sendMessageCalls.findLast(message => message.type === 'AI_CHAT');
  assert.ok(chatMessage, 'follow-up should send AI_CHAT');
  const messages = JSON.parse(JSON.stringify(chatMessage.messages));
  assert.ok(messages.some(message => message.content.includes('keep this context')));
  assert.ok(!messages.some(message => message.content.includes('remove this accidental context')));
}

async function testOpenPanelIgnoresDuplicateAndPanelSelections() {
  const { documentRef, setSelectionText } = await createContentContext({ apiKey: 'test-key', languagePreference: 'en' });

  await selectText(documentRef, setSelectionText, 'first selected text');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const panel = documentRef.getElementById('omnipilot-panel');
  const body = panel.querySelector('.omnipilot-panel-body');

  await selectText(documentRef, setSelectionText, 'new context');
  await selectText(documentRef, setSelectionText, 'new context');
  assert.strictEqual(countOccurrences(body.innerHTML, 'omnipilot-selected-context'), 2);

  await selectText(documentRef, setSelectionText, 'panel text should not be context', panel);
  assert.strictEqual(countOccurrences(body.innerHTML, 'omnipilot-selected-context'), 2);
  assert.ok(!body.innerHTML.includes('panel text should not be context'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
