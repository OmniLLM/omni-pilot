document.addEventListener('DOMContentLoaded', () => {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');

  // Auto-detect theme from OS/browser preference
  document.documentElement.setAttribute('data-theme',
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

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
});
