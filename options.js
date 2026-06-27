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

const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'models', 'themePreference', 'apiShape', 'languagePreference', 'providerType', 'authMethod', 'providerConfigs', 'a2aServers'];
const A2A_TOKEN_STORAGE_KEY = 'a2aServerTokens';
const PROVIDER_CONFIG_FIELDS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape'];

let fetchModelTimer = null;
let currentLanguage = DEFAULT_CONFIG.languagePreference;
let providerConfigs = {};
let activeProviderType = PROVIDER_TYPES.CUSTOM;
let a2aServers = [];
let a2aServerTokens = {};

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

function createA2aServerId() {
  return `a2a-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeA2aEndpoint(endpoint) {
  return String(endpoint || '').trim().replace(/\/+$/, '');
}

function normalizeA2aServers(servers) {
  return (Array.isArray(servers) ? servers : [])
    .map(server => {
      if (!server || typeof server !== 'object') return null;
      const endpoint = normalizeA2aEndpoint(server.endpoint);
      const name = String(server.name || server.agentCard?.name || '').trim();
      if (!endpoint || !name) return null;
      return {
        ...server,
        id: String(server.id || '').trim() || createA2aServerId(),
        name,
        endpoint,
        enabled: server.enabled !== false
      };
    })
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getA2aTokenStorageArea() {
  return chrome.storage.local || chrome.storage.sync;
}

function getA2aStoredState(keys) {
  return new Promise(resolve => getA2aTokenStorageArea().get(keys, resolve));
}

function getA2aTokens() {
  return new Promise(resolve => {
    getA2aTokenStorageArea().get([A2A_TOKEN_STORAGE_KEY], stored => {
      resolve(stored?.[A2A_TOKEN_STORAGE_KEY] || {});
    });
  });
}

function getA2aServersStorageArea() {
  return chrome.storage.local || chrome.storage.sync;
}

function loadA2aServersFromStorage() {
  return new Promise(resolve => {
    getA2aServersStorageArea().get(['a2aServers'], local => {
      if (Array.isArray(local?.a2aServers)) {
        resolve({ servers: local.a2aServers, migratedFromSync: false });
        return;
      }
      // Migrate legacy servers from chrome.storage.sync (8KB per-item limit).
      chrome.storage.sync.get(['a2aServers'], synced => {
        resolve({
          servers: Array.isArray(synced?.a2aServers) ? synced.a2aServers : [],
          migratedFromSync: Array.isArray(synced?.a2aServers)
        });
      });
    });
  });
}

function saveA2aServers() {
  return new Promise(resolve => {
    getA2aServersStorageArea().set({ a2aServers }, resolve);
  });
}

async function initA2aServers() {
  const { servers: storedA2aServers, migratedFromSync } = await loadA2aServersFromStorage();
  a2aServers = normalizeA2aServers(storedA2aServers);
  if (migratedFromSync) {
    await saveA2aServers();
    await new Promise(resolve => chrome.storage.sync.remove(['a2aServers'], resolve));
  } else if (JSON.stringify(a2aServers) !== JSON.stringify(storedA2aServers)) {
    await saveA2aServers();
  }
  renderA2aServers();
}

function saveA2aTokens() {
  return new Promise(resolve => {
    getA2aTokenStorageArea().set({ [A2A_TOKEN_STORAGE_KEY]: a2aServerTokens }, resolve);
  });
}

function renderA2aServers(serverList = a2aServers) {
  const normalizedList = normalizeA2aServers(serverList);
  a2aServers = normalizedList;
  const list = document.getElementById('a2aServerList');
  if (!list) return;
  list.innerHTML = normalizedList.map(server => `
    <div class="a2a-server-item" data-server-id="${escapeHtml(server.id)}">
      <div class="a2a-server-meta">
        <div class="a2a-server-name">${escapeHtml(server.name)}</div>
        <div class="a2a-server-endpoint">${escapeHtml(server.endpoint)}</div>
      </div>
      <div class="a2a-server-actions">
        <button type="button" class="secondary-btn" data-action="discover" data-server-id="${escapeHtml(server.id)}">${escapeHtml(label('discover'))}</button>
        <button type="button" class="secondary-btn" data-action="remove" data-server-id="${escapeHtml(server.id)}">${escapeHtml(label('remove'))}</button>
      </div>
    </div>
  `).join('');
}

async function addA2aServerFromForm() {
  const nameInput = document.getElementById('a2aServerName');
  const endpointInput = document.getElementById('a2aServerEndpoint') || document.getElementById('a2aEndpoint');
  const tokenInput = document.getElementById('a2aServerToken') || document.getElementById('a2aToken');
  const status = document.getElementById('a2aStatus');
  const name = String(nameInput?.value || '').trim();
  const endpoint = normalizeA2aEndpoint(endpointInput?.value);

  if (!name || !endpoint) {
    if (status) {
      status.textContent = `${label('errorPrefix')} ${name ? 'A2A endpoint is required.' : 'A2A server name is required.'}`;
      status.className = 'status error';
    }
    return null;
  }

  const server = {
    id: createA2aServerId(),
    name,
    endpoint,
    enabled: true
  };
  const token = String(tokenInput?.value || '').trim();

  a2aServers = [...a2aServers, server];
  if (token) a2aServerTokens = { ...a2aServerTokens, [server.id]: token };

  await saveA2aServers();
  await saveA2aTokens();
  renderA2aServers();

  if (status) {
    status.textContent = label('saved');
    status.className = 'status';
  }
  if (nameInput) nameInput.value = '';
  if (endpointInput) endpointInput.value = '';
  if (tokenInput) tokenInput.value = '';
  return server;
}

async function discoverAndSaveA2aServer(serverOrId) {
  const serverId = typeof serverOrId === 'string' ? serverOrId : serverOrId?.id;
  const server = a2aServers.find(existing => existing.id === serverId) || (typeof serverOrId === 'object' ? serverOrId : null);
  if (!server?.id) return null;

  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'A2A_DISCOVER_SERVER', serverId: server.id }, result => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (result?.success === false) {
        reject(new Error(result.error || 'A2A discovery failed.'));
      } else {
        resolve(result || {});
      }
    });
  });
  const agentCard = response.agentCard || response;

  a2aServers = a2aServers.map(existing => existing.id === server.id ? {
    ...existing,
    name: agentCard.name || existing.name,
    endpoint: normalizeA2aEndpoint(agentCard.endpoint || agentCard.url || existing.endpoint),
    agentCard,
    lastDiscoveredAt: new Date().toISOString()
  } : existing);
  await saveA2aServers();
  renderA2aServers();
  return a2aServers.find(existing => existing.id === server.id);
}

async function removeA2aServer(serverId) {
  a2aServers = a2aServers.filter(server => server.id !== serverId);
  const { [serverId]: _removedToken, ...remainingTokens } = a2aServerTokens;
  a2aServerTokens = remainingTokens;
  await saveA2aServers();
  await saveA2aTokens();
  renderA2aServers();
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

  if (provider.showCopilot && typeof updateCopilotStatus === 'function') {
    Promise.resolve(updateCopilotStatus()).catch(() => {});
  }
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
    'copilotUserCode',
    'copilotVerificationUri',
    'copilotUserExpiry',
    'copilotPollInterval'
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
    if (stored.copilotUserCode) document.getElementById('copilotUserCode').textContent = stored.copilotUserCode;
    applyCopilotVerificationUri(stored.copilotVerificationUri);
    document.getElementById('copilotPollStatus').textContent = label('copilotWaiting');
    deviceFlow.style.display = '';
    startCopilotPolling(stored.copilotDeviceCode, stored.copilotPollInterval);
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
    if (!applyCopilotVerificationUri(response.verificationUri)) {
      throw new Error('Invalid GitHub verification URL.');
    }
    document.getElementById('copilotDeviceFlow').style.display = '';
    document.getElementById('copilotPollStatus').textContent = label('copilotCodeCopied');
    authBtn.style.display = 'none';

    try {
      await navigator.clipboard.writeText(response.userCode);
    } catch {
      // Clipboard API may fail in some contexts, ignore.
    }
    if (isSafeCopilotVerificationUri(response.verificationUri)) {
      chrome.tabs.create({ url: response.verificationUri });
    }

    startCopilotPolling(response.deviceCode || null, response.interval);
  } catch (e) {
    document.getElementById('copilotPollStatus').textContent = `${label('copilotError')} ${e.message}`;
    authBtn.style.display = '';
    authBtn.disabled = false;
    authBtn.textContent = label('copilotSignIn');
  }
}

function getCopilotPollDelay(interval) {
  return Math.max(1, Number(interval) || 5) * 1000;
}

function isSafeCopilotVerificationUri(uri) {
  try {
    const parsed = new URL(String(uri || ''));
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && parsed.pathname === '/login/device';
  } catch {
    return false;
  }
}

function applyCopilotVerificationUri(uri) {
  const verifyLink = document.getElementById('copilotVerifyLink');
  if (!verifyLink || !isSafeCopilotVerificationUri(uri)) return false;
  verifyLink.href = uri;
  verifyLink.textContent = uri;
  return true;
}

function startCopilotPolling(deviceCode, interval) {
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
      document.getElementById('copilotAuthBtn').onclick = startCopilotAuth;
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
      } else if (result.status === 'pending' && result.slowDown) {
        startCopilotPolling(code, result.interval);
      } else if (result.status === 'failed') {
        stopCopilotPolling();
        document.getElementById('copilotPollStatus').textContent = `${label('copilotFailed')} ${result.error || ''}`.trim();
        document.getElementById('copilotAuthBtn').style.display = '';
        document.getElementById('copilotAuthBtn').disabled = false;
        document.getElementById('copilotAuthBtn').textContent = label('copilotSignIn');
        document.getElementById('copilotAuthBtn').onclick = startCopilotAuth;
      }
    } catch {
      // Keep polling transient extension-message failures.
    }
  }, getCopilotPollDelay(interval));
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
      ...(storedConfig.providerConfigs || {}),
      [providerType]: {
        ...(storedConfig.providerConfigs?.[providerType] || {}),
        ...Object.fromEntries(PROVIDER_CONFIG_FIELDS.map(field => [field, config[field]]))
      }
    };
    initA2aServers();
    getA2aTokens().then(tokens => {
      a2aServerTokens = tokens;
      renderA2aServers();
    });
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
  document.getElementById('addA2aServerBtn')?.addEventListener('click', () => {
    addA2aServerFromForm();
  });
  document.getElementById('a2aServerList')?.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-action][data-server-id]');
    if (!button) return;
    const serverId = button.getAttribute('data-server-id');
    if (button.getAttribute('data-action') === 'discover') {
      discoverAndSaveA2aServer(serverId).catch(error => {
        const status = document.getElementById('a2aStatus');
        if (status) {
          status.textContent = `${label('errorPrefix')} ${error.message}`;
          status.className = 'status error';
        }
      });
    } else if (button.getAttribute('data-action') === 'remove') {
      removeA2aServer(serverId);
    }
  });
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
