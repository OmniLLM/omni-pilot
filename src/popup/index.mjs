import { DEFAULT_LANGUAGE, t, normalizeLanguage, applyTranslations } from '../utils/i18n.mjs';

document.addEventListener('DOMContentLoaded', () => {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const themeToggle = document.getElementById('themeToggle');
  const themeValue = document.getElementById('themeValue');
  const languageSelect = document.getElementById('languageSelect');
  let currentLanguage = DEFAULT_LANGUAGE;
  let hasApiKey = false;
  let providerType = 'custom-provider';
  let authMethod = 'api-key';

  function label(key) {
    return t(key, currentLanguage);
  }

  function renderStatus() {
    if (providerType === 'github-copilot' || authMethod === 'github-copilot' || hasApiKey) {
      dot.classList.add('ok');
      text.textContent = label('ready');
    } else {
      text.textContent = label('apiKeyNotSet');
    }
  }

  function applyLanguage(language) {
    currentLanguage = normalizeLanguage(language);
    document.documentElement.lang = currentLanguage;
    if (languageSelect) languageSelect.value = currentLanguage;
    applyTranslations(document, currentLanguage);
    renderStatus();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggle) themeToggle.checked = theme === 'dark';
    if (themeValue) themeValue.textContent = theme === 'dark' ? label('dark') : label('light');
  }

  chrome.storage.sync.get({ themePreference: 'dark', languagePreference: 'en', apiKey: '', providerType: 'custom-provider', authMethod: 'api-key' }, config => {
    hasApiKey = Boolean(config.apiKey);
    providerType = config.providerType || 'custom-provider';
    authMethod = config.authMethod || 'api-key';
    applyLanguage(config.languagePreference);
    applyTheme(config.themePreference);
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  languageSelect?.addEventListener('change', () => {
    const languagePreference = normalizeLanguage(languageSelect.value);
    applyLanguage(languagePreference);
    chrome.storage.sync.set({ languagePreference });
  });

  themeToggle?.addEventListener('change', () => {
    const themePreference = themeToggle.checked ? 'dark' : 'light';
    applyTheme(themePreference);
    chrome.storage.sync.set({ themePreference });
  });
});
