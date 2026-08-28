const THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark']);
const VISUAL_STYLE_PREFERENCES = Object.freeze([
  'current',
  'clean-minimal',
  'terminal',
  'warm-editorial',
  'neo-brutalist'
]);
const UI_SHAPE_PREFERENCES = Object.freeze(['square', 'subtle', 'rounded', 'pill']);
const DEFAULT_THEME_PREFERENCE = 'dark';
const DEFAULT_VISUAL_STYLE_PREFERENCE = 'current';
const DEFAULT_UI_SHAPE_PREFERENCE = 'square';
const APPEARANCE_STORAGE_DEFAULTS = Object.freeze({
  themePreference: DEFAULT_THEME_PREFERENCE,
  visualStylePreference: DEFAULT_VISUAL_STYLE_PREFERENCE,
  uiShapePreference: DEFAULT_UI_SHAPE_PREFERENCE
});

function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : DEFAULT_THEME_PREFERENCE;
}

function normalizeVisualStylePreference(value) {
  return VISUAL_STYLE_PREFERENCES.includes(value) ? value : DEFAULT_VISUAL_STYLE_PREFERENCE;
}

function normalizeUiShapePreference(value) {
  return UI_SHAPE_PREFERENCES.includes(value) ? value : DEFAULT_UI_SHAPE_PREFERENCE;
}

function resolveThemePreference(preference, mediaQueryList) {
  const normalized = normalizeThemePreference(preference);
  if (normalized !== 'system') return normalized;
  return mediaQueryList?.matches ? 'dark' : 'light';
}

function applyAppearanceAttributes(root, state) {
  if (!root) return;
  root.setAttribute('data-appearance-root', '');
  if (state.surface) root.setAttribute('data-surface', state.surface);
  root.setAttribute('data-theme-preference', state.themePreference);
  root.setAttribute('data-theme', state.resolvedTheme);
  root.setAttribute('data-visual-style', state.visualStylePreference);
  root.setAttribute('data-ui-shape', state.uiShapePreference);
  if (root.style) root.style.colorScheme = state.resolvedTheme;
}

function createAppearanceController({
  root,
  surface = '',
  readPreferences,
  subscribeToChanges,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  onApply
} = {}) {
  let themePreference = DEFAULT_THEME_PREFERENCE;
  let visualStylePreference = DEFAULT_VISUAL_STYLE_PREFERENCE;
  let uiShapePreference = DEFAULT_UI_SHAPE_PREFERENCE;
  let mediaQueryList = null;
  let unsubscribeStorage = null;
  let disposed = false;
  const changedSinceRead = new Set();

  function getState() {
    return {
      surface,
      themePreference,
      visualStylePreference,
      uiShapePreference,
      resolvedTheme: resolveThemePreference(themePreference, mediaQueryList)
    };
  }

  function apply() {
    if (disposed) return;
    const state = getState();
    applyAppearanceAttributes(root, state);
    onApply?.(state);
  }

  function handleSystemThemeChange() {
    apply();
  }

  function detachSystemTheme() {
    if (!mediaQueryList) return;
    if (typeof mediaQueryList.removeEventListener === 'function') {
      mediaQueryList.removeEventListener('change', handleSystemThemeChange);
    } else if (typeof mediaQueryList.removeListener === 'function') {
      mediaQueryList.removeListener(handleSystemThemeChange);
    }
    mediaQueryList = null;
  }

  function syncSystemThemeListener() {
    detachSystemTheme();
    if (themePreference !== 'system' || typeof matchMedia !== 'function') return;
    mediaQueryList = matchMedia('(prefers-color-scheme: dark)');
    if (typeof mediaQueryList?.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleSystemThemeChange);
    } else if (typeof mediaQueryList?.addListener === 'function') {
      mediaQueryList.addListener(handleSystemThemeChange);
    }
  }

  function update(preferences = {}, source = 'local') {
    if (disposed) return;
    if (source === 'storage') {
      if (Object.prototype.hasOwnProperty.call(preferences, 'themePreference')) changedSinceRead.add('themePreference');
      if (Object.prototype.hasOwnProperty.call(preferences, 'visualStylePreference')) changedSinceRead.add('visualStylePreference');
      if (Object.prototype.hasOwnProperty.call(preferences, 'uiShapePreference')) changedSinceRead.add('uiShapePreference');
    }
    const nextTheme = Object.prototype.hasOwnProperty.call(preferences, 'themePreference')
      ? normalizeThemePreference(preferences.themePreference)
      : themePreference;
    const nextStyle = Object.prototype.hasOwnProperty.call(preferences, 'visualStylePreference')
      ? normalizeVisualStylePreference(preferences.visualStylePreference)
      : visualStylePreference;
    const nextShape = Object.prototype.hasOwnProperty.call(preferences, 'uiShapePreference')
      ? normalizeUiShapePreference(preferences.uiShapePreference)
      : uiShapePreference;
    const themeChanged = nextTheme !== themePreference;
    const styleChanged = nextStyle !== visualStylePreference;
    const shapeChanged = nextShape !== uiShapePreference;
    if (!themeChanged && !styleChanged && !shapeChanged) return;
    themePreference = nextTheme;
    visualStylePreference = nextStyle;
    uiShapePreference = nextShape;
    if (themeChanged) syncSystemThemeListener();
    apply();
  }

  function handleStorageChanges(changes, areaName) {
    if (areaName && areaName !== 'sync') return;
    const preferences = {};
    if (changes?.themePreference) preferences.themePreference = changes.themePreference.newValue;
    if (changes?.visualStylePreference) preferences.visualStylePreference = changes.visualStylePreference.newValue;
    if (changes?.uiShapePreference) preferences.uiShapePreference = changes.uiShapePreference.newValue;
    if (Object.keys(preferences).length) update(preferences, 'storage');
  }

  apply();
  if (typeof subscribeToChanges === 'function') {
    unsubscribeStorage = subscribeToChanges(handleStorageChanges) || null;
  }
  if (typeof readPreferences === 'function') {
    readPreferences(APPEARANCE_STORAGE_DEFAULTS, stored => {
      const fresh = {};
      if (!changedSinceRead.has('themePreference')) fresh.themePreference = stored?.themePreference;
      if (!changedSinceRead.has('visualStylePreference')) fresh.visualStylePreference = stored?.visualStylePreference;
      if (!changedSinceRead.has('uiShapePreference')) fresh.uiShapePreference = stored?.uiShapePreference;
      update(fresh, 'initial-read');
      changedSinceRead.clear();
    });
  }

  return {
    getState,
    update,
    dispose() {
      if (disposed) return;
      detachSystemTheme();
      if (typeof unsubscribeStorage === 'function') unsubscribeStorage();
      disposed = true;
    }
  };
}

export {
  THEME_PREFERENCES,
  VISUAL_STYLE_PREFERENCES,
  UI_SHAPE_PREFERENCES,
  DEFAULT_THEME_PREFERENCE,
  DEFAULT_VISUAL_STYLE_PREFERENCE,
  DEFAULT_UI_SHAPE_PREFERENCE,
  APPEARANCE_STORAGE_DEFAULTS,
  normalizeThemePreference,
  normalizeVisualStylePreference,
  normalizeUiShapePreference,
  resolveThemePreference,
  applyAppearanceAttributes,
  createAppearanceController
};
