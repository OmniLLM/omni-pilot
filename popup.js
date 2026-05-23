document.addEventListener('DOMContentLoaded', () => {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');

  chrome.storage.sync.get({ apiKey: '' }, config => {
    if (config.apiKey) {
      dot.classList.add('ok');
      text.textContent = 'Ready — select text to use';
    } else {
      text.textContent = 'API key not configured';
    }
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
