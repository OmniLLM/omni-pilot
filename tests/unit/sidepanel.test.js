const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('dist/sidepanel.js', 'utf8');

function element() {
  return {
    style: {}, value: '', textContent: '', scrollHeight: 40, scrollTop: 0,
    children: [], listeners: {},
    addEventListener(event, listener) { this.listeners[event] = listener; },
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    querySelector(selector) { return selector === '.sp-empty' ? null : null; }
  };
}

const elements = { chatBody: element(), chatInput: element(), sendBtn: element() };
const root = { attrs: {}, style: {}, setAttribute(name, value) { this.attrs[name] = value; } };
const storageListeners = [];
const writes = [];
const context = {
  globalThis: {},
  document: {
    documentElement: root,
    getElementById(id) { return elements[id]; },
    createElement: element
  },
  window: { addEventListener() {} },
  chrome: {
    storage: {
      sync: {
        get(defaults, callback) { callback({ ...defaults, themePreference: 'system', visualStylePreference: 'terminal' }); },
        set(value) { writes.push(value); }
      },
      onChanged: {
        addListener(listener) { storageListeners.push(listener); },
        removeListener() {}
      }
    },
    runtime: { connect() { throw new Error('not exercised'); } }
  },
  setTimeout,
  clearTimeout
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

assert.strictEqual(root.attrs['data-theme-preference'], 'system');
assert.strictEqual(root.attrs['data-theme'], 'light');
assert.strictEqual(root.attrs['data-visual-style'], 'terminal');
assert.ok(!source.includes("getElementById('themeToggle')"));
assert.strictEqual(writes.length, 0, 'side panel should never write appearance preferences');

for (const listener of storageListeners) {
  listener({ visualStylePreference: { newValue: 'neo-brutalist' } }, 'sync');
}
assert.strictEqual(root.attrs['data-visual-style'], 'neo-brutalist');
assert.strictEqual(writes.length, 0);

console.log('side panel appearance tests passed');
