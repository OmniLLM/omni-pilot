document.addEventListener('DOMContentLoaded', () => {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('btnDark').classList.toggle('active', theme === 'dark');
    document.getElementById('btnLight').classList.toggle('active', theme === 'light');
  }

  chrome.storage.sync.get({ apiKey: '', theme: 'dark' }, config => {
    applyTheme(config.theme || 'dark');
    if (config.apiKey) {
      dot.classList.add('ok');
      text.textContent = 'Ready';
    } else {
      text.textContent = 'API key not set';
    }
  });

  document.getElementById('btnDark').addEventListener('click', () => {
    applyTheme('dark');
    chrome.storage.sync.set({ theme: 'dark' });
  });

  document.getElementById('btnLight').addEventListener('click', () => {
    applyTheme('light');
    chrome.storage.sync.set({ theme: 'light' });
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
