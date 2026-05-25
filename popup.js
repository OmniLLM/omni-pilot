document.addEventListener('DOMContentLoaded', () => {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');

  document.documentElement.setAttribute('data-theme', 'dark');

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
