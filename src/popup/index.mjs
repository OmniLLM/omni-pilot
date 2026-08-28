import { DEFAULT_LANGUAGE, t, normalizeLanguage, applyTranslations } from '../utils/i18n.mjs';
import { createAppearanceController } from '../utils/appearance.mjs';

document.addEventListener('DOMContentLoaded', () => {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const themeSelect = document.getElementById('themePreferenceSelect');
  const visualStyleSelect = document.getElementById('visualStylePreferenceSelect');
  const languageSelect = document.getElementById('languageSelect');
  let currentLanguage = DEFAULT_LANGUAGE;
  let hasApiKey = false;
  let providerType = 'custom-provider';
  let authMethod = 'api-key';

  function label(key) {
    return t(key, currentLanguage);
  }

  function renderStatus() {
    const ready = providerType === 'github-copilot' || authMethod === 'github-copilot' || hasApiKey;
    dot.classList.toggle('ok', ready);
    text.textContent = label(ready ? 'ready' : 'apiKeyNotSet');
  }

  function applyLanguage(language) {
    currentLanguage = normalizeLanguage(language);
    document.documentElement.lang = currentLanguage;
    if (languageSelect) languageSelect.value = currentLanguage;
    applyTranslations(document, currentLanguage);
    renderStatus();
  }

  const appearanceController = createAppearanceController({
    root: document.documentElement,
    surface: 'popup',
    readPreferences: (defaults, callback) => chrome.storage.sync.get(defaults, callback),
    subscribeToChanges: listener => {
      if (!chrome.storage.onChanged?.addListener) return null;
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener?.(listener);
    },
    onApply: state => {
      if (themeSelect) themeSelect.value = state.themePreference;
      if (visualStyleSelect) visualStyleSelect.value = state.visualStylePreference;
    }
  });

  chrome.storage.sync.get({
    languagePreference: DEFAULT_LANGUAGE,
    apiKey: '',
    providerType: 'custom-provider',
    authMethod: 'api-key'
  }, config => {
    hasApiKey = Boolean(config.apiKey);
    providerType = config.providerType || 'custom-provider';
    authMethod = config.authMethod || 'api-key';
    applyLanguage(config.languagePreference);
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  languageSelect?.addEventListener('change', () => {
    const languagePreference = normalizeLanguage(languageSelect.value);
    applyLanguage(languagePreference);
    chrome.storage.sync.set({ languagePreference });
  });

  themeSelect?.addEventListener('change', () => {
    const themePreference = themeSelect.value;
    appearanceController.update({ themePreference });
    chrome.storage.sync.set({ themePreference });
  });

  visualStyleSelect?.addEventListener('change', () => {
    const visualStylePreference = visualStyleSelect.value;
    appearanceController.update({ visualStylePreference });
    chrome.storage.sync.set({ visualStylePreference });
  });

  const handleStorageChange = (changes, areaName) => {
    if (areaName && areaName !== 'sync') return;
    if (changes?.languagePreference) applyLanguage(changes.languagePreference.newValue);
    if (changes?.apiKey) hasApiKey = Boolean(changes.apiKey.newValue);
    if (changes?.providerType) providerType = changes.providerType.newValue || 'custom-provider';
    if (changes?.authMethod) authMethod = changes.authMethod.newValue || 'api-key';
    if (changes?.apiKey || changes?.providerType || changes?.authMethod) renderStatus();
  };
  chrome.storage.onChanged?.addListener?.(handleStorageChange);

  globalThis.addEventListener?.('unload', () => {
    appearanceController.dispose();
    chrome.storage.onChanged?.removeListener?.(handleStorageChange);
  }, { once: true });
});
