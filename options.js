const DEFAULT_CONFIG = {
  endpoint: 'https://api.omnillm.com/v1',
  apiKey: '',
  model: 'claude-sonnet-4-5'
};

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(DEFAULT_CONFIG, config => {
    document.getElementById('endpoint').value = config.endpoint;
    document.getElementById('apiKey').value = config.apiKey;
    document.getElementById('model').value = config.model;
  });

  document.getElementById('saveBtn').addEventListener('click', () => {
    const config = {
      endpoint: document.getElementById('endpoint').value.trim() || DEFAULT_CONFIG.endpoint,
      apiKey: document.getElementById('apiKey').value.trim(),
      model: document.getElementById('model').value.trim() || DEFAULT_CONFIG.model
    };

    chrome.storage.sync.set(config, () => {
      const status = document.getElementById('status');
      if (chrome.runtime.lastError) {
        status.textContent = 'Error: ' + chrome.runtime.lastError.message;
        status.className = 'status error';
      } else {
        status.textContent = '✓ Settings saved';
        status.className = 'status';
        setTimeout(() => { status.textContent = ''; }, 3000);
      }
    });
  });
});
