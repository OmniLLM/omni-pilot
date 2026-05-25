const DEFAULT_CONFIG = {
  endpoint: 'https://api.omnillm.com/v1',
  apiKey: '',
  model: 'claude-sonnet-4-5'
};

let fetchModelTimer = null;

// ── Model Fetch ──────────────────────────────────────────────────────────────

async function fetchModels(endpoint, apiKey) {
  const modelSelect = document.getElementById('modelSelect');
  const modelInput  = document.getElementById('model');
  const modelStatus = document.getElementById('modelStatus');
  const refreshBtn  = document.getElementById('refreshBtn');

  refreshBtn.classList.add('spinning');
  modelStatus.innerHTML = '<span class="model-status-dot"></span> Fetching models…';
  modelStatus.className = 'model-status loading';

  try {
    const url = endpoint.replace(/\/$/, '') + '/models';
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      if (endpoint.includes('omnillm.com')) headers['x-api-key'] = apiKey;
      else headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    const models = (data.data || data.models || [])
      .map(m => m.id || m.name)
      .filter(Boolean)
      .sort();

    if (!models.length) throw new Error('No models returned');

    const currentModel = modelInput.value || DEFAULT_CONFIG.model;
    modelSelect.innerHTML = '';
    models.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      if (id === currentModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });

    if (!models.includes(currentModel) && currentModel) {
      const opt = document.createElement('option');
      opt.value = currentModel;
      opt.textContent = currentModel;
      opt.selected = true;
      modelSelect.insertBefore(opt, modelSelect.firstChild);
    }

    modelSelect.style.display = 'block';
    modelInput.style.display  = 'none';
    modelStatus.innerHTML = `<span class="model-status-dot"></span> ${models.length} models`;
    modelStatus.className = 'model-status ok';

    modelSelect.onchange = () => { modelInput.value = modelSelect.value; };
    modelInput.value = modelSelect.value;

  } catch (e) {
    modelSelect.style.display = 'none';
    modelInput.style.display  = 'block';
    modelStatus.innerHTML = '<span class="model-status-dot"></span> Enter model name manually';
    modelStatus.className = 'model-status warn';
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

function scheduleFetch() {
  clearTimeout(fetchModelTimer);
  fetchModelTimer = setTimeout(() => {
    const endpoint = document.getElementById('endpoint').value.trim();
    const apiKey   = document.getElementById('apiKey').value.trim();
    if (endpoint) fetchModels(endpoint, apiKey);
  }, 700);
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(DEFAULT_CONFIG, config => {
    document.getElementById('endpoint').value = config.endpoint;
    document.getElementById('apiKey').value   = config.apiKey;
    document.getElementById('model').value    = config.model;
    if (config.endpoint) fetchModels(config.endpoint, config.apiKey);
  });

  // Auto-fetch on change
  document.getElementById('endpoint').addEventListener('input', scheduleFetch);
  document.getElementById('apiKey').addEventListener('input', scheduleFetch);

  // Manual refresh
  document.getElementById('refreshBtn').addEventListener('click', () => {
    const endpoint = document.getElementById('endpoint').value.trim();
    const apiKey   = document.getElementById('apiKey').value.trim();
    if (endpoint) fetchModels(endpoint, apiKey);
  });

  // Save
  document.getElementById('saveBtn').addEventListener('click', () => {
    const config = {
      endpoint: document.getElementById('endpoint').value.trim() || DEFAULT_CONFIG.endpoint,
      apiKey:   document.getElementById('apiKey').value.trim(),
      model:    document.getElementById('model').value.trim() || DEFAULT_CONFIG.model
    };

    chrome.storage.sync.set(config, () => {
      const status = document.getElementById('status');
      if (chrome.runtime.lastError) {
        status.textContent = 'Error: ' + chrome.runtime.lastError.message;
        status.className = 'status error';
      } else {
        status.textContent = '✓ Saved';
        status.className = 'status';
        setTimeout(() => { status.textContent = ''; }, 2500);
      }
    });
  });
});
