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
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async
  }
  if (request.type === 'GET_CONFIG') {
    chrome.storage.sync.get(DEFAULT_CONFIG, config => sendResponse(config));
    return true;
  }
});

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
  const response = await fetch(`${endpoint}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}
