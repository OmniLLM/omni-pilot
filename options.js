const PROVIDER_TYPES = {
  CUSTOM: 'custom-provider',
  GITHUB_COPILOT: 'github-copilot',
  AZURE_FOUNDRY: 'azure-foundry'
};

const PROVIDERS = {
  [PROVIDER_TYPES.GITHUB_COPILOT]: {
    showEndpoint: false,
    showApiKey: false,
    showApiShape: false,
    showCopilot: true,
    fetchModelsViaBackground: true
  },
  [PROVIDER_TYPES.CUSTOM]: {
    showEndpoint: true,
    showApiKey: true,
    showApiShape: true,
    showCopilot: false,
    fetchModelsViaBackground: false
  },
  [PROVIDER_TYPES.AZURE_FOUNDRY]: {
    showEndpoint: true,
    showApiKey: true,
    showApiShape: true,
    showCopilot: false,
    fetchModelsViaBackground: false,
    usesManualModels: true
  }
};

const DEFAULT_CONFIG = {
  endpoint: 'https://api.omnillm.com/v1',
  apiKey: '',
  model: 'claude-sonnet-4-5',
  models: '',
  themePreference: 'dark',
  languagePreference: 'en',
  apiShape: 'openai-compatible',
  providerType: PROVIDER_TYPES.CUSTOM
};

const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'models', 'themePreference', 'apiShape', 'languagePreference', 'providerType', 'authMethod', 'providerConfigs'];
const PROVIDER_CONFIG_FIELDS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape'];

let fetchModelTimer = null;
let currentLanguage = DEFAULT_CONFIG.languagePreference;
let providerConfigs = {};
let activeProviderType = PROVIDER_TYPES.CUSTOM;

function label(key) {
  return OmniPilotI18n.t(key, currentLanguage);
}

function applyLanguage(language) {
  currentLanguage = OmniPilotI18n.normalizeLanguage(language);
  document.documentElement.lang = currentLanguage;
  document.getElementById('languageSelect').value = currentLanguage;
  OmniPilotI18n.applyTranslations(document, currentLanguage);
}

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

function parseManualModels(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map(model => model.trim())
    .filter(Boolean);
}

async function fetchModels(endpoint, apiKey, apiShape, providerType = PROVIDER_TYPES.CUSTOM) {
  const modelSelect = document.getElementById('modelSelect');
  const modelInput  = document.getElementById('model');
  const modelsInput = document.getElementById('models');
  const editModelsBtn = document.getElementById('editModelsBtn');
  const modelStatus = document.getElementById('modelStatus');
  const refreshBtn  = document.getElementById('refreshBtn');

  refreshBtn.classList.add('spinning');
  modelStatus.innerHTML = `<span class="model-status-dot"></span> ${label('fetchingModels')}`;
  modelStatus.className = 'model-status loading';

  try {
    let models;

    if (getProviderDefinition(providerType).usesManualModels) {
      models = parseManualModels(document.getElementById('models')?.value || modelInput.value);
    } else if (getProviderDefinition(providerType).fetchModelsViaBackground) {
      models = await getModelsFromBackground();
    } else {
      const url = normalizeEndpoint(endpoint) + '/models';
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) {
        if (apiShape === 'anthropic-messages') headers['x-api-key'] = apiKey;
        else headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const resp = await fetch(url, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      models = (data.data || data.models || [])
        .map(m => m.id || m.name)
        .filter(Boolean)
        .sort();
    }

    if (!models.length) throw new Error('No models returned');

    const currentModel = modelInput.value || DEFAULT_CONFIG.model;
    modelSelect.innerHTML = '';
    if (Array.isArray(modelSelect.options)) {
      modelSelect.options.length = 0;
    }
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
    if (modelsInput) modelsInput.style.display = 'none';
    if (editModelsBtn) editModelsBtn.style.display = getProviderDefinition(providerType).usesManualModels ? '' : 'none';
    modelStatus.innerHTML = `<span class="model-status-dot"></span> ${models.length} models`;
    modelStatus.className = 'model-status ok';

    modelSelect.onchange = () => { modelInput.value = modelSelect.value; };
    modelInput.value = modelSelect.value;

  } catch (e) {
    modelSelect.style.display = 'none';
    modelInput.style.display  = 'block';
    if (modelsInput) modelsInput.style.display = 'none';
    if (editModelsBtn) editModelsBtn.style.display = 'none';
    modelStatus.innerHTML = `<span class="model-status-dot"></span> ${label('enterModelManually')}`;
    modelStatus.className = 'model-status warn';
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

function getModelsFromBackground() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_MODELS' }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response?.models || []);
      }
    });
  });
}

function normalizeProviderType(value, legacyAuthMethod) {
  if (PROVIDERS[value]) return value;
  if (legacyAuthMethod === PROVIDER_TYPES.GITHUB_COPILOT) return PROVIDER_TYPES.GITHUB_COPILOT;
  return PROVIDER_TYPES.CUSTOM;
}

function getProviderDefinition(providerType) {
  return PROVIDERS[normalizeProviderType(providerType)] || PROVIDERS[PROVIDER_TYPES.CUSTOM];
}

function getSelectedProviderType() {
  const selector = document.getElementById('providerType') || document.getElementById('authMethod');
  const legacySelector = document.getElementById('authMethod');
  return normalizeProviderType(selector?.value, legacySelector?.value);
}

function getFormProviderConfig() {
  const modelValue = document.getElementById('model').value.trim();
  return {
    endpoint: document.getElementById('endpoint').value.trim() || DEFAULT_CONFIG.endpoint,
    apiKey: document.getElementById('apiKey').value.trim(),
    model: modelValue || DEFAULT_CONFIG.model,
    models: (document.getElementById('models')?.value || modelValue).trim(),
    apiShape: document.getElementById('apiShape').value || DEFAULT_CONFIG.apiShape
  };
}

function getProviderConfig(providerType) {
  return {
    ...DEFAULT_CONFIG,
    ...(providerConfigs[providerType] || {})
  };
}

function setProviderFormConfig(config) {
  document.getElementById('endpoint').value = config.endpoint;
  document.getElementById('apiKey').value = config.apiKey;
  document.getElementById('model').value = config.model;
  const modelsElement = document.getElementById('models');
  if (modelsElement) modelsElement.value = config.models || config.model;
  document.getElementById('apiShape').value = config.apiShape;
}

function setElementDisplay(id, display) {
  const element = document.getElementById(id);
  if (element) element.style.display = display;
}

function showManualModelsEditor() {
  const modelSelect = document.getElementById('modelSelect');
  const modelInput = document.getElementById('model');
  const modelsInput = document.getElementById('models');
  const editModelsBtn = document.getElementById('editModelsBtn');

  if (modelSelect) modelSelect.style.display = 'none';
  if (modelInput) modelInput.style.display = 'none';
  if (modelsInput) modelsInput.style.display = 'block';
  if (editModelsBtn) editModelsBtn.style.display = 'none';
}

function updateProviderTypeUI(providerType) {
  const provider = getProviderDefinition(providerType);

  setElementDisplay('apiKeyField', provider.showApiKey ? '' : 'none');
  setElementDisplay('copilotSection', provider.showCopilot ? '' : 'none');
  setElementDisplay('endpointField', provider.showEndpoint ? '' : 'none');
  setElementDisplay('apiShapeField', provider.showApiShape ? '' : 'none');
  setElementDisplay('modelCard', '');

  if (provider.usesManualModels) {
    showManualModelsEditor();
  } else {
    setElementDisplay('models', 'none');
    setElementDisplay('editModelsBtn', 'none');
  }

  if (provider.showCopilot && typeof updateCopilotStatus === 'function') updateCopilotStatus();
}

function updateAuthMethodUI(authMethod) {
  updateProviderTypeUI(normalizeProviderType(authMethod, authMethod));
}

function getCopilotStorageArea() {
  return chrome.storage.local || chrome.storage.sync;
}

function getCopilotStoredState(keys) {
  return new Promise(resolve => getCopilotStorageArea().get(keys, resolve));
}

let copilotPollTimer = null;

async function updateCopilotStatus() {
  const stored = await getCopilotStoredState([
    'copilotGithubToken',
    'copilotDeviceCode',
    'copilotUserExpiry'
  ]);

  const statusDot = document.getElementById('copilotStatusDot');
  const statusText = document.getElementById('copilotStatusText');
  const authBtn = document.getElementById('copilotAuthBtn');
  const deviceFlow = document.getElementById('copilotDeviceFlow');

  if (stored.copilotGithubToken) {
    statusDot.classList.add('connected');
    statusText.textContent = label('copilotConnected');
    authBtn.textContent = label('copilotSignOut');
    authBtn.style.display = '';
    authBtn.disabled = false;
    authBtn.onclick = signOutCopilot;
    deviceFlow.style.display = 'none';
    stopCopilotPolling();
  } else if (stored.copilotDeviceCode && stored.copilotUserExpiry > Date.now()) {
    statusDot.classList.remove('connected');
    statusText.textContent = label('copilotNotConnected');
    authBtn.style.display = 'none';
    deviceFlow.style.display = '';
    startCopilotPolling(stored.copilotDeviceCode);
  } else {
    statusDot.classList.remove('connected');
    statusText.textContent = label('copilotNotConnected');
    authBtn.textContent = label('copilotSignIn');
    authBtn.style.display = '';
    authBtn.disabled = false;
    authBtn.onclick = startCopilotAuth;
    deviceFlow.style.display = 'none';
    stopCopilotPolling();
  }
}

async function startCopilotAuth() {
  const authBtn = document.getElementById('copilotAuthBtn');
  authBtn.disabled = true;
  authBtn.textContent = label('copilotStarting');

  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'COPILOT_START_DEVICE_FLOW' }, result => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (result?.success === false) {
          reject(new Error(result.error));
        } else if (result?.status === 'failed') {
          reject(new Error(result.error || 'Failed to start GitHub Copilot sign-in.'));
        } else {
          resolve(result);
        }
      });
    });

    document.getElementById('copilotUserCode').textContent = response.userCode;
    document.getElementById('copilotVerifyLink').href = response.verificationUri;
    document.getElementById('copilotVerifyLink').textContent = response.verificationUri;
    document.getElementById('copilotDeviceFlow').style.display = '';
    document.getElementById('copilotPollStatus').textContent = label('copilotCodeCopied');
    authBtn.style.display = 'none';

    try {
      await navigator.clipboard.writeText(response.userCode);
    } catch {
      // Clipboard API may fail in some contexts, ignore.
    }
    chrome.tabs.create({ url: response.verificationUri });

    startCopilotPolling(response.deviceCode || null);
  } catch (e) {
    document.getElementById('copilotPollStatus').textContent = `${label('copilotError')} ${e.message}`;
    authBtn.style.display = '';
    authBtn.disabled = false;
    authBtn.textContent = label('copilotSignIn');
  }
}

function startCopilotPolling(deviceCode) {
  stopCopilotPolling();

  copilotPollTimer = setInterval(async () => {
    const stored = await getCopilotStoredState(['copilotDeviceCode', 'copilotUserExpiry']);
    const code = deviceCode || stored.copilotDeviceCode;

    if (!code || (stored.copilotUserExpiry && stored.copilotUserExpiry <= Date.now())) {
      stopCopilotPolling();
      document.getElementById('copilotPollStatus').textContent = label('copilotExpired');
      document.getElementById('copilotDeviceFlow').style.display = 'none';
      document.getElementById('copilotAuthBtn').style.display = '';
      document.getElementById('copilotAuthBtn').disabled = false;
      document.getElementById('copilotAuthBtn').textContent = label('copilotSignIn');
      return;
    }

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'COPILOT_POLL_TOKEN', deviceCode: code }, res => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(res);
        });
      });

      if (result.status === 'success') {
        stopCopilotPolling();
        document.getElementById('copilotDeviceFlow').style.display = 'none';
        await updateCopilotStatus();
        scheduleFetch();
      } else if (result.status === 'failed') {
        stopCopilotPolling();
        document.getElementById('copilotPollStatus').textContent = label('copilotFailed');
      }
    } catch {
      // Keep polling transient extension-message failures.
    }
  }, 5000);
}

function stopCopilotPolling() {
  if (copilotPollTimer) {
    clearInterval(copilotPollTimer);
    copilotPollTimer = null;
  }
}

async function signOutCopilot() {
  await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: 'COPILOT_CLEAR_AUTH' }, resolve)
  );
  await updateCopilotStatus();
}

function scheduleFetch() {
  clearTimeout(fetchModelTimer);
  fetchModelTimer = setTimeout(() => {
    const endpoint = document.getElementById('endpoint').value.trim();
    const apiKey   = document.getElementById('apiKey').value.trim();
    const apiShape = getSelectedApiShape(endpoint);
    const providerType = getSelectedProviderType();
    if (endpoint || getProviderDefinition(providerType).fetchModelsViaBackground) fetchModels(endpoint, apiKey, apiShape, providerType);
  }, 700);
}

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(STORAGE_KEYS, storedConfig => {
    const config = { ...DEFAULT_CONFIG, ...storedConfig };
    const providerType = normalizeProviderType(storedConfig.providerType, storedConfig.authMethod);
    activeProviderType = providerType;
    providerConfigs = {
      [providerType]: Object.fromEntries(PROVIDER_CONFIG_FIELDS.map(field => [field, config[field]])),
      ...(storedConfig.providerConfigs || {})
    };
    const activeProviderConfig = getProviderConfig(providerType);
    const apiShape = activeProviderConfig.apiShape || (activeProviderConfig.endpoint ? inferApiShape(activeProviderConfig.endpoint) : DEFAULT_CONFIG.apiShape);
    activeProviderConfig.apiShape = apiShape;

    document.documentElement.setAttribute('data-theme', config.themePreference);
    applyLanguage(config.languagePreference);
    setProviderFormConfig(activeProviderConfig);
    const providerTypeElement = document.getElementById('providerType') || document.getElementById('authMethod');
    if (providerTypeElement) providerTypeElement.value = providerType;
    const authMethodElement = document.getElementById('authMethod');
    if (authMethodElement) authMethodElement.value = providerType;
    updateProviderTypeUI(providerType);
    if (activeProviderConfig.endpoint || getProviderDefinition(providerType).fetchModelsViaBackground) fetchModels(activeProviderConfig.endpoint, activeProviderConfig.apiKey, apiShape, providerType);
  });

  // Auto-fetch on change
  document.getElementById('endpoint').addEventListener('input', scheduleFetch);
  document.getElementById('apiKey').addEventListener('input', scheduleFetch);
  document.getElementById('apiShape').addEventListener('change', scheduleFetch);
  document.getElementById('models')?.addEventListener('input', () => {
    document.getElementById('modelStatus').innerHTML = `<span class="model-status-dot"></span> ${label('enterModelManually')}`;
    document.getElementById('modelStatus').className = 'model-status warn';
  });
  document.getElementById('editModelsBtn')?.addEventListener('click', showManualModelsEditor);
  document.getElementById('languageSelect').addEventListener('change', () => {
    const languagePreference = OmniPilotI18n.normalizeLanguage(document.getElementById('languageSelect').value);
    applyLanguage(languagePreference);
    chrome.storage.sync.set({ languagePreference });
  });

  const providerTypeElement = document.getElementById('providerType') || document.getElementById('authMethod');
  const handleProviderTypeChange = () => {
    providerConfigs[activeProviderType] = getFormProviderConfig();

    const providerType = normalizeProviderType(providerTypeElement.value, providerTypeElement.value);
    activeProviderType = providerType;
    setProviderFormConfig(getProviderConfig(providerType));
    updateProviderTypeUI(providerType);
    chrome.storage.sync.set({ providerType, providerConfigs });
    scheduleFetch();
  };
  if (providerTypeElement) {
    providerTypeElement.addEventListener('change', handleProviderTypeChange);
  }
  const legacyAuthMethodElement = document.getElementById('authMethod');
  if (legacyAuthMethodElement && legacyAuthMethodElement !== providerTypeElement) {
    legacyAuthMethodElement.addEventListener('change', () => {
      providerTypeElement.value = normalizeProviderType(legacyAuthMethodElement.value, legacyAuthMethodElement.value);
      handleProviderTypeChange();
    });
  }

  // Manual refresh
  document.getElementById('refreshBtn').addEventListener('click', () => {
    const endpoint = document.getElementById('endpoint').value.trim();
    const apiKey   = document.getElementById('apiKey').value.trim();
    const apiShape = getSelectedApiShape(endpoint);
    const providerType = getSelectedProviderType();
    if (endpoint || getProviderDefinition(providerType).fetchModelsViaBackground) fetchModels(endpoint, apiKey, apiShape, providerType);
  });

  // Save
  document.getElementById('saveBtn').addEventListener('click', () => {
    const providerType = getSelectedProviderType();
    const providerConfig = getFormProviderConfig();
    providerConfigs[providerType] = providerConfig;

    const config = {
      ...providerConfig,
      providerType,
      providerConfigs,
      languagePreference: OmniPilotI18n.normalizeLanguage(document.getElementById('languageSelect').value)
    };

    chrome.storage.sync.set(config, () => {
      const status = document.getElementById('status');
      if (chrome.runtime.lastError) {
        status.textContent = label('errorPrefix') + ' ' + chrome.runtime.lastError.message;
        status.className = 'status error';
      } else {
        status.textContent = label('saved');
        status.className = 'status';
        setTimeout(() => { status.textContent = ''; }, 2500);
      }
    });
  });
});
