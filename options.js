const DEFAULT_CONFIG = {
  endpoint: 'https://api.omnillm.com/v1',
  apiKey: '',
  model: 'claude-sonnet-4-5',
  themePreference: 'dark',
  apiShape: 'openai-compatible'
};

const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'themePreference', 'apiShape'];

let fetchModelTimer = null;

// ── Model Fetch ──────────────────────────────────────────────────────────────

function inferApiShape(endpoint) {
  return endpoint && endpoint.includes('omnillm.com')
    ? 'anthropic-messages'
    : 'openai-compatible';
}

function getSelectedApiShape(endpoint) {
  const selector = document.getElementById('apiShape');
  return selector?.value || inferApiShape(endpoint);
}

function normalizeEndpoint(endpoint) {
  const normalized = (endpoint || DEFAULT_CONFIG.endpoint).replace(/\/$/, '');
  return /^https?:\/\/[^/]+$/i.test(normalized) ? `${normalized}/v1` : normalized;
}

async function fetchModels(endpoint, apiKey, apiShape = getSelectedApiShape(endpoint)) {
  const modelSelect = document.getElementById('modelSelect');
  const modelInput  = document.getElementById('model');
  const modelStatus = document.getElementById('modelStatus');
  const refreshBtn  = document.getElementById('refreshBtn');

  refreshBtn.classList.add('spinning');
  modelStatus.innerHTML = '<span class="model-status-dot"></span> Fetching models…';
  modelStatus.className = 'model-status loading';

  try {
    const url = normalizeEndpoint(endpoint) + '/models';
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      if (apiShape === 'anthropic-messages') headers['x-api-key'] = apiKey;
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
    const apiShape = getSelectedApiShape(endpoint);
    if (endpoint) fetchModels(endpoint, apiKey, apiShape);
  }, 700);
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(STORAGE_KEYS, storedConfig => {
    const config = { ...DEFAULT_CONFIG, ...storedConfig };
    const apiShape = storedConfig.apiShape || (storedConfig.endpoint ? inferApiShape(storedConfig.endpoint) : DEFAULT_CONFIG.apiShape);

    document.documentElement.setAttribute('data-theme', config.themePreference);
    document.getElementById('endpoint').value = config.endpoint;
    document.getElementById('apiKey').value   = config.apiKey;
    document.getElementById('model').value    = config.model;
    document.getElementById('apiShape').value = apiShape;
    if (config.endpoint) fetchModels(config.endpoint, config.apiKey, apiShape);
  });

  // Auto-fetch on change
  document.getElementById('endpoint').addEventListener('input', scheduleFetch);
  document.getElementById('apiKey').addEventListener('input', scheduleFetch);
  document.getElementById('apiShape').addEventListener('change', scheduleFetch);

  // Manual refresh
  document.getElementById('refreshBtn').addEventListener('click', () => {
    const endpoint = document.getElementById('endpoint').value.trim();
    const apiKey   = document.getElementById('apiKey').value.trim();
    const apiShape = getSelectedApiShape(endpoint);
    if (endpoint) fetchModels(endpoint, apiKey, apiShape);
  });

  // Save
  document.getElementById('saveBtn').addEventListener('click', () => {
    const config = {
      endpoint: document.getElementById('endpoint').value.trim() || DEFAULT_CONFIG.endpoint,
      apiKey:   document.getElementById('apiKey').value.trim(),
      model:    document.getElementById('model').value.trim() || DEFAULT_CONFIG.model,
      apiShape: document.getElementById('apiShape').value || DEFAULT_CONFIG.apiShape
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
