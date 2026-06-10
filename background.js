// OmniPilot - background service worker
// Handles API calls to avoid CORS issues in content scripts

const DEFAULT_CONFIG = {
  endpoint: 'https://api.omnillm.com/v1',
  apiKey: '',
  model: 'claude-sonnet-4-5',
  apiShape: 'openai-compatible'
};

const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'apiShape'];

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
  if (request.type === 'GET_MODELS') {
    handleGetModels()
      .then(models => sendResponse({ models }))
      .catch(() => sendResponse({ models: [] }));
    return true;
  }
});

async function loadConfig() {
  const stored = await new Promise(resolve =>
    chrome.storage.sync.get(STORAGE_KEYS, resolve)
  );

  return {
    ...DEFAULT_CONFIG,
    ...stored,
    apiShape: stored.apiShape || (stored.endpoint ? inferApiShape(stored.endpoint) : DEFAULT_CONFIG.apiShape)
  };
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

function buildApiRequest({ config, messages, systemPrompt }) {
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
      max_tokens: 1024,
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

async function handleGetModels() {
  const config = await loadConfig();
  if (!config.apiKey || !config.endpoint) return [];

  const endpoint = normalizeEndpoint(config.endpoint);
  const url = `${endpoint}/models`;
  const headers = createAuthHeaders(config.apiShape, config.apiKey);
  delete headers['anthropic-version'];

  const resp = await fetch(url, { headers });
  if (!resp.ok) return [];
  const data = await resp.json();
  return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean).sort();
}

async function handleAIChat(messages) {
  return executeApiRequest({
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

async function executeApiRequest({ messages, systemPrompt }) {
  const config = await loadConfig();

  if (!config.apiKey) {
    throw new Error('No API key configured. Click the OmniPilot icon to set up.');
  }

  const {
    apiShape,
    requestUrl,
    requestHeaders,
    requestBody,
    parseContent
  } = buildApiRequest({ config, messages, systemPrompt });

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
