import { t, normalizeLanguage, applyTranslations } from '../utils/i18n.mjs';
import { createAppearanceController } from '../utils/appearance.mjs';

// The agent list region is rendered with Preact + htm. The runtime is inlined
// ahead of this file by build.mjs (see the `needsPreact` entry flag), so
// `htmPreact` is a plain global here — no bundler, no module loader.
//
// Only that region is component-rendered. The rest of this page is static
// markup in index.html driven by the getElementById accessors below.
const { html, render } = htmPreact;

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

const POPUP_INITIAL_SIZE_LIMITS = {
  width: { min: 300, max: 1200 },
  height: { min: 180, max: 900 }
};

const DEFAULT_CONFIG = {
  endpoint: 'https://api.omnillm.com/v1',
  apiKey: '',
  model: 'claude-sonnet-4-5',
  models: '',
  languagePreference: 'en',
  apiShape: 'openai-compatible',
  providerType: PROVIDER_TYPES.CUSTOM,
  a2aAutoRoute: true,
  memoryEnabled: true,
  popupInitialWidth: 640,
  popupInitialHeight: 400,
  responseTimeoutMs: RESPONSE_TIMEOUT_DEFAULT_MS
};

const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape', 'languagePreference', 'providerType', 'authMethod', 'providerConfigs', 'a2aServers', 'a2aAutoRoute', 'memoryEnabled', 'popupInitialWidth', 'popupInitialHeight', 'responseTimeoutMs'];
const A2A_TOKEN_STORAGE_KEY = 'a2aServerTokens';
const PROVIDER_CONFIG_FIELDS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape'];

let fetchModelTimer = null;
let currentLanguage = DEFAULT_CONFIG.languagePreference;
let providerConfigs = {};
let activeProviderType = PROVIDER_TYPES.CUSTOM;
let a2aServers = [];
let a2aServerTokens = {};
/** Identifier of the agent whose inline edit form is open, or null. */
let editingA2aServerId = null;

function label(key) {
  return t(key, currentLanguage);
}

function applyLanguage(language) {
  currentLanguage = normalizeLanguage(language);
  document.documentElement.lang = currentLanguage;
  document.getElementById('languageSelect').value = currentLanguage;
  applyTranslations(document, currentLanguage);
}

function initAppearance() {
  const themeSelect = document.getElementById('themePreferenceSelect');
  const styleRadios = Array.from(document.querySelectorAll('input[name="visualStylePreference"]'));
  const previews = Array.from(document.querySelectorAll('[data-appearance-preview]'));

  const controller = createAppearanceController({
    root: document.documentElement,
    surface: 'options',
    readPreferences: (defaults, callback) => chrome.storage.sync.get(defaults, callback),
    subscribeToChanges: listener => {
      if (!chrome.storage.onChanged?.addListener) return null;
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener?.(listener);
    },
    onApply: state => {
      if (themeSelect) themeSelect.value = state.themePreference;
      styleRadios.forEach(radio => { radio.checked = radio.value === state.visualStylePreference; });
      previews.forEach(preview => preview.setAttribute('data-theme', state.resolvedTheme));
    }
  });

  themeSelect?.addEventListener('change', () => {
    const themePreference = themeSelect.value;
    controller.update({ themePreference });
    chrome.storage.sync.set({ themePreference });
  });

  styleRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const visualStylePreference = radio.value;
      controller.update({ visualStylePreference });
      chrome.storage.sync.set({ visualStylePreference });
    });
  });

  return controller;
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

function normalizePopupInitialSize(value, axis) {
  const limits = POPUP_INITIAL_SIZE_LIMITS[axis];
  const fallback = axis === 'width' ? DEFAULT_CONFIG.popupInitialWidth : DEFAULT_CONFIG.popupInitialHeight;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(limits.min, Math.min(limits.max, parsed));
}

function setPopupInitialSizeFields(config) {
  const widthInput = document.getElementById('popupInitialWidth');
  const heightInput = document.getElementById('popupInitialHeight');
  if (widthInput) widthInput.value = String(normalizePopupInitialSize(config.popupInitialWidth, 'width'));
  if (heightInput) heightInput.value = String(normalizePopupInitialSize(config.popupInitialHeight, 'height'));
}

function getPopupInitialSizeConfig() {
  return {
    popupInitialWidth: normalizePopupInitialSize(document.getElementById('popupInitialWidth')?.value, 'width'),
    popupInitialHeight: normalizePopupInitialSize(document.getElementById('popupInitialHeight')?.value, 'height')
  };
}

function setResponseTimeoutField(config) {
  const input = document.getElementById('responseTimeout');
  if (input) input.value = String(responseTimeoutMsToMinutes(config.responseTimeoutMs));
}

function getResponseTimeoutConfig() {
  return {
    responseTimeoutMs: responseTimeoutMinutesToMs(document.getElementById('responseTimeout')?.value)
  };
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
        enabled: server.enabled !== false,
        disabledSkillIds: Array.from(new Set(
          Array.isArray(server.disabledSkillIds)
            ? server.disabledSkillIds.map(v => String(v || '').trim()).filter(Boolean)
            : []
        ))
      };
    })
    .filter(Boolean);
}

// ── Per-skill enable/disable helpers ──

/** Ephemeral set tracking which server skill panels are expanded in the UI. */
const expandedA2aSkillPanels = new Set();

/** Return all valid skills from an A2A server's discovered agent card. */
function getA2aServerSkills(server) {
  return Array.isArray(server?.agentCard?.skills)
    ? server.agentCard.skills.filter(skill => skill && typeof skill === 'object' && (skill.id || skill.name))
    : [];
}

/** Check whether a specific skill is enabled for a server. */
function isA2aSkillEnabled(server, skillId) {
  const disabled = new Set(server.disabledSkillIds || []);
  return !disabled.has(String(skillId || ''));
}

/** Toggle a single skill's enabled state and persist immediately. */
async function setA2aSkillEnabled(serverId, skillId, enabled) {
  let changed = false;
  a2aServers = a2aServers.map(server => {
    if (server.id !== serverId) return server;
    const disabled = new Set(server.disabledSkillIds || []);
    const wasEnabled = !disabled.has(skillId);
    if (wasEnabled === enabled) return server;
    changed = true;
    if (enabled) disabled.delete(skillId);
    else disabled.add(skillId);
    return { ...server, disabledSkillIds: [...disabled] };
  });
  if (!changed) return;
  await saveA2aServers();
  renderA2aServers();
}

/** Enable or disable all skills for a server at once. */
async function setAllA2aSkillsEnabled(serverId, enabled) {
  let changed = false;
  a2aServers = a2aServers.map(server => {
    if (server.id !== serverId) return server;
    const skills = getA2aServerSkills(server);
    if (!skills.length) return server;
    if (enabled) {
      if (!server.disabledSkillIds?.length) return server;
      changed = true;
      return { ...server, disabledSkillIds: [] };
    }
    const allIds = skills.map(s => String(s.id || s.name));
    const disabled = new Set(server.disabledSkillIds || []);
    if (allIds.every(id => disabled.has(id))) return server;
    changed = true;
    return { ...server, disabledSkillIds: allIds };
  });
  if (!changed) return;
  await saveA2aServers();
  renderA2aServers();
}

function A2aSkillRow({ server, skill }) {
  const sid = String(skill.id || skill.name);
  const checked = !new Set(server.disabledSkillIds || []).has(sid);
  const displayName = skill.name || skill.id || '';
  const showId = Boolean(skill.name && skill.id && skill.name !== skill.id);
  const desc = skill.description ? skill.description.slice(0, 120) : '';
  return html`
    <label class="a2a-skill-row">
      <input
        type="checkbox"
        checked=${checked}
        data-skill-toggle=${''}
        data-server-id=${server.id}
        data-skill-id=${sid}
      />
      <span class="a2a-skill-meta">
        <span class="a2a-skill-name">${displayName}</span>
        ${showId ? html`<span class="a2a-skill-id">${skill.id}</span>` : null}
        ${desc ? html`<span class="a2a-skill-desc">${desc}</span>` : null}
      </span>
    </label>`;
}

function A2aSkillControls({ server }) {
  const skills = getA2aServerSkills(server);
  if (!server.agentCard) return null;
  if (skills.length === 0) {
    return html`
      <div class="a2a-skill-controls">
        <span class="a2a-skill-summary">No skills discovered</span>
      </div>`;
  }

  const disabledSet = new Set(server.disabledSkillIds || []);
  const enabledCount = skills.filter(s => !disabledSet.has(String(s.id || s.name))).length;
  const panelExpanded = expandedA2aSkillPanels.has(server.id);

  return html`
    <div class="a2a-skill-controls">
      <div class="a2a-skill-summary-row">
        <span class="a2a-skill-summary">Skills: ${enabledCount} of ${skills.length} enabled</span>
        <button
          type="button"
          class="a2a-skill-toggle-btn"
          data-action="toggle-skills-panel"
          data-server-id=${server.id}
        >${panelExpanded ? 'Hide' : 'Show'}</button>
      </div>
      ${panelExpanded ? html`
        <div class="a2a-skill-panel">
          <div class="a2a-skill-list">
            ${skills.map(skill => html`
              <${A2aSkillRow} key=${String(skill.id || skill.name)} server=${server} skill=${skill} />`)}
          </div>
          <div class="a2a-skill-actions">
            <button
              type="button"
              class="a2a-skill-toggle-btn"
              data-action="enable-all-skills"
              data-server-id=${server.id}
            >Enable all</button>
            <button
              type="button"
              class="a2a-skill-toggle-btn"
              data-action="disable-all-skills"
              data-server-id=${server.id}
            >Disable all</button>
          </div>
          ${enabledCount === 0 ? html`
            <div class="a2a-skill-hint">No skills enabled — this agent will not expose any tools.</div>` : null}
        </div>` : null}
    </div>`;
}

function A2aServerItem({ server }) {
  const disabled = server.enabled === false;
  const toggleAction = disabled ? 'enable' : 'disable';
  const toggleLabel = disabled ? label('enable') : label('disable');
  return html`
    <div
      class=${`a2a-server-item${disabled ? ' disabled' : ''}`}
      data-server-id=${server.id}
    >
      <div class="a2a-server-meta">
        <div class="a2a-server-name">
          <span class="a2a-health-dot" data-health-for=${server.id} title="Checking…"></span>
          ${server.name}
          ${disabled ? html`<span class="disabled-label">${label('disabled')}</span>` : null}
        </div>
        <div class="a2a-server-endpoint">${server.endpoint}</div>
      </div>
      <div class="a2a-server-actions">
        <button type="button" class="secondary-btn" data-action="edit" data-server-id=${server.id}>${label('edit')}</button>
        <button type="button" class="secondary-btn" data-action=${toggleAction} data-server-id=${server.id}>${toggleLabel}</button>
        <button type="button" class="secondary-btn" data-action="health" data-server-id=${server.id} data-endpoint=${server.endpoint}>Health</button>
        <button type="button" class="secondary-btn" data-action="discover" data-server-id=${server.id}>${label('discover')}</button>
        <button type="button" class="secondary-btn" data-action="remove" data-server-id=${server.id}>${label('remove')}</button>
      </div>
      <${A2aSkillControls} server=${server} />
    </div>`;
}

function A2aEditForm({ server, token }) {
  return html`
    <div class="a2a-edit-form" data-server-id=${server.id}>
      <div class="field">
        <label>${label('a2aServerName')}</label>
        <input type="text" class="a2a-edit-name" value=${server.name} />
      </div>
      <div class="field">
        <label>${label('a2aEndpoint')}</label>
        <input type="text" class="a2a-edit-endpoint" value=${server.endpoint} />
      </div>
      <div class="field">
        <label>${label('a2aToken')}</label>
        <input
          type="password"
          class="a2a-edit-token"
          value=${token}
          placeholder=${label('a2aTokenUnchanged')}
        />
      </div>
      <div class="a2a-edit-actions">
        <button type="button" class="secondary-btn" data-action="cancel-edit" data-server-id=${server.id}>${label('cancel')}</button>
        <button type="button" class="secondary-btn save-edit" data-action="save-edit" data-server-id=${server.id}>${label('save')}</button>
      </div>
    </div>`;
}

function A2aServerList({ servers, editingId, tokens }) {
  return html`${servers.map(server => (
    server.id === editingId
      ? html`<${A2aEditForm} key=${server.id} server=${server} token=${tokens[server.id] || ''} />`
      : html`<${A2aServerItem} key=${server.id} server=${server} />`
  ))}`;
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
  // Same defensive shape as checkA2aServerHealth: render only into a real
  // element. The normalization above has already been applied either way.
  if (!list || list.nodeType !== 1) return;
  render(
    html`<${A2aServerList}
      servers=${normalizedList}
      editingId=${editingA2aServerId}
      tokens=${a2aServerTokens}
    />`,
    list
  );
  // Auto-check health for all listed servers (fire-and-forget, no render block)
  for (const server of normalizedList) {
    checkA2aServerHealth(server.id, server.endpoint).catch(() => {});
  }
}

async function checkA2aServerHealth(serverId, endpoint) {
  if (typeof document?.querySelector !== 'function') return;
  const dot = document.querySelector(`.a2a-health-dot[data-health-for="${serverId}"]`);
  if (!dot) return;
  dot.className = 'a2a-health-dot checking';
  dot.title = 'Checking…';

  try {
    const response = await new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'A2A_HEALTH_CHECK', endpoint, serverId }, result => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(result);
        });
      } catch (err) {
        reject(err);
      }
    });

    if (response?.success && response.health?.status === 'ok') {
      const upstreams = response.health.upstreams || {};
      dot.className = 'a2a-health-dot healthy';
      dot.title = response.health.standalone
        ? 'Reachable — standalone A2A agent'
        : `Healthy — ${upstreams.healthy || 0}/${upstreams.total || 0} upstreams`;
    } else {
      dot.className = 'a2a-health-dot unhealthy';
      dot.title = 'Unhealthy or unreachable';
    }
  } catch {
    dot.className = 'a2a-health-dot unhealthy';
    dot.title = 'Health check failed';
  }
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

  let discoveryError = null;
  try {
    await discoverAndSaveA2aServer(server.id);
  } catch (error) {
    discoveryError = error;
  }

  if (status) {
    status.textContent = discoveryError
      ? `${label('saved')} ${label('errorPrefix')} ${discoveryError.message}`
      : label('saved');
    status.className = discoveryError ? 'status warn' : 'status';
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
  const hasAgentMetadata = agentCard && typeof agentCard === 'object'
    && (String(agentCard.name || agentCard.description || '').trim()
      || Array.isArray(agentCard.skills)
      || agentCard.capabilities);
  if (!hasAgentMetadata) {
    throw new Error('A2A discovery returned an invalid agent card.');
  }

  a2aServers = a2aServers.map(existing => {
    if (existing.id !== server.id) return existing;
    // Reconcile disabledSkillIds: keep only IDs still present in the new card
    const newSkillIds = new Set(
      Array.isArray(agentCard.skills)
        ? agentCard.skills.filter(s => s && typeof s === 'object').map(s => String(s.id || s.name || '')).filter(Boolean)
        : []
    );
    const reconciledDisabled = (existing.disabledSkillIds || []).filter(id => newSkillIds.has(id));
    return {
      ...existing,
      name: agentCard.name || existing.name,
      endpoint: normalizeA2aEndpoint(agentCard.endpoint || agentCard.url || existing.endpoint),
      agentCard,
      disabledSkillIds: reconciledDisabled,
      lastDiscoveredAt: new Date().toISOString()
    };
  });
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

async function setA2aServerEnabled(serverId, enabled) {
  const wanted = Boolean(enabled);
  let changed = false;
  a2aServers = a2aServers.map(server => {
    if (server.id !== serverId) return server;
    const current = server.enabled !== false;
    if (current === wanted) return server;
    changed = true;
    return { ...server, enabled: wanted };
  });
  if (!changed) return;
  await saveA2aServers();
  renderA2aServers();
}

function startEditA2aServer(serverId) {
  const server = a2aServers.find(s => s.id === serverId);
  if (!server) return;
  // Preserve the original guard: editing an agent that is not currently listed
  // does nothing.
  const item = document.querySelector(`.a2a-server-item[data-server-id="${serverId}"]`);
  if (!item) return;
  editingA2aServerId = serverId;
  renderA2aServers();
}

async function saveEditA2aServer(serverId) {
  const form = document.querySelector(`.a2a-edit-form[data-server-id="${serverId}"]`);
  if (!form) return;
  const name = String(form.querySelector('.a2a-edit-name')?.value || '').trim();
  const endpoint = normalizeA2aEndpoint(form.querySelector('.a2a-edit-endpoint')?.value);
  const token = String(form.querySelector('.a2a-edit-token')?.value || '').trim();

  if (!name || !endpoint) {
    const status = document.getElementById('a2aStatus');
    if (status) {
      status.textContent = `${label('errorPrefix')} ${name ? 'A2A endpoint is required.' : 'A2A server name is required.'}`;
      status.className = 'status error';
    }
    return;
  }

  a2aServers = a2aServers.map(server => {
    if (server.id !== serverId) return server;
    return { ...server, name, endpoint };
  });
  if (token) {
    a2aServerTokens = { ...a2aServerTokens, [serverId]: token };
  }
  await saveA2aServers();
  await saveA2aTokens();

  const status = document.getElementById('a2aStatus');
  if (status) {
    status.textContent = label('saved');
    status.className = 'status';
    setTimeout(() => { if (status.textContent === label('saved')) status.textContent = ''; }, 2500);
  }
  editingA2aServerId = null;
  renderA2aServers();
}

function updateA2aAutoRouteState(enabled) {
  const state = document.querySelector?.('.a2a-auto-route-state');
  if (state) state.textContent = enabled ? 'On' : 'Off';
}

async function initMemoryCard() {
  const enabledEl = document.getElementById('memoryEnabled');
  const longTermEl = document.getElementById('memoryLongTerm');
  const saveBtn = document.getElementById('saveMemory');
  const clearBtn = document.getElementById('clearDailyLogs');
  const statusEl = document.getElementById('memoryStatus');
  if (!enabledEl || !longTermEl || !saveBtn || !clearBtn) return;

  const syncStored = await new Promise(resolve => chrome.storage.sync.get(['memoryEnabled'], resolve));
  enabledEl.checked = syncStored.memoryEnabled !== false;

  const memoryStorageArea = chrome.storage.local || chrome.storage.sync;
  const localStored = await new Promise(resolve => {
    memoryStorageArea.get(['omnipilotMemoryLongTerm'], resolve);
  });
  longTermEl.value = localStored.omnipilotMemoryLongTerm || '';

  enabledEl.addEventListener('change', () => {
    chrome.storage.sync.set({ memoryEnabled: enabledEl.checked });
  });

  saveBtn.addEventListener('click', async () => {
    await new Promise(resolve => {
      memoryStorageArea.set({ omnipilotMemoryLongTerm: longTermEl.value }, resolve);
    });
    if (statusEl) {
      const message = label('memorySaved');
      statusEl.textContent = message;
      setTimeout(() => {
        if (statusEl.textContent === message) statusEl.textContent = '';
      }, 2500);
    }
  });

  clearBtn.addEventListener('click', async () => {
    await new Promise(resolve => {
      memoryStorageArea.set({ omnipilotMemoryDailyLogs: {} }, resolve);
    });
    if (statusEl) {
      const message = label('memoryLogsCleared');
      statusEl.textContent = message;
      setTimeout(() => {
        if (statusEl.textContent === message) statusEl.textContent = '';
      }, 2500);
    }
  });
}

async function initDebugCard() {
  const view = document.getElementById('debugTracesView');
  const refreshBtn = document.getElementById('refreshTraces');
  const clearBtn = document.getElementById('clearTraces');
  if (!view || !refreshBtn || !clearBtn) return;

  const traceStorageArea = chrome.storage.local || chrome.storage.sync;

  async function renderTraces() {
    const stored = await new Promise(resolve =>
      traceStorageArea.get(['omnipilotTraces'], resolve));
    const runs = Array.isArray(stored.omnipilotTraces) ? stored.omnipilotTraces : [];
    if (runs.length === 0) {
      view.textContent = t('debugNoRuns', currentLanguage);
      return;
    }
    const summary = runs.slice().reverse().map(run => {
      const events = Array.isArray(run.events)
        ? run.events.map(e => `    ${(e.ts || '').slice(11, 19)} ${e.type} ${JSON.stringify(e.data || {})}`).join('\n')
        : '';
      return `[${run.label}] ${run.startedAt} → ${run.endedAt || '(running)'} status=${run.status}\n${events}`;
    }).join('\n\n');
    view.textContent = summary;
  }

  refreshBtn.addEventListener('click', renderTraces);
  clearBtn.addEventListener('click', async () => {
    await new Promise(resolve =>
      traceStorageArea.set({ omnipilotTraces: [] }, resolve));
    await renderTraces();
  });

  await renderTraces();
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
  const appearanceController = initAppearance();
  globalThis.addEventListener?.('unload', () => appearanceController.dispose(), { once: true });

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
    initMemoryCard();
    initDebugCard();
    getA2aTokens().then(tokens => {
      a2aServerTokens = tokens;
      renderA2aServers();
    });
    const activeProviderConfig = getProviderConfig(providerType);
    const apiShape = activeProviderConfig.apiShape || (activeProviderConfig.endpoint ? inferApiShape(activeProviderConfig.endpoint) : DEFAULT_CONFIG.apiShape);
    activeProviderConfig.apiShape = apiShape;

    applyLanguage(config.languagePreference);
    setPopupInitialSizeFields(config);
    setResponseTimeoutField(config);
    setProviderFormConfig(activeProviderConfig);
    const providerTypeElement = document.getElementById('providerType') || document.getElementById('authMethod');
    if (providerTypeElement) providerTypeElement.value = providerType;
    const authMethodElement = document.getElementById('authMethod');
    if (authMethodElement) authMethodElement.value = providerType;
    const a2aAutoRouteElement = document.getElementById('a2aAutoRoute');
    if (a2aAutoRouteElement) {
      a2aAutoRouteElement.checked = config.a2aAutoRoute !== false;
      updateA2aAutoRouteState(a2aAutoRouteElement.checked);
    }
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
  // Advanced Settings toggle
  document.getElementById('advancedToggle')?.addEventListener('click', () => {
    const toggle = document.getElementById('advancedToggle');
    const section = document.getElementById('advancedSection');
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    section.classList.toggle('open', !isOpen);
  });
  document.getElementById('a2aAutoRoute')?.addEventListener('change', event => {
    const enabled = Boolean(event.target?.checked);
    updateA2aAutoRouteState(enabled);
    chrome.storage.sync.set({ a2aAutoRoute: enabled });
  });
  document.getElementById('a2aServerList')?.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-action][data-server-id]');
    if (!button) return;
    const serverId = button.getAttribute('data-server-id');
    if (button.getAttribute('data-action') === 'edit') {
      startEditA2aServer(serverId);
    } else if (button.getAttribute('data-action') === 'save-edit') {
      saveEditA2aServer(serverId);
    } else if (button.getAttribute('data-action') === 'cancel-edit') {
      editingA2aServerId = null;
      renderA2aServers();
    } else if (button.getAttribute('data-action') === 'discover') {
      discoverAndSaveA2aServer(serverId).catch(error => {
        const status = document.getElementById('a2aStatus');
        if (status) {
          status.textContent = `${label('errorPrefix')} ${error.message}`;
          status.className = 'status error';
        }
      });
    } else if (button.getAttribute('data-action') === 'remove') {
      removeA2aServer(serverId);
    } else if (button.getAttribute('data-action') === 'health') {
      const endpoint = button.getAttribute('data-endpoint');
      checkA2aServerHealth(serverId, endpoint);
    } else if (button.getAttribute('data-action') === 'enable') {
      setA2aServerEnabled(serverId, true);
    } else if (button.getAttribute('data-action') === 'disable') {
      setA2aServerEnabled(serverId, false);
    } else if (button.getAttribute('data-action') === 'toggle-skills-panel') {
      if (expandedA2aSkillPanels.has(serverId)) {
        expandedA2aSkillPanels.delete(serverId);
      } else {
        expandedA2aSkillPanels.add(serverId);
      }
      renderA2aServers();
    } else if (button.getAttribute('data-action') === 'enable-all-skills') {
      setAllA2aSkillsEnabled(serverId, true);
    } else if (button.getAttribute('data-action') === 'disable-all-skills') {
      setAllA2aSkillsEnabled(serverId, false);
    }
  });
  // Skill checkbox toggle (change event delegation)
  document.getElementById('a2aServerList')?.addEventListener('change', event => {
    const checkbox = event.target?.closest?.('[data-skill-toggle][data-server-id][data-skill-id]');
    if (!checkbox) return;
    setA2aSkillEnabled(
      checkbox.getAttribute('data-server-id'),
      checkbox.getAttribute('data-skill-id'),
      Boolean(checkbox.checked)
    );
  });
  document.getElementById('languageSelect').addEventListener('change', () => {
    const languagePreference = normalizeLanguage(document.getElementById('languageSelect').value);
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
      ...getPopupInitialSizeConfig(),
      ...getResponseTimeoutConfig(),
      providerType,
      providerConfigs,
      languagePreference: normalizeLanguage(document.getElementById('languageSelect').value)
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

// Expose internals on globalThis for the unit-test vm sandbox.
// In production (options page), globalThis === window; these properties are harmless.
Object.assign(globalThis, {
  fetchModels,
  getModelsFromBackground,
  updateAuthMethodUI,
  updateProviderTypeUI,
  scheduleFetch,
  startCopilotAuth,
  addA2aServerFromForm,
  renderA2aServers,
  discoverAndSaveA2aServer,
  checkA2aServerHealth,
  setA2aServerEnabled,
  startEditA2aServer,
  saveEditA2aServer
});

