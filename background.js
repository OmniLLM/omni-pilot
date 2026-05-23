// OmniPilot - background service worker
// Handles API calls to avoid CORS issues in content scripts

const DEFAULT_CONFIG = {
  endpoint: 'https://api.omnillm.com/v1',
  apiKey: '',
  model: 'claude-sonnet-4-5'
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
    chrome.storage.sync.get(DEFAULT_CONFIG, config => sendResponse(config));
    return true;
  }
});

async function handleAIChat(messages) {
  const config = await new Promise(resolve =>
    chrome.storage.sync.get(DEFAULT_CONFIG, resolve)
  );

  if (!config.apiKey) {
    throw new Error('No API key configured. Click the OmniPilot icon to set up.');
  }

  const endpoint = config.endpoint.replace(/\/$/, '');
  const usesMessagesApi = endpoint.includes('omnillm.com');
  const requestUrl = usesMessagesApi
    ? `${endpoint}/messages`
    : `${endpoint}/chat/completions`;

  const systemPrompt = 'You are a helpful assistant. Continue the conversation naturally.';

  const requestHeaders = usesMessagesApi
    ? {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      }
    : {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      };

  const requestBody = JSON.stringify(usesMessagesApi
    ? {
        model: config.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages
      }
    : {
        model: config.model,
        max_tokens: 1024,
        messages: [{ role: 'system', content: systemPrompt }, ...messages]
      });

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = `API error: ${response.status}`;
    try {
      const err = JSON.parse(errorText);
      message = err.error?.message || err.message || message;
    } catch {}
    throw new Error(message);
  }

  const data = await response.json();
  const content = usesMessagesApi
    ? data.content?.[0]?.text
    : data.choices?.[0]?.message?.content;

  if (!content) throw new Error('Empty response from API.');
  return content;
}

async function handleAIAction(action, text) {
  const config = await new Promise(resolve =>
    chrome.storage.sync.get(DEFAULT_CONFIG, resolve)
  );

  if (!config.apiKey) {
    throw new Error('No API key configured. Click the OmniPilot icon to set up.');
  }

  const systemPrompt = ACTION_PROMPTS[action];
  if (!systemPrompt) throw new Error(`Unknown action: ${action}`);

  const endpoint = config.endpoint.replace(/\/$/, '');
  const usesMessagesApi = endpoint.includes('omnillm.com');
  const requestUrl = usesMessagesApi
    ? `${endpoint}/messages`
    : `${endpoint}/chat/completions`;

  const requestHeaders = usesMessagesApi
    ? {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      }
    : {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      };
  const requestBody = JSON.stringify(usesMessagesApi
    ? {
        model: config.model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }]
      }
    : {
        model: config.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ]
      });

  console.info('OmniPilot API request', JSON.stringify({
    requestUrl,
    apiFormat: usesMessagesApi ? 'anthropic-messages' : 'openai-chat-completions',
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    requestHeaders: Object.fromEntries(Object.entries(requestHeaders).map(([key, value]) => [
      key,
      key.toLowerCase().includes('key') || key.toLowerCase() === 'authorization'
        ? `${String(value).split(' ')[0]} <redacted>`
        : value
    ])),
    requestBody
  }, null, 2));

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: requestHeaders,
    body: requestBody
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
      apiFormat: usesMessagesApi ? 'anthropic-messages' : 'openai-chat-completions',
      model: config.model,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      body: errorText
    }, null, 2));
    throw new Error(message);
  }

  const data = await response.json();
  const content = usesMessagesApi
    ? data.content?.[0]?.text
    : data.choices?.[0]?.message?.content;

  if (!content) {
    console.error('OmniPilot unexpected API response', data);
    throw new Error('The API returned an empty or unexpected response. Check that the endpoint and model match the selected API format.');
  }

  return content;
}
