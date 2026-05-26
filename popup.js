document.addEventListener('DOMContentLoaded', () => {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  const themeToggle = document.getElementById('themeToggle');
  const themeValue = document.getElementById('themeValue');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggle) themeToggle.checked = theme === 'dark';
    if (themeValue) themeValue.textContent = theme === 'dark' ? 'Dark' : 'Light';
  }

  chrome.storage.sync.get({ themePreference: 'dark' }, config => {
    applyTheme(config.themePreference);
  });

  chrome.storage.sync.get({ apiKey: '' }, config => {
    if (config.apiKey) {
      dot.classList.add('ok');
      text.textContent = 'Ready';
    } else {
      text.textContent = 'API key not set';
    }
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  themeToggle?.addEventListener('change', () => {
    const themePreference = themeToggle.checked ? 'dark' : 'light';
    applyTheme(themePreference);
    chrome.storage.sync.set({ themePreference });
  });
});
