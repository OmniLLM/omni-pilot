// Regression tests for provider payload sanitization.
//
// Symptoms reported by the user:
//
//   1. mai-* models via GitHub Copilot -> /responses:
//      "Unknown parameter: 'input[0].kind'. Did you mean 'id'?"
//
//   2. openai models via GitHub Copilot -> /responses:
//      "Unknown parameter: 'input[0].kind'."
//
//   3. claude-* models via GitHub Copilot -> /messages:
//      The model answers with "provide your API key / brokerage name / API URL"
//      instead of answering the actual question. This is because the content
//      script forwards its follow-up chat history with extra fields (`kind`,
//      `contextId`), and Claude drifts on top of a message stream whose only
//      user content is "Additional selected context:\n<text>" with no
//      accompanying question.
//
// Root cause: `src/content-script/index.mjs` and `src/sidepanel/index.mjs`
// push messages onto conversationHistory that include extension-only
// bookkeeping fields (`kind`, `contextId`) as well as `role` and `content`.
// The background service worker forwards those messages verbatim to
// buildApiRequest -> fetch. The Anthropic Messages and OpenAI Responses
// endpoints do NOT tolerate unknown fields inside message / input elements.
//
// Fix: the background must strip messages to the vendor-shaped fields
// (`role`, `content`) before they enter buildApiRequest. Every provider
// path (Copilot Anthropic, Copilot Responses, Copilot Chat, direct
// Anthropic, direct Responses, direct Chat) must be safe.
//
// These tests reproduce all three symptoms end-to-end via the same
// vm-sandbox harness that background.test.js uses, then verify the
// sanitization invariant on the wire.

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'dist', 'background.js'), 'utf8');

const RESPONSE_BY_SHAPE = {
  'openai-compatible': { choices: [{ message: { content: 'ok' } }] },
  'anthropic-messages': { content: [{ type: 'text', text: 'ok' }] },
  'openai-responses': { output: [{ content: [{ type: 'output_text', text: 'ok' }] }] }
};

// Fields the content script attaches to conversationHistory messages that
// vendor APIs must never see.
const EXTENSION_ONLY_FIELDS = ['kind', 'contextId'];

async function createBackgroundContext({ storage = {}, fetchImpl } = {}) {
  const requests = [];
  const runtimeListeners = [];
  const connectListeners = [];
  const syncStore = { ...storage };
  const localStore = { ...storage };

  const makeArea = store => ({
    get(keys, cb) {
      if (Array.isArray(keys)) {
        const result = Object.fromEntries(keys.map(k => [k, store[k]]).filter(([, v]) => v !== undefined));
        cb(result);
        return;
      }
      if (keys && typeof keys === 'object') {
        const result = { ...keys };
        for (const key of Object.keys(keys)) {
          if (Object.prototype.hasOwnProperty.call(store, key)) result[key] = store[key];
        }
        cb(result);
        return;
      }
      cb({ ...store });
    },
    set(values, cb = () => {}) { Object.assign(store, values); cb(); },
    remove(keys, cb = () => {}) { for (const key of [].concat(keys)) delete store[key]; cb(); }
  });

  const sync = makeArea(syncStore);
  const local = makeArea(localStore);

  const context = {
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console: { info: () => {}, warn: () => {}, error: () => {} },
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { runtimeListeners.push(fn); } },
        onInstalled: { addListener(fn) { fn(); } },
        onStartup: { addListener() {} },
        onConnect: { addListener(fn) { connectListeners.push(fn); } }
      },
      contextMenus: {
        removeAll(cb) { cb(); },
        create() {},
        onClicked: { addListener() {} }
      },
      storage: { sync, local }
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (!fetchImpl) throw new Error(`Unexpected fetch ${url}`);
      return fetchImpl(url, options, { requests });
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, requests, runtimeListeners, connectListeners };
}

function assertNoExtensionFieldsIn(list, where) {
  assert.ok(Array.isArray(list), `${where} must be an array, got ${typeof list}`);
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;
    for (const field of EXTENSION_ONLY_FIELDS) {
      assert.ok(
        !(field in item),
        `${where}[${i}] must not contain extension-only field "${field}" ` +
        `(vendor API rejects it) — got ${JSON.stringify(item)}`
      );
    }
  }
}

// ── Symptom #1 & #2: mai-* / gpt-* on Copilot -> /responses ─────────────────
async function assertCopilotResponsesStripsExtensionFieldsFromInput() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'github-copilot',
      endpoint: '',
      apiKey: '',
      model: 'mai-code-preview',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async (url) => {
      if (url === 'https://api.githubcopilot.com/responses') {
        return { ok: true, json: async () => RESPONSE_BY_SHAPE['openai-responses'] };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  // Simulate the exact shape the content-script sends: a conversationHistory
  // that carries selection-context bookkeeping fields.
  const messages = [
    { role: 'user', content: 'Additional selected context:\nhello world', kind: 'selection-context', contextId: 'selection-context-1' },
    { role: 'user', content: 'summarize this please' }
  ];

  const result = await context.handleAIChat(messages);

  assert.strictEqual(result, 'ok');
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/responses');

  const body = JSON.parse(requests[0].options.body);
  assertNoExtensionFieldsIn(body.input, 'body.input (Copilot Responses / mai-*)');
}

async function assertCopilotResponsesStripsFromGptModels() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'github-copilot',
      endpoint: '',
      apiKey: '',
      model: 'gpt-5.5',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async (url) => {
      // `gpt-5.5` is responses-only on Copilot (its
      // supported_endpoints list is ['/responses', 'ws:/responses']).
      // The router MUST send this model to /responses; the invariant
      // we're checking is that no extension-only fields leak on the wire.
      if (url === 'https://api.githubcopilot.com/responses') {
        return { ok: true, json: async () => RESPONSE_BY_SHAPE['openai-responses'] };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const messages = [
    { role: 'user', content: 'Additional selected context:\ndocuments', kind: 'selection-context', contextId: 'ctx-1' },
    { role: 'user', content: 'improve wording' }
  ];

  await context.handleAIChat(messages);
  const body = JSON.parse(requests[0].options.body);
  // Every message on the wire — the responses-shape `input` list —
  // must be free of extension-only fields.
  assertNoExtensionFieldsIn(body.input, 'body.input (Copilot Responses / gpt-*)');
}

// ── Symptom #3: claude-* on Copilot -> /chat/completions ────────────────────
// The router forwards claude-* on Copilot through the openai-compatible
// /chat/completions route (Copilot does not expose a native Anthropic
// /messages route for these models). The wire-shape invariant is what
// matters: even on chat/completions, unknown fields inside message entries
// caused Claude on top of the harness to drift onto the selection-context
// text and produce the "provide your API key / brokerage name" answer.
async function assertCopilotAnthropicStripsExtensionFieldsFromMessages() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'github-copilot',
      endpoint: '',
      apiKey: '',
      model: 'claude-sonnet-4-5',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async (url) => {
      if (url === 'https://api.githubcopilot.com/chat/completions') {
        return { ok: true, json: async () => RESPONSE_BY_SHAPE['openai-compatible'] };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const messages = [
    { role: 'user', content: 'Additional selected context:\nfoo', kind: 'selection-context', contextId: 'ctx-1' },
    { role: 'user', content: 'How can I create a python script to help me pull my transactions and my balance from my brokerage account?' }
  ];

  const result = await context.handleAIChat(messages);
  assert.strictEqual(result, 'ok');
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/chat/completions');

  const body = JSON.parse(requests[0].options.body);
  assertNoExtensionFieldsIn(body.messages, 'body.messages (Copilot Chat / claude-*)');
}

// ── Direct provider paths (custom-provider) ──────────────────────────────────
async function assertDirectResponsesStripsExtensionFieldsFromInput() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'openai-model',
      apiShape: 'openai-responses'
    },
    fetchImpl: async () => ({ ok: true, json: async () => RESPONSE_BY_SHAPE['openai-responses'] })
  });

  const messages = [
    { role: 'user', content: 'Additional selected context:\nx', kind: 'selection-context', contextId: 'ctx-1' },
    { role: 'user', content: 'go' }
  ];

  await context.handleAIChat(messages);
  const body = JSON.parse(requests[0].options.body);
  assertNoExtensionFieldsIn(body.input, 'body.input (direct openai-responses)');
}

async function assertDirectAnthropicStripsExtensionFieldsFromMessages() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'claude-3.5-sonnet',
      apiShape: 'anthropic-messages'
    },
    fetchImpl: async () => ({ ok: true, json: async () => RESPONSE_BY_SHAPE['anthropic-messages'] })
  });

  const messages = [
    { role: 'user', content: 'Additional selected context:\nx', kind: 'selection-context', contextId: 'ctx-1' },
    { role: 'user', content: 'go' }
  ];

  await context.handleAIChat(messages);
  const body = JSON.parse(requests[0].options.body);
  assertNoExtensionFieldsIn(body.messages, 'body.messages (direct anthropic)');
}

async function assertDirectOpenAIChatStripsExtensionFields() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'custom-model',
      apiShape: 'openai-compatible'
    },
    fetchImpl: async () => ({ ok: true, json: async () => RESPONSE_BY_SHAPE['openai-compatible'] })
  });

  const messages = [
    { role: 'user', content: 'Additional selected context:\nx', kind: 'selection-context', contextId: 'ctx-1' },
    { role: 'user', content: 'go' }
  ];

  await context.handleAIChat(messages);
  const body = JSON.parse(requests[0].options.body);
  // First message is the system prompt injected by the background — check
  // ALL entries, that's what the invariant demands.
  assertNoExtensionFieldsIn(body.messages, 'body.messages (direct openai-compatible)');
}

// ── Streaming path via port ─────────────────────────────────────────────────
async function assertCopilotResponsesStreamingStripsExtensionFields() {
  const portMessages = [];
  const { connectListeners, requests } = await createBackgroundContext({
    storage: {
      providerType: 'github-copilot',
      endpoint: '',
      apiKey: '',
      model: 'mai-code-preview',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async (url) => {
      if (url === 'https://api.githubcopilot.com/responses') {
        // Return a body — buildStreamingApiRequest only adds `stream: true`
        // to the outgoing body; the harness fetch returns JSON regardless.
        return { ok: true, json: async () => RESPONSE_BY_SHAPE['openai-responses'] };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const messageListeners = [];
  connectListeners[0]({
    name: 'omnipilot-stream',
    onMessage: { addListener(fn) { messageListeners.push(fn); } },
    postMessage(m) { portMessages.push(m); }
  });

  await messageListeners[0]({
    type: 'AI_CHAT_STREAM',
    messages: [
      { role: 'user', content: 'Additional selected context:\nfoo', kind: 'selection-context', contextId: 'ctx-1' },
      { role: 'user', content: 'explain' }
    ]
  });
  await new Promise(resolve => setTimeout(resolve, 30));

  // Streaming still POSTs the outgoing body first (the harness returns JSON
  // rather than an SSE stream — that's fine; we only care about the body).
  assert.ok(requests.length >= 1, 'streaming should have issued a fetch');
  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.stream, true, 'streaming path must set stream:true');
  assertNoExtensionFieldsIn(body.input, 'streaming body.input (Copilot Responses)');
}

async function main() {
  await assertCopilotResponsesStripsExtensionFieldsFromInput();
  await assertCopilotResponsesStripsFromGptModels();
  await assertCopilotAnthropicStripsExtensionFieldsFromMessages();
  await assertDirectResponsesStripsExtensionFieldsFromInput();
  await assertDirectAnthropicStripsExtensionFieldsFromMessages();
  await assertDirectOpenAIChatStripsExtensionFields();
  await assertCopilotResponsesStreamingStripsExtensionFields();
  console.log('provider-message-sanitization: all assertions passed');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
