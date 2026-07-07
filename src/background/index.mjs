// OmniPilot - background service worker.
//
// Chrome runtime + extension host code (context menus, ports, message
// routing, storage, provider abstraction, OAuth). Agentic behavior
// (Agent, Runner, Tool, ToolRegistry, Session, State) lives under
// src/background/agent/ and is concatenated into this bundle by
// build.mjs. Handlers in this file are thin wrappers that instantiate
// an Agent and delegate.

const PROVIDER_TYPES = {
  CUSTOM: 'custom-provider',
  GITHUB_COPILOT: 'github-copilot',
  AZURE_FOUNDRY: 'azure-foundry',
  A2A_PREFIX: 'a2a:'
};

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
  authMethod: AUTH_METHODS.API_KEY,
  a2aAutoRoute: true,
  memoryEnabled: true,
  contextMaxTokens: 8000,
  guardrailsMode: 'deny-list',
  guardrailsDenyDomains: [],
  observabilityEnabled: true
};

const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape', 'providerType', 'authMethod', 'providerConfigs', 'a2aServers', 'a2aAutoRoute', 'memoryEnabled', 'contextMaxTokens', 'guardrailsMode', 'guardrailsDenyDomains', 'observabilityEnabled'];
const A2A_TOKEN_STORAGE_KEY = 'a2aServerTokens';
const PROVIDER_CONFIG_FIELDS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape'];
// A2A constants live in src/background/agent/constants.mjs; they are
// concatenated into this bundle by build.mjs and available as top-level
// bindings here.

const API_SHAPES = {
  OPENAI_COMPATIBLE: 'openai-compatible',
  ANTHROPIC_MESSAGES: 'anthropic-messages',
  OPENAI_RESPONSES: 'openai-responses'
};

const ACTION_PROMPTS = {
  translate: 'Translate the following text to English. If already English, translate to Chinese. Return only the translation, no explanations.',
  'translate-en': 'Translate the following text into English. Return only the translation, no explanations.',
  'translate-zh': 'Translate the following text into Chinese. Return only the translation, no explanations.',
  'translate-bidi': 'Translate the following text. If it is in the user\'s preferred language, translate to English. If it is in English, translate to the user\'s preferred language. Return only the translation, no explanations.',
  summarize: 'Summarize the following text in 2-3 concise sentences. Return only the summary.',
  explain: 'Explain the following text clearly and simply. Be concise.',
  improve: 'Improve the writing of the following text. Keep the same language and meaning but make it clearer and more polished. Return only the improved text.',
  sentiment: 'Analyze the sentiment of the following text. Provide a brief summary of the overall emotional tone, labeling it with a short descriptive word or phrase. Be concise.',
  'code-explain': 'You are a senior software engineer. Break down the following code step by step, explain how each part works and why it was designed that way, note any potential issues, and summarize the overall purpose.',
  'divide-paragraphs': 'Divide the following text into clear, easy-to-read paragraphs. Return only the reformatted text.',
  ask: 'Analyze the following content carefully and provide a concise answer or opinion with a short explanation.',
  'summarize-page': 'Summarize the following page content concisely. Provide a clear, well-structured summary that captures the key points, main arguments, and important details. Use 3-5 sentences.',
  'summarize-github': 'You are an expert in analyzing GitHub discussions. Please provide a concise summary of the following GitHub issue or pull request thread. Identify the main problem reported, key points discussed by participants, proposed solutions (if any), and the current status or next steps. Present the summary in a structured markdown format.'
};

const CHAT_SYSTEM_PROMPT = 'You are a helpful assistant. Continue the conversation naturally.';

// ── Context Menu Setup ─────────────────────────────────────────────────────────

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'omnipilot-translate',
      title: '🌍 Translate',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'omnipilot-summarize',
      title: '📝 Summarize',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'omnipilot-explain',
      title: '💡 Explain',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'omnipilot-improve',
      title: '✨ Improve',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'omnipilot-sentiment',
      title: '😊 Sentiment',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'omnipilot-code-explain',
      title: '🔧 Code Explain',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'omnipilot-ask',
      title: '❓ Ask',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'omnipilot-separator',
      type: 'separator',
      contexts: ['page', 'selection']
    });
    chrome.contextMenus.create({
      id: 'omnipilot-summarize-page',
      title: '📄 Summarize Page',
      contexts: ['page', 'selection']
    });
    chrome.contextMenus.create({
      id: 'omnipilot-summarize-github',
      title: '🐙 Summarize Issue/PR',
      contexts: ['page'],
      documentUrlPatterns: ['*://github.com/*/issues/*', '*://github.com/*/pull/*']
    });
  });
}

if (chrome.contextMenus) {
  chrome.runtime.onInstalled?.addListener(() => {
    setupContextMenus();
  });

  // Re-create on startup in case they were lost
  chrome.runtime.onStartup?.addListener(() => {
    setupContextMenus();
  });

  chrome.contextMenus.onClicked?.addListener((info, tab) => {
    const menuId = info.menuItemId;
    if (!menuId || !String(menuId).startsWith('omnipilot-') || menuId === 'omnipilot-separator') return;

    const action = String(menuId).replace('omnipilot-', '');

    if (action === 'summarize-page') {
      chrome.tabs.sendMessage(tab.id, {
        type: 'CONTEXT_MENU_PAGE_SUMMARY'
      });
    } else if (action === 'summarize-github') {
      chrome.tabs.sendMessage(tab.id, {
        type: 'CONTEXT_MENU_GITHUB_SUMMARY'
      });
    } else {
      const selectedText = info.selectionText;
      if (!selectedText) return;
      // Send selected text action to content script
      chrome.tabs.sendMessage(tab.id, {
        type: 'CONTEXT_MENU_ACTION',
        action,
        text: selectedText
      });
    }
  });
}

function isDisconnectedPortError(error) {
  const message = error?.message || String(error || '');
  return message.includes('Attempting to use a disconnected port object') || message.includes('Extension context invalidated');
}

function safePortPostMessage(port, message) {
  try {
    port.postMessage(message);
    return true;
  } catch (error) {
    if (isDisconnectedPortError(error)) return false;
    throw error;
  }
}

// ── Streaming via Ports ────────────────────────────────────────────────────────

chrome.runtime.onConnect?.addListener(port => {
  if (port.name === 'omnipilot-stream') {
    let disconnected = false;
    port.onDisconnect?.addListener(() => {
      disconnected = true;
    });

    const postStreamMessage = message => {
      if (disconnected) return false;
      const sent = safePortPostMessage(port, message);
      if (!sent) disconnected = true;
      return sent;
    };

    const postStreamErrorAndDone = error => {
      if (!postStreamMessage({ type: 'error', error })) return;
      postStreamMessage({ type: 'done' });
    };

    port.onMessage.addListener(async request => {
      if (request.type === 'AI_ACTION_STREAM') {
        const systemPrompt = ACTION_PROMPTS[request.action];
        if (!systemPrompt) {
          postStreamErrorAndDone(`Unknown action: ${request.action}`);
          return;
        }
        await executeApiRequestStreaming({
          messages: [{ role: 'user', content: request.text }],
          systemPrompt,
          onChunk: text => postStreamMessage({ type: 'chunk', text }),
          onDone: () => postStreamMessage({ type: 'done' }),
          onError: postStreamErrorAndDone
        });
      } else if (request.type === 'AI_CHAT_STREAM') {
        await handleAIChatStreaming({
          messages: request.messages,
          onChunk: text => postStreamMessage({ type: 'chunk', text }),
          onStatus: status => postStreamMessage({ type: 'status', status }),
          onDone: () => postStreamMessage({ type: 'done' }),
          onError: postStreamErrorAndDone
        });
      }
    });
  }
});

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
  if (request.type === 'A2A_CANCEL_TASK') {
    (async () => {
      const server = await getA2aServerWithToken(request.serverId);
      if (!server) throw new Error('A2A server not found.');
      return cancelA2aTask(server, request.taskId);
    })()
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message || 'Unexpected extension error' }));
    return true;
  }
  if (request.type === 'A2A_HEALTH_CHECK') {
    checkA2aHealth(request.endpoint, request.serverId)
      .then(health => sendResponse({ success: true, health }))
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

function getFirstEnabledA2aServerId(servers) {
  const server = Array.isArray(servers)
    ? servers.map(normalizeA2aServer).find(candidate => candidate?.enabled !== false)
    : null;
  return server?.id || '';
}

function normalizeA2aEndpoint(endpoint) {
  const value = String(endpoint || '').trim();
  if (!value) return '';

  try {
    const url = new URL(value);
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

function normalizeA2aServer(server) {
  if (!server || typeof server !== 'object') return null;
  const id = String(server.id || '').trim();
  const name = String(server.name || server.agentCard?.name || id || '').trim();
  const endpoint = normalizeA2aEndpoint(server.endpoint);
  if (!id || !endpoint) return null;
  return {
    id,
    name,
    endpoint,
    enabled: server.enabled !== false,
    ...(server.agentCard && typeof server.agentCard === 'object' ? { agentCard: server.agentCard } : {})
  };
}

function getA2aRpcEndpoint(server) {
  return normalizeA2aEndpoint(server?.agentCard?.endpoint || server?.agentCard?.url || server?.endpoint || '');
}

function getA2aServersStorageArea() {
  return chrome.storage.local || chrome.storage.sync;
}

async function loadA2aServers() {
  const local = await storageGet(['a2aServers'], getA2aServersStorageArea());
  if (Array.isArray(local.a2aServers)) {
    return local.a2aServers.map(normalizeA2aServer).filter(Boolean);
  }

  // Migrate legacy servers stored in chrome.storage.sync (8KB per-item limit).
  const legacy = await storageGet(['a2aServers'], chrome.storage.sync);
  if (!Array.isArray(legacy.a2aServers)) return [];

  const servers = legacy.a2aServers.map(normalizeA2aServer).filter(Boolean);
  await storageSet({ a2aServers: servers }, getA2aServersStorageArea());
  await storageRemove(['a2aServers'], chrome.storage.sync);
  return servers;
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

function hasUsableA2aAgentCard(server) {
  return server?.agentCard
    && typeof server.agentCard === 'object'
    && (String(server.agentCard.description || '').trim()
      || (Array.isArray(server.agentCard.skills) && server.agentCard.skills.length > 0));
}

async function loadEnabledA2aServersWithAgentCards() {
  return (await loadA2aServersWithTokens())
    .filter(server => server.enabled !== false && hasUsableA2aAgentCard(server));
}

// Auto-discovery: for each enabled server without a usable cached agent card, fetch and
// persist its card so auto-routing can expose its skills as tools. Best-effort —
// a server whose discovery fails is simply skipped this turn.
async function ensureEnabledA2aServersDiscovered() {
  const enabled = (await loadA2aServersWithTokens()).filter(server => server.enabled !== false);
  const missing = enabled.filter(server => !hasUsableA2aAgentCard(server));
  if (!missing.length) {
    return enabled.filter(hasUsableA2aAgentCard);
  }

  const discovered = new Map();
  await Promise.all(missing.map(async server => {
    try {
      const agentCard = await discoverA2aServer(server.id);
      if (agentCard && typeof agentCard === 'object') discovered.set(server.id, agentCard);
    } catch (e) {
      console.warn(`OmniPilot A2A auto-discovery failed for ${server.id}: ${e.message}`);
    }
  }));

  if (discovered.size) {
    const stored = await loadA2aServers();
    const nextServers = stored.map(server =>
      discovered.has(server.id) ? { ...server, agentCard: discovered.get(server.id) } : server
    );
    await storageSet({ a2aServers: nextServers }, getA2aServersStorageArea());
  }

  return enabled
    .map(server => discovered.has(server.id) ? { ...server, agentCard: discovered.get(server.id) } : server)
    .filter(hasUsableA2aAgentCard);
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
  if (PROVIDERS[value]) return value;
  if (legacyAuthMethod === AUTH_METHODS.GITHUB_COPILOT) return PROVIDER_TYPES.GITHUB_COPILOT;
  return PROVIDER_TYPES.CUSTOM;
}

function getLatestUserMessage(messages = []) {
  return messages
    .filter(message => message?.role === 'user' && typeof message.content === 'string')
    .at(-1)?.content?.trim() || '';
}

function getA2aConversationContext(messages = []) {
  return messages
    .slice(0, -1)
    .filter(message => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string')
    .map(message => `${message.role === 'assistant' ? 'Popup assistant' : 'Popup user'}: ${message.content.trim()}`)
    .filter(Boolean)
    .join('\n\n');
}

function sanitizeA2aToolNamePart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'agent';
}

function buildA2aToolName(serverId, skillId) {
  const base = `a2a__${sanitizeA2aToolNamePart(serverId)}`;
  return skillId ? `${base}__${sanitizeA2aToolNamePart(skillId)}` : base;
}

function parseA2aToolName(toolName) {
  return typeof toolName === 'string' && toolName.startsWith('a2a__')
    ? toolName.slice('a2a__'.length)
    : '';
}

function buildA2aServerToolDescription(server) {
  const card = server.agentCard || {};
  const lines = [
    `Delegate to the A2A agent "${card.name || server.name || server.id}".`,
    card.description || '',
    card.capabilities ? `Capabilities: ${JSON.stringify(card.capabilities)}` : ''
  ];

  const skills = Array.isArray(card.skills) ? card.skills : [];
  for (const skill of skills) {
    if (!skill || typeof skill !== 'object') continue;
    const skillTags = Array.isArray(skill.tags) && skill.tags.length
      ? ` Tags: ${skill.tags.filter(Boolean).join(', ')}.`
      : '';
    const skillParts = [skill.name || skill.id || '', skill.description || ''].filter(Boolean).join(': ');
    if (skillParts) lines.push(`Skill: ${skillParts}.${skillTags}`.replace(/\.\./g, '.'));
  }

  lines.push('Call this tool only when the current user request clearly matches this agent\'s capabilities or skills.');
  return lines.filter(Boolean).join('\n').slice(0, A2A_TOOL_DESCRIPTION_MAX_LEN);
}

function buildA2aSkillToolDescription(server, skill) {
  const card = server.agentCard || {};
  const agentName = card.name || server.name || server.id;
  const skillName = skill.name || skill.id;
  const tags = Array.isArray(skill.tags) && skill.tags.length
    ? `Tags: ${skill.tags.filter(Boolean).join(', ')}.`
    : '';
  const lines = [
    `Use the "${skillName}" skill of the A2A agent "${agentName}".`,
    skill.description || '',
    tags,
    card.description ? `Agent context: ${card.description}` : '',
    'When the current user request matches this skill, call this tool instead of answering from local model knowledge. Pass the user\'s full request as the "task".'
  ];
  return lines.filter(Boolean).join('\n').slice(0, A2A_TOOL_DESCRIPTION_MAX_LEN);
}

// Kept for backwards compatibility with existing tests/usages.
function buildA2aToolDescription(server) {
  return buildA2aServerToolDescription(server);
}

function buildA2aToolParameters() {
  return {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'The standalone task for the A2A agent to perform.'
      }
    },
    required: ['task'],
    additionalProperties: false
  };
}

function buildA2aToolSchema({ serverId, skillId, skillName, skillDescription, skillTags, name, description }) {
  const parameters = buildA2aToolParameters();
  return {
    serverId,
    skillId: skillId || null,
    skillName: skillName || '',
    skillDescription: skillDescription || '',
    skillTags: skillTags || [],
    name,
    openAIChat: {
      type: 'function',
      function: { name, description, parameters }
    },
    anthropic: {
      name,
      description,
      input_schema: parameters
    },
    openAIResponses: {
      type: 'function',
      name,
      description,
      parameters
    }
  };
}

// Detect whether an agent card is a hub-style composite card. A composite
// card has skills whose IDs are namespaced (`upstream.capability`), which
// distinguishes them from standalone A2A agents whose skills are un-namespaced.
function isHubCompositeCard(agentCard) {
  const skills = agentCard?.skills;
  if (!Array.isArray(skills) || skills.length < 2) return false;
  // A card is composite if a majority of its skills have namespaced IDs
  const namespaced = skills.filter(s => String(s?.id || '').includes('.')).length;
  return namespaced > skills.length / 2;
}

// Return only enabled skills from an A2A server's agent card, filtering out
// skills whose IDs appear in the server's disabledSkillIds array.
function getEnabledA2aSkills(server) {
  const disabled = new Set(Array.isArray(server?.disabledSkillIds) ? server.disabledSkillIds : []);
  const skills = Array.isArray(server?.agentCard?.skills) ? server.agentCard.skills : [];
  return skills.filter(skill =>
    skill &&
    typeof skill === 'object' &&
    (skill.id || skill.name) &&
    !disabled.has(String(skill.id || ''))
  );
}

// Per agent-integration-guide.md §2, partition hub skills by flavour:
//   - plugin:tool:* → individual typed tools (fast, structured)
//   - skill:*, plugin:query:*, launcher:* → one meta-tool (slow/conversational)
//
// However, even plugin:tool:* can have dozens of entries. To keep the tool
// count minimal (browser-extension-friendly, works across all Copilot
// models), we register only the highest-value plugin:tools individually.
// Everything else rolls into the meta-tool.
const HUB_INDIVIDUAL_PLUGIN_TOOLS = new Set([
  'calculator',
  'web_search',
  'web_fetch'
]);

function partitionHubSkills(skills) {
  const pluginTools = [];
  const metaSkills = [];
  for (const skill of skills) {
    if (!skill || typeof skill !== 'object') continue;
    const id = String(skill.id || skill.name || '');
    const cap = id.split('.').slice(1).join('.');
    if (cap.startsWith('plugin:tool:')) {
      // Only register high-value tools individually; rest go to meta
      const toolSuffix = cap.replace('plugin:tool:', '');
      if (HUB_INDIVIDUAL_PLUGIN_TOOLS.has(toolSuffix)) {
        pluginTools.push(skill);
      } else {
        metaSkills.push(skill);
      }
    } else {
      metaSkills.push(skill);
    }
  }
  return { pluginTools, metaSkills };
}

function buildHubMetaToolParameters(metaSkills) {
  const skillEnum = metaSkills.map(s => String(s.id || s.name)).filter(Boolean);
  // Truncate skill descriptions aggressively to keep the total parameter
  // description under ~2KB. Some LLM providers (e.g. Copilot with claude
  // haiku) 400 on huge tool schemas without any useful error message.
  const skillDescriptions = metaSkills
    .map(s => `- ${s.id || s.name}: ${(s.description || '').slice(0, 80)}`)
    .join('\n')
    .slice(0, 2000);
  return {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: `Full skill id from the hub agent card. Examples:\n${skillDescriptions}`,
        enum: skillEnum.length <= 40 ? skillEnum : undefined
      },
      task: {
        type: 'string',
        description: 'Natural-language description of what you want the skill to do.'
      }
    },
    required: ['skill_id', 'task'],
    additionalProperties: false
  };
}

function buildHubMetaToolDescription(server, metaSkills) {
  const card = server.agentCard || {};
  const agentName = card.name || server.name || server.id;
  const lines = [
    `Delegate a task to a named skill on the "${agentName}" hub.`,
    'Use for domain-specific workflows (cloud queries, formatting, external service lookups, translations, web searches).',
    'The skill may respond with a clarifying question — treat that as needing more info from the user before you follow up.',
    `Available categories: ${[...new Set(metaSkills.map(s => {
      const cap = String(s.id || '').split('.').slice(1).join('.');
      if (cap.startsWith('skill:')) return 'skill';
      if (cap.startsWith('plugin:query:')) return 'query-plugin';
      if (cap.startsWith('launcher:')) return 'launcher';
      return 'other';
    }))].join(', ')}.`
  ];
  return lines.filter(Boolean).join('\n').slice(0, A2A_TOOL_DESCRIPTION_MAX_LEN);
}

function buildA2aToolSchemas(servers) {
  const usedNames = new Set();

  const uniqueName = baseName => {
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${baseName}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);
    return name;
  };

  const schemas = [];
  for (const server of servers) {
    const skills = getEnabledA2aSkills(server);

    // Hub composite card: partition by flavour per agent-integration-guide.md §2
    if (skills.length && isHubCompositeCard(server.agentCard)) {
      const { pluginTools, metaSkills } = partitionHubSkills(skills);

      // Register each plugin:tool:* as its own typed tool
      for (const skill of pluginTools) {
        const skillId = String(skill.id || skill.name);
        schemas.push(buildA2aToolSchema({
          serverId: server.id,
          skillId,
          skillName: skill.name || skill.id || '',
          skillDescription: skill.description || '',
          skillTags: Array.isArray(skill.tags) ? skill.tags : [],
          name: uniqueName(buildA2aToolName(server.id, skillId)),
          description: buildA2aSkillToolDescription(server, skill)
        }));
      }

      // Register all skill:*/plugin:query:*/launcher:* as ONE meta-tool
      if (metaSkills.length) {
        const metaName = uniqueName(buildA2aToolName(server.id, 'invoke_skill'));
        const metaParams = buildHubMetaToolParameters(metaSkills);
        schemas.push({
          serverId: server.id,
          skillId: null,
          skillName: '',
          skillDescription: '',
          skillTags: [],
          name: metaName,
          isHubMetaTool: true,
          hubMetaSkills: metaSkills,
          openAIChat: {
            type: 'function',
            function: { name: metaName, description: buildHubMetaToolDescription(server, metaSkills), parameters: metaParams }
          },
          anthropic: {
            name: metaName,
            description: buildHubMetaToolDescription(server, metaSkills),
            input_schema: metaParams
          },
          openAIResponses: {
            type: 'function',
            name: metaName,
            description: buildHubMetaToolDescription(server, metaSkills),
            parameters: metaParams
          }
        });
      }
      continue;
    }

    // Standalone A2A agent: one tool per skill (existing behavior)
    if (skills.length) {
      for (const skill of skills) {
        const skillId = String(skill.id || skill.name);
        schemas.push(buildA2aToolSchema({
          serverId: server.id,
          skillId,
          skillName: skill.name || skill.id || '',
          skillDescription: skill.description || '',
          skillTags: Array.isArray(skill.tags) ? skill.tags : [],
          name: uniqueName(buildA2aToolName(server.id, skillId)),
          description: buildA2aSkillToolDescription(server, skill)
        }));
      }
    } else {
      schemas.push(buildA2aToolSchema({
        serverId: server.id,
        skillId: null,
        name: uniqueName(buildA2aToolName(server.id)),
        description: buildA2aServerToolDescription(server)
      }));
    }
  }
  return schemas;
}

function buildA2aRoutingSystemPrompt(systemPrompt) {
  return `${systemPrompt}

TOOL ROUTING (MANDATORY):

You have registered A2A tools available. Some tools are direct (one per skill). One special tool named "invoke_skill" is a meta-tool: it routes to any of many named skills on a hub. The invoke_skill tool's skill_id parameter enumerates every available skill_id — check that list before answering.

RULES:
1. For questions about cloud resources (aws, gcp, azure, alibaba, openstack, cloud VMs, buckets, functions, databases) → CALL invoke_skill with the matching skill_id (e.g. skill_id="omnilauncher.skill:gcp"). Do NOT say "let me search for a tool" — the tools are already registered and visible to you. Do NOT answer from your own knowledge.
2. For directory/inventory queries (ldap, netbox, inventory, jira, tapestry) → CALL invoke_skill with the matching skill_id.
3. For file, shell, or system operations → look for a direct tool first (calculator, web_search, web_fetch), otherwise CALL invoke_skill.
4. When you call invoke_skill, you MUST supply BOTH: skill_id (exact ID from the enum in the parameter description) AND task (natural-language description of the request).
5. Compound prompts ("VMs in aws AND azure") → emit multiple parallel tool calls, one per skill.
6. Only answer without calling tools when no registered skill matches (e.g. general chat, definitions, opinions).

EXAMPLE:
- User: "how many VMs in gcp"
- CORRECT: call invoke_skill with { skill_id: "omnilauncher.skill:gcp", task: "how many VMs in gcp" }
- WRONG: "Let me search for a tool to query GCP" — you already HAVE the tool.
- WRONG: "You have X VMs" — you don't know without calling the tool.`;
}

function getA2aToolsForApiShape(toolSchemas, apiShape) {
  if (apiShape === API_SHAPES.ANTHROPIC_MESSAGES) return toolSchemas.map(tool => tool.anthropic);
  if (apiShape === API_SHAPES.OPENAI_RESPONSES) return toolSchemas.map(tool => tool.openAIResponses);
  return toolSchemas.map(tool => tool.openAIChat);
}

function parseA2aToolCallArguments(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

function extractA2aToolCallsFromOpenAIChat(data) {
  const toolCalls = data?.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .filter(call => parseA2aToolName(call?.function?.name))
    .map(call => {
      const parsedArgs = parseA2aToolCallArguments(call.function.arguments);
      return {
        id: call.id || '',
        toolName: call.function.name,
        serverId: parseA2aToolName(call.function.name),
        task: String(parsedArgs.task || '').trim(),
        parsedArgs,
        rawArguments: call.function.arguments
      };
    });
}

function extractA2aToolCallsFromAnthropic(data) {
  const blocks = data?.content;
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter(block => block?.type === 'tool_use' && parseA2aToolName(block.name))
    .map(block => {
      const parsedArgs = parseA2aToolCallArguments(block.input);
      return {
        id: block.id || '',
        toolName: block.name,
        serverId: parseA2aToolName(block.name),
        task: String(parsedArgs.task || '').trim(),
        parsedArgs,
        rawInput: block.input
      };
    });
}

function extractA2aToolCallsFromResponses(data) {
  const output = data?.output;
  if (!Array.isArray(output)) return [];
  return output
    .filter(item => ['function_call', 'tool_call'].includes(item?.type) && parseA2aToolName(item.name))
    .map(item => {
      const parsedArgs = parseA2aToolCallArguments(item.arguments);
      return {
        id: item.call_id || item.id || '',
        toolName: item.name,
        serverId: parseA2aToolName(item.name),
        task: String(parsedArgs.task || '').trim(),
        parsedArgs,
        rawArguments: item.arguments
      };
    });
}

function extractA2aToolCallsFromResponse(data, apiShape) {
  if (apiShape === API_SHAPES.ANTHROPIC_MESSAGES) return extractA2aToolCallsFromAnthropic(data);
  if (apiShape === API_SHAPES.OPENAI_RESPONSES) return extractA2aToolCallsFromResponses(data);
  return extractA2aToolCallsFromOpenAIChat(data);
}

function applyA2aToolsToRequestBody(requestBody, apiShape, tools) {
  if (!tools.length) return requestBody;
  if (apiShape === API_SHAPES.ANTHROPIC_MESSAGES) {
    // Anthropic: disable_parallel_tool_use defaults to false, but set it
    // explicitly so a compound user prompt like "how many VMs in Alibaba
    // and Azure" is allowed to emit two tool_use blocks in one turn.
    return { ...requestBody, tools, tool_choice: { type: 'auto', disable_parallel_tool_use: false } };
  }
  if (apiShape === API_SHAPES.OPENAI_RESPONSES) {
    // OpenAI Responses: parallel_tool_calls defaults to true on OpenAI's
    // own endpoint but not every OpenAI-compatible provider honors that;
    // pin it here so the model can emit multiple calls per turn.
    return { ...requestBody, tools, tool_choice: 'auto', parallel_tool_calls: true };
  }
  return { ...requestBody, tools, tool_choice: 'auto', parallel_tool_calls: true };
}

// buildA2aFollowUpMessages moved to src/background/agent/follow-up.mjs.

function getProvider(config) {
  const providerType = normalizeProviderType(config.providerType, config.authMethod);
  return PROVIDERS[providerType] || PROVIDERS[PROVIDER_TYPES.CUSTOM];
}

// DRY helper: resolve the API key for any provider (Copilot OAuth or static key).
// Returns { copilotToken } and mutates config.apiKey as a side-effect. Throws on
// auth failure so callers get a consistent error message.
async function requireApiKey(config) {
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
  return { copilotToken, provider };
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

  // Omni Agent Hub serves its composite card at /.well-known/agent-card.json;
  // standalone A2A agents typically use /.well-known/agent.json. Try both
  // filenames at the origin and, when the configured endpoint has a subpath,
  // also under that subpath.
  const originCardUrl = new URL('/.well-known/agent-card.json', endpointUrl.origin).toString();
  const originAgentUrl = new URL('/.well-known/agent.json', endpointUrl.origin).toString();
  const endpointCardUrl = new URL('.well-known/agent-card.json', `${normalizedEndpoint}/`).toString();
  const endpointAgentUrl = new URL('.well-known/agent.json', `${normalizedEndpoint}/`).toString();

  const seen = new Set();
  const urls = [];
  for (const url of [originCardUrl, originAgentUrl, endpointCardUrl, endpointAgentUrl]) {
    if (!seen.has(url)) { seen.add(url); urls.push(url); }
  }
  return urls;
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

  const [servers, stored, tokens] = await Promise.all([
    loadA2aServers(),
    storageGet(['providerType', 'providerConfigs'], getConfigStorageArea()),
    loadA2aServerTokens()
  ]);
  const providerType = createA2aProviderType(serverId);
  const nextServers = servers.filter(server => server && server.id !== serverId);
  const nextProviderConfigs = { ...(stored.providerConfigs || {}) };
  delete nextProviderConfigs[providerType];

  await storageSet({ a2aServers: nextServers }, getA2aServersStorageArea());

  const nextConfigValues = { providerConfigs: nextProviderConfigs };
  if (stored.providerType === providerType) {
    nextConfigValues.providerType = PROVIDER_TYPES.CUSTOM;
    nextConfigValues.authMethod = AUTH_METHODS.API_KEY;
  }
  await storageSet(nextConfigValues, getConfigStorageArea());

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

function isCopilotResponsesOnlyModel(model) {
  return /^mai-code-/i.test(String(model || ''));
}

// Vendor-shape messages: strip extension-only bookkeeping fields (kind,
// contextId, …) attached by the content script / side panel. The Anthropic
// Messages, OpenAI Responses, and OpenAI Chat endpoints all reject unknown
// keys inside message/input entries — see tests/unit/provider-message-sanitization.test.js.
//
// Uses a denylist rather than an allowlist so we keep vendor-legitimate
// fields (tool_calls, tool_call_id, name, type, tool_use_id, call_id,
// output, function_call_output items in the Responses input list, etc.)
// while stripping only the fields the content script attaches to
// conversationHistory for its own bookkeeping.
const EXTENSION_ONLY_MESSAGE_FIELDS = ['kind', 'contextId'];

function sanitizeVendorMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(m => {
    if (!m || typeof m !== 'object') return m;
    let hasBanned = false;
    for (const field of EXTENSION_ONLY_MESSAGE_FIELDS) {
      if (field in m) { hasBanned = true; break; }
    }
    if (!hasBanned) return m;
    const copy = { ...m };
    for (const field of EXTENSION_ONLY_MESSAGE_FIELDS) delete copy[field];
    return copy;
  });
}

function buildApiRequest({ config, messages, systemPrompt, copilotToken, tools }) {
  const hasTools = Array.isArray(tools) && tools.length > 0;
  messages = sanitizeVendorMessages(messages);

  if (getProvider(config).usesCopilotAuth) {
    if (isCopilotResponsesOnlyModel(config.model)) {
      return {
        apiShape: API_SHAPES.OPENAI_RESPONSES,
        requestUrl: `${COPILOT_CONFIG.COPILOT_API_BASE_URL}/responses`,
        requestHeaders: createCopilotHeaders(copilotToken),
        requestBody: {
          model: config.model,
          instructions: systemPrompt,
          input: messages,
          ...(hasTools ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {})
        },
        parseContent: parseOpenAIResponsesText
      };
    }

    return {
      apiShape: API_SHAPES.OPENAI_COMPATIBLE,
      requestUrl: `${COPILOT_CONFIG.COPILOT_API_BASE_URL}/chat/completions`,
      requestHeaders: createCopilotHeaders(copilotToken),
      requestBody: {
        model: config.model,
        ...getOpenAIChatTokenLimitParams(config),
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        ...(hasTools ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {})
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
        messages,
        ...(hasTools ? { tools, tool_choice: { type: 'auto', disable_parallel_tool_use: false } } : {})
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
        input: messages,
        ...(hasTools ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {})
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
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      ...(hasTools ? { tools, tool_choice: 'auto', parallel_tool_calls: true } : {})
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

function isToolsUnsupportedError(status, errorText) {
  if (![400, 422].includes(status)) return false;
  // Explicit tool-related keywords in the error body
  if (/\btools?\b|tool_choice|function_call/i.test(String(errorText || ''))) return true;
  // Some providers (e.g. Copilot) return a bare "Bad Request" with no detail
  // when they don't support the tools payload. If the body is generic/empty
  // and the status is 400, treat it as a tools rejection so the runner can
  // retry without tools.
  const trimmed = String(errorText || '').trim();
  if (status === 400 && (!trimmed || /^bad request\.?$/i.test(trimmed))) return true;
  return false;
}

function throwApiResponseError(response, errorText, requestUrl, apiShape, model) {
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
    model,
    responseHeaders: Object.fromEntries(response.headers?.entries?.() || []),
    body: errorText
  }, null, 2));

  throw new Error(message);
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
  const sections = [
    'Use only the task and popup context below. Ignore any prior conversation or session state in the A2A backend.',
    `Task:\n${String(task || '').trim()}`
  ];
  const trimmedContext = String(contextText || '').trim();
  if (trimmedContext) sections.push(`Popup context:\n${trimmedContext}`);
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

function createA2aMessageParams(task, contextText, skillId, contextId) {
  const params = {
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
  if (skillId) params.skillId = String(skillId);
  // Hub contextId enables multi-turn routing: follow-up messages with the
  // same contextId are automatically routed to the same upstream agent.
  if (contextId) params.contextId = String(contextId);
  return params;
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
  const state = getA2aTaskState(task);
  if (state === 'failed') {
    throw new Error(extractA2aText(task.status) || extractA2aText(task) || 'A2A task failed.');
  }
  if (state === 'canceled') {
    throw new Error('A2A task was canceled.');
  }
  return task;
}

function isA2aTaskTerminal(task) {
  const state = getA2aTaskState(task);
  return ['completed', 'input-required', 'canceled'].includes(state);
}

// Kept for backwards compatibility.
function isA2aTaskComplete(task) {
  return isA2aTaskTerminal(task);
}

function createA2aHttpError(status, body = '') {
  const suffix = body ? `: ${String(body).trim().slice(0, 300)}` : '';
  const error = new Error(`A2A request failed: ${status}${suffix}`);
  error.status = status;
  error.body = body;
  return error;
}

function joinA2aPath(endpoint, path) {
  return `${String(endpoint || '').replace(/\/$/, '')}${path}`;
}

function createA2aRestMessageRequest(task, contextText, skillId, contextId) {
  const params = createA2aMessageParams(task, contextText, skillId, contextId);
  const body = { messages: [params.message] };
  if (params.skillId) body.skillId = params.skillId;
  if (params.contextId) body.contextId = params.contextId;
  return body;
}

async function postA2aRestMessage(server, task, contextText, skillId, contextId) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (server.token) headers.Authorization = `Bearer ${server.token}`;

  const response = await fetch(joinA2aPath(server.endpoint, '/message:send'), {
    method: 'POST',
    headers,
    body: JSON.stringify(createA2aRestMessageRequest(task, contextText, skillId, contextId))
  });

  if (!response.ok) {
    throw createA2aHttpError(response.status, await response.text());
  }

  return response.json();
}

async function getA2aRestTask(server, taskId) {
  const headers = { Accept: 'application/json' };
  if (server.token) headers.Authorization = `Bearer ${server.token}`;

  const response = await fetch(joinA2aPath(server.endpoint, `/tasks/${encodeURIComponent(taskId)}`), {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    throw createA2aHttpError(response.status, await response.text());
  }

  return response.json();
}

function createA2aRpcError(code, message, data) {
  const error = new Error(message || 'A2A request failed.');
  error.code = code;
  if (data !== undefined) error.data = data;
  return error;
}

function classifyA2aRpcError(rpcError) {
  const code = rpcError?.code;
  if (code === A2A_RPC_ERROR_UPSTREAM_UNAVAILABLE) {
    return { retryable: true, userMessage: 'A2A upstream is temporarily unavailable (circuit breaker open). Retrying…' };
  }
  if (code === A2A_RPC_ERROR_NO_ROUTE) {
    return { retryable: false, userMessage: `No A2A upstream handles this request. ${rpcError.message || ''}`.trim() };
  }
  if (code === A2A_RPC_ERROR_TASK_NOT_FOUND) {
    return { retryable: false, userMessage: 'A2A task not found. It may have expired.' };
  }
  if (code === A2A_RPC_ERROR_UPSTREAM_HTTP || code === A2A_RPC_ERROR_UPSTREAM_INVALID) {
    return { retryable: false, userMessage: `A2A upstream error: ${rpcError.message || 'unexpected response'}` };
  }
  return { retryable: false, userMessage: rpcError.message || 'A2A request failed.' };
}

async function postA2aRpc(server, method, params) {
  const headers = { 'Content-Type': 'application/json' };
  if (server.token) headers.Authorization = `Bearer ${server.token}`;

  const response = await fetch(getA2aRpcEndpoint(server), {
    method: 'POST',
    headers,
    body: JSON.stringify(createA2aRpcRequest(method, params))
  });

  if (!response.ok) {
    throw createA2aHttpError(response.status, await response.text());
  }

  const payload = await response.json();
  if (payload.error) {
    throw createA2aRpcError(
      payload.error.code,
      payload.error.message || 'A2A request failed.',
      payload.error.data
    );
  }

  return payload.result;
}

async function pollA2aTask(server, taskId) {
  for (let attempt = 0; attempt < A2A_MAX_POLL_ATTEMPTS; attempt += 1) {
    // Look up via globalThis so tests can inject a mock wait implementation
    // without needing to stub setTimeout in the vm sandbox.
    await globalThis.wait(A2A_POLL_INTERVAL_MS);
    const task = assertA2aTaskNotFailed(server.protocol === 'rest'
      ? await getA2aRestTask(server, taskId)
      : await postA2aRpc(server, 'tasks/get', { id: taskId }));
    if (isA2aTaskComplete(task)) return task;
  }

  throw new Error('A2A task polling timed out.');
}

// ── Hub tasks/cancel ─────────────────────────────────────────────────────────
// Cancel a running task using the hub task ID (the one returned in result.id,
// NOT the upstream's internal ID). Sends a JSON-RPC `tasks/cancel` request.

async function cancelA2aTask(server, taskId) {
  return postA2aRpc(server, 'tasks/cancel', { id: taskId });
}

// ── A2A health check ─────────────────────────────────────────────────────────
// Hub agents expose GET /health returning { status: "ok", upstreams: { … } }.
// Standalone A2A agents (like OmniLauncher) usually don't — /health is a
// hub-only convention. For those, we fall back to an authenticated agent-card
// discovery probe: if the .well-known agent card responds, the agent is
// reachable and we synthesize an { status: "ok" } payload so the UI shows
// green. Returns the parsed hub payload, a synthesized standalone payload,
// or null on failure.

async function checkA2aHealth(endpoint, serverId) {
  const normalized = normalizeA2aEndpoint(endpoint);
  if (!normalized) return null;

  const server = serverId ? await getA2aServerWithToken(serverId) : null;
  const token = server?.token || '';

  const healthUrl = joinA2aPath(normalized, '/health');
  try {
    const response = await fetch(healthUrl, { headers: createA2aHeaders(token) });
    if (response.ok) return await response.json();
  } catch {
    // fall through to discovery-based reachability probe
  }

  // Standalone A2A fallback: any successful agent-card discovery URL means
  // the agent is reachable. Try the same URLs discoverA2aServer uses so hub
  // and standalone endpoints are both covered.
  const discoveryUrls = getA2aDiscoveryUrls(normalized);
  const headers = createA2aHeaders(token);
  for (const url of discoveryUrls) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return { status: 'ok', standalone: true };
    } catch {
      // try next URL
    }
  }

  return null;
}

async function discoverA2aRpcEndpoint(server) {
  const agentCard = await discoverA2aServer(server.id);
  const endpoint = getA2aRpcEndpoint({ ...server, agentCard });
  return endpoint && endpoint !== server.endpoint ? { ...server, agentCard } : server;
}

function shouldFallbackToA2aRest(error) {
  return error?.status === 404
    || (error?.status === 400 && /missing field [`"]?messages[`"]?/i.test(error.message || ''));
}

function isA2aBreakerOpenError(error) {
  return error?.code === A2A_RPC_ERROR_UPSTREAM_UNAVAILABLE;
}

async function sendInitialA2aTask(server, task, contextText, skillId, contextId) {
  // Retry loop for hub circuit-breaker (-32010): the upstream had 3+
  // consecutive failures. Back off briefly and try again before surfacing
  // the error to the user.
  for (let attempt = 0; attempt <= A2A_RPC_BREAKER_MAX_RETRIES; attempt += 1) {
    try {
      return {
        server,
        task: assertA2aTaskNotFailed(await postA2aRpc(server, 'message/send', createA2aMessageParams(task, contextText, skillId, contextId)))
      };
    } catch (error) {
      if (isA2aBreakerOpenError(error) && attempt < A2A_RPC_BREAKER_MAX_RETRIES) {
        await globalThis.wait(A2A_RPC_BREAKER_BACKOFF_MS);
        continue;
      }
      // Surface hub-specific error classification as-is for -32011 etc.
      if (error?.code && !shouldFallbackToA2aRest(error)) {
        const classified = classifyA2aRpcError(error);
        throw new Error(classified.userMessage);
      }
      if (!shouldFallbackToA2aRest(error)) throw error;

      try {
        return {
          server: { ...server, protocol: 'rest' },
          task: assertA2aTaskNotFailed(await postA2aRestMessage(server, task, contextText, skillId, contextId))
        };
      } catch (restError) {
        if (restError.status !== 404) throw restError;
      }

      if (server.agentCard) throw error;

      const discoveredServer = await discoverA2aRpcEndpoint(server);
      if (getA2aRpcEndpoint(discoveredServer) === getA2aRpcEndpoint(server)) throw error;
      return {
        server: discoveredServer,
        task: assertA2aTaskNotFailed(await postA2aRpc(discoveredServer, 'message/send', createA2aMessageParams(task, contextText, skillId, contextId)))
      };
    }
  }
  throw new Error('A2A upstream is temporarily unavailable. Please try again later.');
}

async function delegateA2aTask({ serverId, skillId, task, contextText, contextId }) {
  const server = await getA2aServerWithToken(serverId);

  if (!server?.endpoint) {
    throw new Error(`A2A server not configured: ${serverId}`);
  }

  const initial = await sendInitialA2aTask(server, task, contextText, skillId, contextId);
  const initialTask = initial.task;
  const initialState = getA2aTaskState(initialTask);

  // §6.4: handle all six terminal states from the hub
  if (initialState === 'input-required') {
    // The upstream asked a clarifying question — return the question text
    // so the model can decide whether to answer autonomously or bubble up.
    const questionText = extractA2aText(initialTask);
    return questionText || 'The agent requires more information to proceed.';
  }

  const immediateText = extractA2aText(initialTask);
  if (immediateText) return immediateText;

  const taskId = getA2aTaskId(initialTask);
  if (!taskId) {
    throw new Error('A2A task did not include a task id or text result.');
  }

  const completedTask = await pollA2aTask(initial.server, taskId);
  const completedText = extractA2aText(completedTask);
  if (!completedText) {
    throw new Error('A2A task completed without text result.');
  }

  return completedText;
}

// ── A2A SSE streaming via message/sendSubscribe ──────────────────────────────
//
// The Omni Agent Hub supports Server-Sent Events for real-time task progress.
// This function sends a message/sendSubscribe JSON-RPC request and reads the
// SSE stream, calling onChunk for each intermediate text and onDone/onError
// at the terminal event (final=true or state=completed|failed|canceled).
// Falls back to unary delegateA2aTask when the hub doesn't support streaming
// (404 or non-SSE content-type).

function isA2aSseContentType(contentType) {
  return /text\/event-stream/i.test(String(contentType || ''));
}

function parseA2aSseTaskEvent(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function isA2aSseTerminalState(state) {
  return ['completed', 'failed', 'canceled', 'input-required'].includes(state);
}

async function delegateA2aTaskStreaming({ serverId, skillId, task, contextText, contextId, onChunk, onDone, onError }) {
  const server = await getA2aServerWithToken(serverId);
  if (!server?.endpoint) {
    throw new Error(`A2A server not configured: ${serverId}`);
  }

  const rpcEndpoint = getA2aRpcEndpoint(server);
  const headers = { 'Content-Type': 'application/json' };
  if (server.token) headers.Authorization = `Bearer ${server.token}`;

  const params = createA2aMessageParams(task, contextText, skillId, contextId);

  let response;
  try {
    response = await fetch(rpcEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(createA2aRpcRequest('message/sendSubscribe', params))
    });
  } catch (err) {
    // Network error — fall back to unary
    const result = await delegateA2aTask({ serverId, skillId, task, contextText, contextId });
    onChunk(result);
    onDone();
    return;
  }

  // Fall back to unary delegation when streaming is not supported
  if (!response.ok || !isA2aSseContentType(response.headers.get('content-type'))) {
    const result = await delegateA2aTask({ serverId, skillId, task, contextText, contextId });
    onChunk(result);
    onDone();
    return;
  }

  if (!response.body) {
    // Non-streaming response despite correct content-type — parse as JSON
    try {
      const data = await response.json();
      const text = extractA2aText(data?.result || data);
      if (text) onChunk(text);
      onDone();
    } catch {
      onError('Failed to parse A2A streaming response.');
    }
    return;
  }

  // Read SSE events
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data: ')) continue;

        const event = parseA2aSseTaskEvent(trimmed.slice(6));
        if (!event) continue;

        const state = event.status?.state || event.state || '';

        // Extract intermediate text from status.message or artifacts
        const eventText = extractA2aText(event);
        if (eventText && eventText !== lastText) {
          onChunk(eventText);
          lastText = eventText;
        }

        if (state === 'failed') {
          const errorMsg = extractA2aText(event.status) || 'A2A task failed.';
          onError(errorMsg);
          return;
        }

        if (event.final === true || isA2aSseTerminalState(state)) {
          onDone();
          return;
        }
      }
    }
    // Stream ended without terminal event
    onDone();
  } catch (err) {
    onError(err?.message || 'A2A stream interrupted.');
  }
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
  const agent = await createAgent();
  return agent.chat(messages);
}

// Streaming-capable entry point for the side panel / floating-panel chat port.
//
// Contract (mirrors executeApiRequestStreaming): call onError(message) OR
// onDone() exactly once — never both. The port handler turns onError into an
// error+done pair, so callers must NOT also invoke onDone after onError.
//
// Restores real token streaming for ordinary chat (the common case) while
// keeping A2A tool routing: A2A delegation is non-streaming, so those paths
// surface a 'delegating' status and a bounded await instead of a dead spinner.
async function handleAIChatStreaming({ messages, onChunk, onStatus, onDone, onError }) {
  let agent;
  try {
    agent = await createAgent();
  } catch (error) {
    onError(error?.message || 'Unexpected extension error');
    return;
  }
  await agent.chatStreaming({ messages, onChunk, onStatus, onDone, onError });
}

function withA2aStatusHeartbeat(promise, onStatus, ms = globalThis.A2A_STATUS_HEARTBEAT_MS || A2A_STATUS_HEARTBEAT_MS) {
  if (!onStatus || typeof setInterval !== 'function' || !(ms > 0)) return promise;
  const interval = setInterval(() => onStatus('delegating'), ms);
  if (interval && typeof interval.unref === 'function') interval.unref();
  return promise.finally(() => clearInterval(interval));
}

// Bound a non-streaming A2A delegation so a hung agent fetch surfaces an error
// instead of hanging the port forever. No-op when setTimeout is unavailable
// (the unit-test vm sandbox), so tests exercise the routing logic unchanged.
function withA2aDelegationTimeout(promise, ms = A2A_DELEGATION_TIMEOUT_MS) {
  if (typeof setTimeout !== 'function' || !(ms > 0)) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('A2A delegation timed out. The agent did not respond in time.')),
      ms
    );
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

function shouldAutoRouteA2a(config) {
  return config.a2aAutoRoute !== false && !isA2aProviderType(config.providerType);
}

async function executeApiRequestWithA2aRouting({ config, messages, systemPrompt, a2aServers, toolSchemas, onStatus, onEvent }) {
  const { copilotToken } = await requireApiKey(config);

  const session = createSession({ messages });
  const registry = createToolRegistry();
  // registerA2aToolsInRegistry() calls getContextText() inside each tool dispatch
  // closure, so wrap the already-computed value in a lambda to freeze one
  // contextText per run and ensure every dispatch sees the same text.
  const contextText = getA2aConversationContext(messages);
  registerA2aToolsInRegistry(registry, a2aServers, { getContextText: () => contextText });
  const guardrails = createGuardrails({
    mode: config.guardrailsMode,
    denyDomains: Array.isArray(config.guardrailsDenyDomains) ? config.guardrailsDenyDomains : [],
    servers: a2aServers
  });
  guardrails.wrap(registry, onEvent);

  const runner = createRunner({
    config,
    copilotToken,
    systemPrompt: buildA2aRoutingSystemPrompt(systemPrompt),
    toolRegistry: registry,
    session,
    onStatus,
    onEvent,
    maxTurns: A2A_MAX_ROUNDS
  });

  return await runner.run();
}

// Render an array of {call, server, tool, text, error} into either a plain
// string (single result) or labeled markdown sections (multiple results).
function renderA2aSettledSections(settled) {
  if (settled.length === 1) {
    const only = settled[0];
    if (only.error) throw new Error(only.error);
    return only.text;
  }
  const sections = settled.map(({ server, tool, text, error }) => {
    const agentName = server.agentCard?.name || server.name || server.id;
    const skillName = tool.skillName || '';
    const heading = skillName ? `### ${agentName} / ${skillName}` : `### ${agentName}`;
    const body = error ? `_A2A delegation failed: ${error}_` : text;
    return `${heading}\n\n${body}`;
  });
  return sections.join('\n\n');
}

async function handleAIAction(action, text) {
  const agent = await createAgent();
  return agent.action(action, text);
}

async function executeApiRequest({ config: preloadedConfig, messages, systemPrompt }) {
  const config = preloadedConfig || await loadConfig();
  const { copilotToken, provider } = await requireApiKey(config);

  return executeApiRequestWithConfig({ config, messages, systemPrompt, copilotToken, allowModelFallback: provider.usesCopilotAuth });
}

async function executeApiRequestWithConfig({ config, messages, systemPrompt, copilotToken, allowModelFallback }) {
  const raw = await executeApiRequestRaw({
    config,
    messages,
    systemPrompt,
    copilotToken,
    allowModelFallback,
    tools: []
  });

  if (!raw.content) {
    console.error('OmniPilot unexpected API response', raw.rawData);
    throw new Error('The API returned an empty or unexpected response. Check that the endpoint and model match the selected API format.');
  }

  return raw.content;
}

async function executeApiRequestRaw({ config, messages, systemPrompt, copilotToken, allowModelFallback, tools }) {
  const {
    apiShape,
    requestUrl,
    requestHeaders,
    requestBody,
    parseContent
  } = buildApiRequest({ config, messages, systemPrompt, copilotToken, tools });

  const serializedBody = JSON.stringify(requestBody);
  const sentTools = Array.isArray(tools) && tools.length > 0;

  console.info('OmniPilot API request', JSON.stringify({
    requestUrl,
    apiFormat: apiShape,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    toolCount: sentTools ? tools.length : 0,
    requestHeaders: redactHeaders(requestHeaders)
  }, null, 2));

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: serializedBody
  });

  if (!response.ok) {
    const errorText = await response.text();

    if (sentTools && isToolsUnsupportedError(response.status, errorText)) {
      // Tagged plain Error rather than a subclass: no caller uses
      // `instanceof` today, but the marker lets a caller distinguish
      // this rejection from other errors via `error.toolsUnsupported`.
      const err = new Error(`Provider rejected tools: ${errorText.slice(0, 200)}`);
      err.toolsUnsupported = true;
      throw err;
    }

    if (allowModelFallback && isModelNotSupportedError(response.status, errorText)) {
      const fallbackModel = chooseCopilotFallbackModel(await fetchCopilotModels(), config.model);
      if (fallbackModel) {
        await replaceStoredModel(fallbackModel);
        return executeApiRequestRaw({
          config: { ...config, model: fallbackModel },
          messages,
          systemPrompt,
          copilotToken,
          allowModelFallback: false,
          tools
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

  return { rawData: data, content, apiShape };
}

// ── Streaming Support ────────────────────────────────────────────────────────

function buildStreamingApiRequest({ config, messages, systemPrompt, copilotToken }) {
  const built = buildApiRequest({ config, messages, systemPrompt, copilotToken, tools: [] });
  built.requestBody.stream = true;
  return built;
}

function parseStreamChunkOpenAIChat(json) {
  return json.choices?.[0]?.delta?.content || '';
}

function parseStreamChunkAnthropic(json) {
  if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
    return json.delta.text || '';
  }
  return '';
}

function parseStreamChunkOpenAIResponses(json) {
  if (json.type === 'response.output_text.delta') {
    return json.delta || '';
  }
  return '';
}

function getStreamChunkParser(apiShape) {
  if (apiShape === API_SHAPES.ANTHROPIC_MESSAGES) return parseStreamChunkAnthropic;
  if (apiShape === API_SHAPES.OPENAI_RESPONSES) return parseStreamChunkOpenAIResponses;
  return parseStreamChunkOpenAIChat;
}

async function executeApiRequestStreaming({ config: preloadedConfig, messages, systemPrompt, onChunk, onDone, onError }) {
  const config = preloadedConfig || await loadConfig();
  let copilotToken;
  try {
    ({ copilotToken } = await requireApiKey(config));
  } catch (e) {
    onError(e.message);
    return;
  }

  const { apiShape, requestUrl, requestHeaders, requestBody } = buildStreamingApiRequest({
    config, messages, systemPrompt, copilotToken
  });

  const serializedBody = JSON.stringify(requestBody);

  console.info('OmniPilot streaming API request', JSON.stringify({
    requestUrl,
    apiFormat: apiShape,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    streaming: true,
    requestHeaders: redactHeaders(requestHeaders)
  }, null, 2));

  let response;
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: serializedBody
    });
  } catch (err) {
    onError('Network error. Check your connection and endpoint.');
    return;
  }

  if (!response.ok) {
    const errorText = await response.text();
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
    onError(message);
    return;
  }

  // If the response is not actually streaming (no readable body), fall back
  if (!response.body) {
    try {
      const data = await response.json();
      const parseContent = apiShape === API_SHAPES.ANTHROPIC_MESSAGES
        ? parseAnthropicText
        : apiShape === API_SHAPES.OPENAI_RESPONSES
          ? parseOpenAIResponsesText
          : parseOpenAIChatText;
      const content = parseContent(data);
      if (content) onChunk(content);
      onDone();
    } catch (err) {
      onError('Failed to parse API response.');
    }
    return;
  }

  const parseChunk = getStreamChunkParser(apiShape);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          try {
            const json = JSON.parse(jsonStr);
            const text = parseChunk(json);
            if (text) onChunk(text);
          } catch {
            // Ignore malformed JSON chunks
          }
        } else if (trimmed.startsWith('event:')) {
          // Anthropic sends event: lines; we parse data: on the next line
          continue;
        }
      }
    }
    onDone();
  } catch (err) {
    onError(err.message || 'Stream interrupted.');
  }
}

// Expose internals on globalThis for the unit-test vm sandbox.
// In production (service worker), globalThis is the worker's own scope, so these are harmless.
Object.assign(globalThis, {
  // Config + storage
  loadConfig,
  loadA2aServers,
  loadA2aServersWithTokens,
  // A2A helpers
  createA2aProviderType,
  isA2aProviderType,
  getA2aServerIdFromProviderType,
  buildA2aToolSchemas,
  delegateA2aTask,
  delegateA2aTaskStreaming,
  discoverA2aServer,
  removeA2aServer,
  cancelA2aTask,
  checkA2aHealth,
  // A2A RPC error classification
  createA2aRpcError,
  classifyA2aRpcError,
  // Copilot auth
  clearCopilotAuth,
  getCopilotAccessToken,
  pollCopilotToken,
  startCopilotDeviceFlow,
  // Streaming parsers
  parseStreamChunkOpenAIChat,
  parseStreamChunkAnthropic,
  parseStreamChunkOpenAIResponses,
  executeApiRequestStreaming,
  // Public entry points
  handleAIAction,
  handleAIChat,
  handleAIChatStreaming,
  handleGetModels,
  requireApiKey,
  setupContextMenus,
  wait
});
