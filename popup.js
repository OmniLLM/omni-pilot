document.addEventListener('DOMContentLoaded', () => {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');

  // Use the active tab's page theme (written by content.js) and fall back to OS
  chrome.storage.local.get({ pageTheme: '' }, local => {
    const theme = local.pageTheme ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
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
});
