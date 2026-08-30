const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/utils/appearance.mjs', 'utf8');
const utilitySource = source.replace(/^export\s*\{[\s\S]*?\};?\s*$/m, '');

function createRoot() {
  return {
    attrs: {},
    style: {},
    setAttribute(name, value) { this.attrs[name] = value; }
  };
}

function loadAppearanceContext(matchMedia) {
  const context = { globalThis: {}, matchMedia };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(utilitySource, context);
  return context;
}

{
  const context = loadAppearanceContext(() => ({ matches: false }));
  assert.strictEqual(context.normalizeThemePreference('system'), 'system');
  assert.strictEqual(context.normalizeThemePreference('invalid'), 'dark');
  assert.strictEqual(context.normalizeVisualStylePreference('terminal'), 'terminal');
  assert.strictEqual(context.normalizeVisualStylePreference('invalid'), 'current');
  assert.strictEqual(context.normalizeUiShapePreference('rounded'), 'rounded');
  assert.strictEqual(context.normalizeUiShapePreference('invalid'), 'subtle');
  assert.deepStrictEqual(
    Array.from(vm.runInContext('THEME_PREFERENCES', context)),
    ['system', 'light', 'dark']
  );
  assert.deepStrictEqual(
    Array.from(vm.runInContext('VISUAL_STYLE_PREFERENCES', context)),
    ['current', 'clean-minimal', 'terminal', 'warm-editorial', 'neo-brutalist']
  );
}

{
  const listeners = new Set();
  const media = {
    matches: false,
    addEventListener(event, listener) { if (event === 'change') listeners.add(listener); },
    removeEventListener(event, listener) { if (event === 'change') listeners.delete(listener); }
  };
  const root = createRoot();
  let storageListener;
  const states = [];
  const context = loadAppearanceContext(() => media);
  const controller = context.createAppearanceController({
    root,
    surface: 'test',
    readPreferences(defaults, callback) {
      assert.strictEqual(defaults.themePreference, 'dark');
      assert.strictEqual(defaults.uiShapePreference, 'subtle');
      callback({ themePreference: 'system', visualStylePreference: 'terminal', uiShapePreference: 'rounded' });
    },
    subscribeToChanges(listener) {
      storageListener = listener;
      return () => { storageListener = null; };
    },
    matchMedia: () => media,
    onApply(state) { states.push({ ...state }); }
  });

  assert.strictEqual(root.attrs['data-appearance-root'], '');
  assert.strictEqual(root.attrs['data-surface'], 'test');
  assert.strictEqual(root.attrs['data-theme-preference'], 'system');
  assert.strictEqual(root.attrs['data-theme'], 'light');
  assert.strictEqual(root.attrs['data-visual-style'], 'terminal');
  assert.strictEqual(root.attrs['data-ui-shape'], 'rounded');
  assert.strictEqual(root.style.colorScheme, 'light');
  assert.strictEqual(listeners.size, 1);

  media.matches = true;
  for (const listener of listeners) listener({ matches: true });
  assert.strictEqual(root.attrs['data-theme'], 'dark');

  storageListener({ themePreference: { newValue: 'light' } }, 'sync');
  assert.strictEqual(root.attrs['data-theme-preference'], 'light');
  assert.strictEqual(root.attrs['data-theme'], 'light');
  assert.strictEqual(listeners.size, 0);

  storageListener({ visualStylePreference: { newValue: 'warm-editorial' } }, 'local');
  assert.strictEqual(root.attrs['data-visual-style'], 'terminal');
  storageListener({ visualStylePreference: { newValue: 'warm-editorial' } }, 'sync');
  assert.strictEqual(root.attrs['data-visual-style'], 'warm-editorial');
  storageListener({ uiShapePreference: { newValue: 'pill' } }, 'sync');
  assert.strictEqual(root.attrs['data-ui-shape'], 'pill');

  controller.dispose();
  assert.strictEqual(storageListener, null);
  assert.ok(states.length >= 4);
}

{
  const root = createRoot();
  const context = loadAppearanceContext(() => ({ matches: true }));
  context.createAppearanceController({
    root,
    readPreferences(defaults, callback) { callback({ themePreference: 'bad', visualStylePreference: null }); }
  });
  assert.strictEqual(root.attrs['data-theme-preference'], 'dark');
  assert.strictEqual(root.attrs['data-theme'], 'dark');
  assert.strictEqual(root.attrs['data-visual-style'], 'current');
  assert.strictEqual(root.attrs['data-ui-shape'], 'subtle');
}

{
  let completeRead;
  let storageListener;
  const root = createRoot();
  const context = loadAppearanceContext(() => ({ matches: false }));
  const controller = context.createAppearanceController({
    root,
    readPreferences(defaults, callback) { completeRead = callback; },
    subscribeToChanges(listener) { storageListener = listener; }
  });

  storageListener({ themePreference: { newValue: 'light' } }, 'sync');
  completeRead({ themePreference: 'dark', visualStylePreference: 'terminal' });
  assert.strictEqual(controller.getState().themePreference, 'light');
  assert.strictEqual(controller.getState().visualStylePreference, 'terminal');
}

console.log('appearance tests passed');
