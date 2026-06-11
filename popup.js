document.addEventListener('DOMContentLoaded', () => {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const themeToggle = document.getElementById('themeToggle');
  const themeValue = document.getElementById('themeValue');
  const languageSelect = document.getElementById('languageSelect');
  let currentLanguage = OmniPilotI18n.DEFAULT_LANGUAGE;
  let hasApiKey = false;

  function label(key) {
    return OmniPilotI18n.t(key, currentLanguage);
  }

  function renderStatus() {
    if (hasApiKey) {
      dot.classList.add('ok');
      text.textContent = label('ready');
    } else {
      text.textContent = label('apiKeyNotSet');
    }
  }

  function applyLanguage(language) {
    currentLanguage = OmniPilotI18n.normalizeLanguage(language);
    document.documentElement.lang = currentLanguage;
    if (languageSelect) languageSelect.value = currentLanguage;
    OmniPilotI18n.applyTranslations(document, currentLanguage);
    renderStatus();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggle) themeToggle.checked = theme === 'dark';
    if (themeValue) themeValue.textContent = theme === 'dark' ? label('dark') : label('light');
  }

  chrome.storage.sync.get({ themePreference: 'dark', languagePreference: 'en', apiKey: '' }, config => {
    hasApiKey = Boolean(config.apiKey);
    applyLanguage(config.languagePreference);
    applyTheme(config.themePreference);
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  languageSelect?.addEventListener('change', () => {
    const languagePreference = OmniPilotI18n.normalizeLanguage(languageSelect.value);
    applyLanguage(languagePreference);
    chrome.storage.sync.set({ languagePreference });
  });

  themeToggle?.addEventListener('change', () => {
    const themePreference = themeToggle.checked ? 'dark' : 'light';
    applyTheme(themePreference);
    chrome.storage.sync.set({ themePreference });
  });
});
