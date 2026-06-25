// OmniPilot - background service worker
// Handles API calls to avoid CORS issues in content scripts

const PROVIDER_TYPES = {
  CUSTOM: 'custom-provider',
  GITHUB_COPILOT: 'github-copilot',
  AZURE_FOUNDRY: 'azure-foundry',
  A2A_PREFIX: 'a2a:'
};

const A2A_PROVIDER_PREFIX = 'a2a:';

const AUTH_METHODS = {
  API_KEY: 'api-key',
  GITHUB_COPILOT: PROVIDER_TYPES.GITHUB_COPILOT
};

const PROVIDERS = {
  [PROVIDER_TYPES.GITHUB_COPILOT]: {
    usesCopilotAuth: true,
    requiresApiKey: false,
    supportsModelsEndpoint: false
  },
  [PROVIDER_TYPES.CUSTOM]: {
    usesCopilotAuth: false,
    requiresApiKey: true,
    supportsModelsEndpoint: true
  },
  [PROVIDER_TYPES.AZURE_FOUNDRY]: {
    usesCopilotAuth: false,
    requiresApiKey: true,
    supportsModelsEndpoint: false,
    usesManualModels: true
  }
};

const COPILOT_CONFIG = {
  CLIENT_ID: 'Iv1.b507a08c87ecfe98',
  DEVICE_CODE_URL: 'https://github.com/login/device/code',
  ACCESS_TOKEN_URL: 'https://github.com/login/oauth/access_token',
  COPILOT_API_KEY_URL: 'https://api.github.com/copilot_internal/v2/token',
  COPILOT_API_BASE_URL: 'https://api.githubcopilot.com',
  SCOPES: 'read:user',
  USER_AGENT: 'GitHubCopilotChat/0.26.7',
  EDITOR_VERSION: 'vscode/1.83.1',
  EDITOR_PLUGIN_VERSION: 'copilot-chat/0.26.7',
  API_VERSION: '2025-04-01'
};

const COPILOT_STORAGE_KEYS = [
  'copilotDeviceCode',
  'copilotUserCode',
  'copilotVerificationUri',
  'copilotUserExpiry',
  'copilotPollInterval',
  'copilotGithubToken',
  'copilotAccessToken',
  'copilotTokenExpiry'
];

const DEFAULT_CONFIG = {
  endpoint: 'https://api.omnillm.com/v1',
  apiKey: '',
  model: 'claude-sonnet-4-5',
  models: '',
  apiShape: 'openai-compatible',
  providerType: PROVIDER_TYPES.CUSTOM,
  authMethod: AUTH_METHODS.API_KEY
};

const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape', 'providerType', 'authMethod', 'providerConfigs', 'a2aServers'];
const A2A_TOKEN_STORAGE_KEY = 'a2aServerTokens';
const PROVIDER_CONFIG_FIELDS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape'];
const A2A_POLL_INTERVAL_MS = 500;
const A2A_MAX_POLL_ATTEMPTS = 20;

const API_SHAPES = {
  OPENAI_COMPATIBLE: 'openai-compatible',
  ANTHROPIC_MESSAGES: 'anthropic-messages',
  OPENAI_RESPONSES: 'openai-responses'
};

const ACTION_PROMPTS = {
  translate: 'Translate the following text to English. If already English, translate to Chinese. Return only the translation, no explanations.',
  summarize: 'Summarize the following text in 2-3 concise sentences. Return only the summary.',
  explain: 'Explain the following text clearly and simply. Be concise.',
  improve: 'Improve the writing of the following text. Keep the same language and meaning but make it clearer and more polished. Return only the improved text.'
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'AI_ACTION') {
    handleAIAction(request.action, request.text)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => {
        console.error('OmniPilot action failed', err);
        sendResponse({ success: false, error: err.message || 'Unexpected extension error' });
      });
    return true; // keep channel open for async
  }
  if (request.type === 'AI_CHAT') {
    handleAIChat(request.messages)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => {
        console.error('OmniPilot chat failed', err);
        sendResponse({ success: false, error: err.message || 'Unexpected extension error' });
      });
    return true;
  }
  if (request.type === 'GET_CONFIG') {
    loadConfig().then(config => sendResponse(config));
    return true;
  }
  if (request.type === 'SET_PROVIDER') {
    activateStoredProvider(request.providerType)
      .then(config => sendResponse({ success: true, config }))
      .catch(err => sendResponse({ success: false, error: err.message || 'Unexpected extension error' }));
    return true;
  }
  if (request.type === 'SET_MODEL') {
    replaceStoredModel(request.model)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message || 'Unexpected extension error' }));
    return true;
  }
  if (request.type === 'GET_MODELS') {
    handleGetModels()
      .then(models => sendResponse({ models }))
      .catch(() => sendResponse({ models: [] }));
    return true;
  }
  if (request.type === 'COPILOT_START_DEVICE_FLOW') {
    startCopilotDeviceFlow()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ status: 'failed', error: err.message || 'Unexpected extension error' }));
    return true;
  }
  if (request.type === 'COPILOT_POLL_TOKEN') {
    pollCopilotToken(request.deviceCode)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ status: 'failed', error: err.message || 'Unexpected extension error' }));
    return true;
  }
  if (request.type === 'COPILOT_CLEAR_AUTH') {
    clearCopilotAuth()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message || 'Unexpected extension error' }));
    return true;
  }
  if (request.type === 'A2A_DISCOVER_SERVER') {
    discoverA2aServer(request.serverId)
      .then(agentCard => sendResponse({ success: true, agentCard }))
      .catch(err => sendResponse({ success: false, error: err.message || 'Unexpected extension error' }));
    return true;
  }
  if (request.type === 'A2A_REMOVE_SERVER') {
    removeA2aServer(request.serverId)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message || 'Unexpected extension error' }));
    return true;
  }
  if (request.type === 'A2A_DELEGATE_TASK') {
    delegateA2aTask(request)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message || 'Unexpected extension error' }));
    return true;
  }
});

function getConfigStorageArea() {
  return chrome.storage.sync;
}

function getCopilotStorageArea() {
  return chrome.storage.local || chrome.storage.sync;
}

function storageGet(keys, area = getConfigStorageArea()) {
  return new Promise(resolve => area.get(keys, resolve));
}

function storageSet(values, area = getConfigStorageArea()) {
  return new Promise(resolve => area.set(values, resolve));
}

function storageRemove(keys, area = getConfigStorageArea()) {
  return new Promise(resolve => area.remove(keys, resolve));
}

function getA2aTokenStorageArea() {
  return chrome.storage.local || chrome.storage.sync;
}

function createA2aProviderType(serverId) {
  return `${PROVIDER_TYPES.A2A_PREFIX}${serverId || ''}`;
}

function isA2aProviderType(providerType) {
  return typeof providerType === 'string' && providerType.startsWith(PROVIDER_TYPES.A2A_PREFIX);
}

function getA2aServerIdFromProviderType(providerType) {
  return isA2aProviderType(providerType) ? providerType.slice(PROVIDER_TYPES.A2A_PREFIX.length) : '';
}

function normalizeA2aServer(server) {
  if (!server || typeof server !== 'object') return null;
  const id = String(server.id || '').trim();
  const name = String(server.name || server.agentCard?.name || id || '').trim();
  const endpoint = String(server.endpoint || '').trim();
  if (!id || !endpoint) return null;
  return {
    id,
    name,
    endpoint,
    enabled: server.enabled !== false
  };
}

async function loadA2aServers() {
  const stored = await storageGet(['a2aServers'], getConfigStorageArea());
  return Array.isArray(stored.a2aServers)
    ? stored.a2aServers.map(normalizeA2aServer).filter(Boolean)
    : [];
}

async function loadA2aServerTokens() {
  const stored = await storageGet([A2A_TOKEN_STORAGE_KEY], getA2aTokenStorageArea());
  return stored[A2A_TOKEN_STORAGE_KEY] && typeof stored[A2A_TOKEN_STORAGE_KEY] === 'object'
    ? stored[A2A_TOKEN_STORAGE_KEY]
    : {};
}

async function loadA2aServersWithTokens() {
  const [servers, tokens] = await Promise.all([
    loadA2aServers(),
    loadA2aServerTokens()
  ]);
  return servers.map(server => ({
    ...server,
    token: tokens[server.id] || ''
  }));
}

async function getA2aServerWithToken(serverId) {
  if (!serverId) return null;
  const servers = await loadA2aServersWithTokens();
  return servers.find(server => server.id === serverId) || null;
}

async function loadConfig() {
  const stored = await storageGet(STORAGE_KEYS, getConfigStorageArea());
  const providerType = normalizeProviderType(stored.providerType, stored.authMethod);
  const activeProviderConfig = stored.providerConfigs?.[providerType] || {};
  const legacyConfig = Object.fromEntries(PROVIDER_CONFIG_FIELDS.map(field => [field, stored[field]]));
  const config = {
    ...DEFAULT_CONFIG,
    ...stored,
    ...legacyConfig,
    ...activeProviderConfig,
    providerType,
    authMethod: stored.authMethod || (providerType === PROVIDER_TYPES.GITHUB_COPILOT ? AUTH_METHODS.GITHUB_COPILOT : AUTH_METHODS.API_KEY)
  };

  return {
    ...config,
    apiShape: config.apiShape || (config.endpoint ? inferApiShape(config.endpoint) : DEFAULT_CONFIG.apiShape)
  };
}

function normalizeProviderType(value, legacyAuthMethod) {
  if (isA2aProviderType(value)) return value;
  if (PROVIDERS[value]) return value;
  if (legacyAuthMethod === AUTH_METHODS.GITHUB_COPILOT) return PROVIDER_TYPES.GITHUB_COPILOT;
  return PROVIDER_TYPES.CUSTOM;
}

function isA2aProviderType(providerType) {
  return typeof providerType === 'string' && providerType.startsWith(A2A_PROVIDER_PREFIX);
}

function getA2aServerIdFromProviderType(providerType) {
  return isA2aProviderType(providerType)
    ? providerType.slice(A2A_PROVIDER_PREFIX.length)
    : '';
}

function getLatestUserMessage(messages = []) {
  return messages
    .filter(message => message?.role === 'user' && typeof message.content === 'string')
    .at(-1)?.content?.trim() || '';
}

function getA2aConversationContext(messages = []) {
  return messages
    .slice(0, -1)
    .filter(message => message?.role === 'user' && typeof message.content === 'string')
    .map(message => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
}

function getProvider(config) {
  const providerType = normalizeProviderType(config.providerType, config.authMethod);
  if (isA2aProviderType(providerType)) {
    return {
      usesA2a: true,
      requiresApiKey: false,
      supportsModelsEndpoint: false
    };
  }
  return PROVIDERS[providerType] || PROVIDERS[PROVIDER_TYPES.CUSTOM];
}

async function activateStoredProvider(value) {
  const stored = await storageGet(STORAGE_KEYS, getConfigStorageArea());
  const providerType = normalizeProviderType(value, stored.authMethod);
  const providerConfigs = stored.providerConfigs || {};
  const currentProviderType = normalizeProviderType(stored.providerType, stored.authMethod);
  const nextProviderConfigs = {
    ...providerConfigs,
    [currentProviderType]: Object.fromEntries(PROVIDER_CONFIG_FIELDS.map(field => [field, stored[field]]))
  };
  const providerConfig = {
    ...DEFAULT_CONFIG,
    ...(nextProviderConfigs[providerType] || {})
  };
  const activeConfig = Object.fromEntries(PROVIDER_CONFIG_FIELDS.map(field => [field, providerConfig[field]]));

  await storageSet({
    ...activeConfig,
    providerType,
    authMethod: providerType === PROVIDER_TYPES.GITHUB_COPILOT ? AUTH_METHODS.GITHUB_COPILOT : AUTH_METHODS.API_KEY,
    providerConfigs: nextProviderConfigs
  }, getConfigStorageArea());

  return loadConfig();
}

function inferApiShape(endpoint) {
  return endpoint && endpoint.includes('omnillm.com')
    ? API_SHAPES.ANTHROPIC_MESSAGES
    : API_SHAPES.OPENAI_COMPATIBLE;
}

function normalizeEndpoint(endpoint) {
  const normalized = (endpoint || DEFAULT_CONFIG.endpoint).replace(/\/$/, '');
  return /^https?:\/\/[^/]+$/i.test(normalized) ? `${normalized}/v1` : normalized;
}

function createAuthHeaders(apiShape, apiKey) {
  const headers = { 'Content-Type': 'application/json' };

  if (apiShape === API_SHAPES.ANTHROPIC_MESSAGES) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

function createA2aHeaders(token) {
  const headers = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function getA2aDiscoveryUrls(endpoint) {
  const normalizedEndpoint = String(endpoint || '').trim().replace(/\/$/, '');
  if (!normalizedEndpoint) return [];

  let endpointUrl;
  try {
    endpointUrl = new URL(normalizedEndpoint);
  } catch {
    return [];
  }

  const originDiscoveryUrl = new URL('/.well-known/agent.json', endpointUrl.origin).toString();
  const endpointDiscoveryUrl = new URL('.well-known/agent.json', `${normalizedEndpoint}/`).toString();

  return endpointDiscoveryUrl === originDiscoveryUrl
    ? [originDiscoveryUrl]
    : [originDiscoveryUrl, endpointDiscoveryUrl];
}

async function discoverA2aServer(serverId) {
  const server = await getA2aServerWithToken(serverId);
  if (!server) {
    throw new Error('A2A server not found.');
  }

  const discoveryUrls = getA2aDiscoveryUrls(server.endpoint);
  if (!discoveryUrls.length) {
    throw new Error('A2A server endpoint is invalid.');
  }

  const headers = createA2aHeaders(server.token);
  for (const url of discoveryUrls) {
    const response = await fetch(url, { headers });
    if (!response.ok) continue;
    return response.json();
  }

  throw new Error('Unable to discover A2A agent card.');
}

async function removeA2aServer(serverId) {
  if (!serverId) return;

  const [stored, tokens] = await Promise.all([
    storageGet(['a2aServers', 'providerType', 'providerConfigs'], getConfigStorageArea()),
    loadA2aServerTokens()
  ]);
  const providerType = createA2aProviderType(serverId);
  const nextServers = Array.isArray(stored.a2aServers)
    ? stored.a2aServers.filter(server => server && server.id !== serverId)
    : [];
  const nextProviderConfigs = { ...(stored.providerConfigs || {}) };
  delete nextProviderConfigs[providerType];

  const nextStoredValues = {
    a2aServers: nextServers,
    providerConfigs: nextProviderConfigs
  };

  if (stored.providerType === providerType) {
    nextStoredValues.providerType = PROVIDER_TYPES.CUSTOM;
    nextStoredValues.authMethod = AUTH_METHODS.API_KEY;
  }

  await storageSet(nextStoredValues, getConfigStorageArea());

  const nextTokens = { ...tokens };
  delete nextTokens[serverId];
  await storageSet({ [A2A_TOKEN_STORAGE_KEY]: nextTokens }, getA2aTokenStorageArea());
}

function getOpenAIChatTokenLimitParams(config) {
  const providerType = normalizeProviderType(config.providerType, config.authMethod);
  const usesMaxCompletionTokens = config.model === 'gpt-5.4'
    && (providerType === PROVIDER_TYPES.AZURE_FOUNDRY || providerType === PROVIDER_TYPES.GITHUB_COPILOT);

  return usesMaxCompletionTokens
    ? { max_completion_tokens: 1024 }
    : { max_tokens: 1024 };
}

function buildApiRequest({ config, messages, systemPrompt, copilotToken }) {
  if (getProvider(config).usesCopilotAuth) {
    return {
      apiShape: API_SHAPES.OPENAI_COMPATIBLE,
      requestUrl: `${COPILOT_CONFIG.COPILOT_API_BASE_URL}/chat/completions`,
      requestHeaders: createCopilotHeaders(copilotToken),
      requestBody: {
        model: config.model,
        ...getOpenAIChatTokenLimitParams(config),
        messages: [{ role: 'system', content: systemPrompt }, ...messages]
      },
      parseContent: parseOpenAIChatText
    };
  }

  const endpoint = normalizeEndpoint(config.endpoint);
  const apiShape = config.apiShape || inferApiShape(config.endpoint);
  const requestHeaders = createAuthHeaders(apiShape, config.apiKey);

  if (apiShape === API_SHAPES.ANTHROPIC_MESSAGES) {
    return {
      apiShape,
      requestUrl: `${endpoint}/messages`,
      requestHeaders,
      requestBody: {
        model: config.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages
      },
      parseContent: parseAnthropicText
    };
  }

  if (apiShape === API_SHAPES.OPENAI_RESPONSES) {
    return {
      apiShape,
      requestUrl: `${endpoint}/responses`,
      requestHeaders,
      requestBody: {
        model: config.model,
        instructions: systemPrompt,
        input: messages
      },
      parseContent: parseOpenAIResponsesText
    };
  }

  return {
    apiShape: API_SHAPES.OPENAI_COMPATIBLE,
    requestUrl: `${endpoint}/chat/completions`,
    requestHeaders,
    requestBody: {
      model: config.model,
      ...getOpenAIChatTokenLimitParams(config),
      messages: [{ role: 'system', content: systemPrompt }, ...messages]
    },
    parseContent: parseOpenAIChatText
  };
}

function parseAnthropicText(data) {
  const textBlock = data.content?.find?.(block => block.type === 'text' && block.text);
  return textBlock?.text || data.content?.[0]?.text || null;
}

function parseOpenAIChatText(data) {
  return data.choices?.[0]?.message?.content || null;
}

function parseOpenAIResponsesText(data) {
  if (data.output_text) return data.output_text;

  for (const item of data.output || []) {
    for (const block of item.content || []) {
      if (block.text) return block.text;
    }
  }

  return null;
}

function isModelNotSupportedError(status, errorText) {
  if (status !== 400) return false;

  try {
    const err = JSON.parse(errorText);
    return err.error?.code === 'model_not_supported'
      || err.code === 'model_not_supported'
      || /model.*not supported/i.test(err.error?.message || err.message || '');
  } catch {
    return /model.*not supported/i.test(errorText);
  }
}

function chooseCopilotFallbackModel(models, currentModel) {
  const available = models.filter(model => model && model !== currentModel);
  return available.find(model => model === 'gpt-4o') || available[0] || '';
}

async function replaceStoredModel(model) {
  if (!model) return;

  const stored = await storageGet(['providerType', 'authMethod', 'providerConfigs'], getConfigStorageArea());
  const providerType = normalizeProviderType(stored.providerType, stored.authMethod);
  const providerConfigs = stored.providerConfigs || {};
  const activeProviderConfig = {
    ...(providerConfigs[providerType] || {}),
    model
  };

  await storageSet({
    model,
    providerConfigs: {
      ...providerConfigs,
      [providerType]: activeProviderConfig
    }
  }, getConfigStorageArea());
}

function redactHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
    const lowerKey = key.toLowerCase();
    const redactedValue = lowerKey === 'authorization'
      ? `${String(value).split(' ')[0]} <redacted>`
      : '<redacted>';

    return [
      key,
      lowerKey.includes('key') || lowerKey === 'authorization'
        ? redactedValue
        : value
    ];
  }));
}

function encodeFormBody(values) {
  return new URLSearchParams(values).toString();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildA2aTaskText(task, contextText) {
  const sections = [`Task:\n${String(task || '').trim()}`];
  const trimmedContext = String(contextText || '').trim();
  if (trimmedContext) sections.push(`Selected context:\n${trimmedContext}`);
  return sections.join('\n\n');
}

function createA2aRpcRequest(method, params) {
  return {
    jsonrpc: '2.0',
    id: `${Date.now()}-${Math.random()}`,
    method,
    params
  };
}

function createA2aMessageParams(task, contextText) {
  return {
    message: {
      role: 'user',
      parts: [
        {
          type: 'text',
          text: buildA2aTaskText(task, contextText)
        }
      ]
    }
  };
}

function extractA2aTextFromParts(parts) {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(part => part && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim();
}

function extractA2aText(payload) {
  if (!payload || typeof payload !== 'object') return '';

  const directPartsText = extractA2aTextFromParts(payload.parts);
  if (directPartsText) return directPartsText;

  const messageText = extractA2aText(payload.message);
  if (messageText) return messageText;

  const statusText = extractA2aText(payload.status);
  if (statusText) return statusText;

  for (const artifact of payload.artifacts || []) {
    const artifactText = extractA2aText(artifact);
    if (artifactText) return artifactText;
  }

  return '';
}

function getA2aTaskState(task) {
  return task?.state || task?.status?.state || '';
}

function getA2aTaskId(task) {
  return task?.id || task?.taskId || task?.task?.id || '';
}

function assertA2aTaskNotFailed(task) {
  if (getA2aTaskState(task) !== 'failed') return task;
  throw new Error(extractA2aText(task.status) || extractA2aText(task) || 'A2A task failed.');
}

function isA2aTaskComplete(task) {
  return getA2aTaskState(task) === 'completed';
}

async function postA2aRpc(server, method, params) {
  const headers = { 'Content-Type': 'application/json' };
  if (server.token) headers.Authorization = `Bearer ${server.token}`;

  const response = await fetch(server.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(createA2aRpcRequest(method, params))
  });

  if (!response.ok) {
    throw new Error(`A2A request failed: ${response.status}`);
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || 'A2A request failed.');
  }

  return payload.result;
}

async function pollA2aTask(server, taskId) {
  for (let attempt = 0; attempt < A2A_MAX_POLL_ATTEMPTS; attempt += 1) {
    await wait(A2A_POLL_INTERVAL_MS);
    const task = assertA2aTaskNotFailed(await postA2aRpc(server, 'tasks/get', { id: taskId }));
    if (isA2aTaskComplete(task)) return task;
  }

  throw new Error('A2A task polling timed out.');
}

async function delegateA2aTask({ serverId, task, contextText }) {
  const server = await getA2aServerWithToken(serverId);

  if (!server?.endpoint) {
    throw new Error(`A2A server not configured: ${serverId}`);
  }

  const initialTask = assertA2aTaskNotFailed(await postA2aRpc(server, 'message/send', createA2aMessageParams(task, contextText)));
  const immediateText = extractA2aText(initialTask);
  if (immediateText) return immediateText;

  const taskId = getA2aTaskId(initialTask);
  if (!taskId) {
    throw new Error('A2A task did not include a task id or text result.');
  }

  const completedTask = await pollA2aTask(server, taskId);
  const completedText = extractA2aText(completedTask);
  if (!completedText) {
    throw new Error('A2A task completed without text result.');
  }

  return completedText;
}

function validateCopilotDeviceFlowResponse(data) {
  if (!data?.device_code || !data?.user_code || !data?.verification_uri || !Number.isFinite(data?.expires_in)) {
    throw new Error('GitHub Copilot device flow returned an invalid response.');
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: Number.isFinite(data.interval) ? data.interval : 5
  };
}

function validateCopilotTokenResponse(data) {
  if (!data?.token || !Number.isFinite(data?.expires_at)) {
    throw new Error('GitHub Copilot token refresh returned an invalid response.');
  }

  return {
    token: data.token,
    expiresAt: data.expires_at
  };
}

function createCopilotHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'copilot-integration-id': 'vscode-chat',
    'Editor-Version': COPILOT_CONFIG.EDITOR_VERSION,
    'Editor-Plugin-Version': COPILOT_CONFIG.EDITOR_PLUGIN_VERSION,
    'User-Agent': COPILOT_CONFIG.USER_AGENT,
    'OpenAI-Intent': 'conversation-panel',
    'X-Github-Api-Version': COPILOT_CONFIG.API_VERSION,
    'X-Vscode-User-Agent-Library-Version': 'electron-fetch'
  };
}

async function startCopilotDeviceFlow() {
  const response = await fetch(COPILOT_CONFIG.DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: encodeFormBody({
      client_id: COPILOT_CONFIG.CLIENT_ID,
      scope: COPILOT_CONFIG.SCOPES
    })
  });

  if (!response.ok) {
    throw new Error('Failed to start GitHub Copilot device flow.');
  }

  const data = validateCopilotDeviceFlowResponse(await response.json());
  await storageSet({
    copilotDeviceCode: data.deviceCode,
    copilotUserCode: data.userCode,
    copilotVerificationUri: data.verificationUri,
    copilotUserExpiry: Date.now() + (data.expiresIn * 1000),
    copilotPollInterval: data.interval
  }, getCopilotStorageArea());

  return {
    deviceCode: data.deviceCode,
    userCode: data.userCode,
    verificationUri: data.verificationUri,
    expiresIn: data.expiresIn,
    interval: data.interval
  };
}

async function pollCopilotToken(deviceCode) {
  const response = await fetch(COPILOT_CONFIG.ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: encodeFormBody({
      client_id: COPILOT_CONFIG.CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  });

  if (!response.ok) {
    return { status: 'failed', error: `token_request_failed_${response.status}` };
  }

  const data = await response.json();
  if (data.access_token) {
    await storageSet({ copilotGithubToken: data.access_token }, getCopilotStorageArea());
    await storageRemove(['copilotDeviceCode', 'copilotUserCode', 'copilotVerificationUri', 'copilotUserExpiry', 'copilotPollInterval'], getCopilotStorageArea());
    return { status: 'success' };
  }

  if (data.error === 'slow_down') {
    const stored = await storageGet(['copilotPollInterval'], getCopilotStorageArea());
    const interval = (Number.isFinite(stored.copilotPollInterval) ? stored.copilotPollInterval : 5) + 5;
    await storageSet({ copilotPollInterval: interval }, getCopilotStorageArea());
    return { status: 'pending', slowDown: true, interval };
  }

  if (data.error === 'authorization_pending') {
    return { status: 'pending' };
  }

  return { status: 'failed', error: data.error || 'unknown_error' };
}

async function getCopilotAccessToken() {
  const stored = await storageGet(['copilotGithubToken', 'copilotAccessToken', 'copilotTokenExpiry'], getCopilotStorageArea());

  if (stored.copilotAccessToken && stored.copilotTokenExpiry && stored.copilotTokenExpiry > Date.now()) {
    return stored.copilotAccessToken;
  }

  if (!stored.copilotGithubToken) {
    throw new Error('GitHub Copilot authorization required.');
  }

  const response = await fetch(COPILOT_CONFIG.COPILOT_API_KEY_URL, {
    method: 'GET',
    headers: {
      Authorization: `token ${stored.copilotGithubToken}`,
      Accept: 'application/json',
      'User-Agent': COPILOT_CONFIG.USER_AGENT
    }
  });

  if (response.status === 401 || response.status === 403) {
    await storageRemove(['copilotGithubToken', 'copilotAccessToken', 'copilotTokenExpiry'], getCopilotStorageArea());
    throw new Error('GitHub Copilot authorization expired. Please sign in again.');
  }

  if (!response.ok) {
    throw new Error('Failed to refresh GitHub Copilot access token.');
  }

  const data = validateCopilotTokenResponse(await response.json());
  const expiry = data.expiresAt * 1000;
  await storageSet({
    copilotAccessToken: data.token,
    copilotTokenExpiry: expiry
  }, getCopilotStorageArea());
  return data.token;
}

async function clearCopilotAuth() {
  await storageRemove(COPILOT_STORAGE_KEYS, getCopilotStorageArea());
}

async function fetchCopilotModels() {
  const token = await getCopilotAccessToken();
  const response = await fetch(`${COPILOT_CONFIG.COPILOT_API_BASE_URL}/models`, {
    headers: createCopilotHeaders(token)
  });

  if (!response.ok) return [];
  const data = await response.json();
  return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean).sort();
}

function parseManualModels(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map(model => model.trim())
    .filter(Boolean);
}

async function handleGetModels() {
  const config = await loadConfig();
  const provider = getProvider(config);

  if (provider.usesCopilotAuth) {
    return fetchCopilotModels();
  }
  if (provider.usesManualModels) {
    return parseManualModels(config.models);
  }
  if (!provider.supportsModelsEndpoint || (provider.requiresApiKey && !config.apiKey) || !config.endpoint) return [];

  const endpoint = normalizeEndpoint(config.endpoint);
  const url = `${endpoint}/models`;
  const headers = createAuthHeaders(config.apiShape, config.apiKey);
  delete headers['anthropic-version'];

  const resp = await fetch(url, { headers });
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean).sort();
}

async function handleA2aProviderChat(config, messages) {
  const latestUserMessage = getLatestUserMessage(messages);
  if (!latestUserMessage) throw new Error('No user message available for A2A chat.');

  return delegateA2aTask({
    serverId: getA2aServerIdFromProviderType(config.providerType),
    task: latestUserMessage,
    contextText: getA2aConversationContext(messages)
  });
}

async function handleAIChat(messages) {
  const config = await loadConfig();
  if (isA2aProviderType(config.providerType)) {
    return handleA2aProviderChat(config, messages);
  }

  return executeApiRequest({
    config,
    messages,
    systemPrompt: 'You are a helpful assistant. Continue the conversation naturally.'
  });
}

async function handleAIAction(action, text) {
  const systemPrompt = ACTION_PROMPTS[action];
  if (!systemPrompt) throw new Error(`Unknown action: ${action}`);

  return executeApiRequest({
    messages: [{ role: 'user', content: text }],
    systemPrompt
  });
}

async function executeApiRequest({ config: preloadedConfig, messages, systemPrompt }) {
  const config = preloadedConfig || await loadConfig();
  const provider = getProvider(config);
  let copilotToken = '';

  if (provider.usesCopilotAuth) {
    try {
      copilotToken = await getCopilotAccessToken();
      config.apiKey = copilotToken;
    } catch (e) {
      throw new Error('GitHub Copilot authentication failed. Please re-authenticate in Settings.');
    }
  } else if (!config.apiKey) {
    throw new Error('No API key configured. Click the OmniPilot icon to set up.');
  }

  return executeApiRequestWithConfig({ config, messages, systemPrompt, copilotToken, allowModelFallback: provider.usesCopilotAuth });
}

async function executeApiRequestWithConfig({ config, messages, systemPrompt, copilotToken, allowModelFallback }) {
  const {
    apiShape,
    requestUrl,
    requestHeaders,
    requestBody,
    parseContent
  } = buildApiRequest({ config, messages, systemPrompt, copilotToken });

  const serializedBody = JSON.stringify(requestBody);

  console.info('OmniPilot API request', JSON.stringify({
    requestUrl,
    apiFormat: apiShape,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    requestHeaders: redactHeaders(requestHeaders)
  }, null, 2));

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: serializedBody
  });

  if (!response.ok) {
    const errorText = await response.text();

    if (allowModelFallback && isModelNotSupportedError(response.status, errorText)) {
      const fallbackModel = chooseCopilotFallbackModel(await fetchCopilotModels(), config.model);
      if (fallbackModel) {
        await replaceStoredModel(fallbackModel);
        return executeApiRequestWithConfig({
          config: { ...config, model: fallbackModel },
          messages,
          systemPrompt,
          copilotToken,
          allowModelFallback: false
        });
      }
    }

    let message = `API error: ${response.status}`;

    try {
      const err = JSON.parse(errorText);
      message = err.error?.message || err.message || message;
    } catch {
      if (errorText.trim()) message = `${message}: ${errorText.trim().slice(0, 300)}`;
    }

    if (response.status === 401 || response.status === 403) {
      message += '. Check your API key, endpoint, and selected model access.';
    } else if (response.status === 429) {
      message += '. Check your rate limit or quota.';
    }

    console.error('OmniPilot API error', JSON.stringify({
      status: response.status,
      statusText: response.statusText,
      requestUrl,
      apiFormat: apiShape,
      model: config.model,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      body: errorText
    }, null, 2));
    throw new Error(message);
  }

  const data = await response.json();
  const content = parseContent(data);

  if (!content) {
    console.error('OmniPilot unexpected API response', data);
    throw new Error('The API returned an empty or unexpected response. Check that the endpoint and model match the selected API format.');
  }

  return content;
}
