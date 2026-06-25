# A2A Client Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral A2A client support so OmniPilot can manage multiple A2A servers, route chat through a selected A2A server, and explicitly delegate unsupported tasks to A2A.

**Architecture:** Keep the current vanilla MV3 extension structure. Add A2A server registry and protocol helpers to `background.js`, A2A settings management to `options.html`/`options.js`, and A2A provider/delegation UI to `content.js`. Store non-secret server metadata in `chrome.storage.sync` and tokens in `chrome.storage.local`.

**Tech Stack:** Chrome/Firefox Manifest V3, vanilla JavaScript, Chrome storage/runtime APIs, Node `assert`/`vm` tests, Playwright extension tests.

---

## File Structure

- Modify `background.js`: add A2A constants, sync/local storage helpers, provider ID helpers, A2A discovery, A2A request normalization, async polling, and A2A routing for active provider chat.
- Modify `background.test.js`: add VM tests for A2A storage split, discovery, immediate responses, async polling, provider-mode chat, token cleanup, and errors.
- Modify `options.html`: add an A2A Servers card with an add form and list container.
- Modify `options.js`: render A2A server rows, save metadata to sync storage, save tokens to local storage, discover/test server, and delete server/token together.
- Modify `options.test.js`: add DOM fixtures and tests for A2A settings behavior.
- Modify `content.js`: add A2A server labels to provider selector, add Delegate to A2A action, render a delegation composer, and send `A2A_DELEGATE_TASK` messages.
- Modify `i18n.js`: add labels for A2A settings and delegation UI.
- Modify `README.md`: document A2A client configuration and delegation.

## Task 1: Add background A2A storage and provider identifiers

**Files:**
- Modify: `background.js`
- Test: `background.test.js`

- [ ] **Step 1: Write failing tests for A2A storage split and provider IDs**

Append these tests before `main()` in `background.test.js`:

```js
async function assertA2aServerMetadataAndTokensUseSeparateStorageAreas() {
  const { context, stores } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ],
      a2aServerTokens: { 'a2a-1': 'secret-token' }
    }
  });

  const servers = await context.loadA2aServersWithTokens();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(servers)), [
    { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true, token: 'secret-token' }
  ]);
  assert.strictEqual(stores.syncStore.a2aServerTokens, undefined);
  assert.strictEqual(stores.localStore.a2aServerTokens['a2a-1'], 'secret-token');
}

async function assertA2aProviderIdsRoundTripServerIds() {
  const { context } = await createBackgroundContext();

  assert.strictEqual(context.createA2aProviderType('a2a-1'), 'a2a:a2a-1');
  assert.strictEqual(context.isA2aProviderType('a2a:a2a-1'), true);
  assert.strictEqual(context.isA2aProviderType('custom-provider'), false);
  assert.strictEqual(context.getA2aServerIdFromProviderType('a2a:a2a-1'), 'a2a-1');
}
```

Add these calls near the top of `main()`:

```js
  await assertA2aServerMetadataAndTokensUseSeparateStorageAreas();
  await assertA2aProviderIdsRoundTripServerIds();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node background.test.js`

Expected: FAIL with `context.loadA2aServersWithTokens is not a function`.

- [ ] **Step 3: Add A2A constants and storage helpers in `background.js`**

In `background.js`, update constants near the top:

```js
const PROVIDER_TYPES = {
  CUSTOM: 'custom-provider',
  GITHUB_COPILOT: 'github-copilot',
  AZURE_FOUNDRY: 'azure-foundry',
  A2A_PREFIX: 'a2a:'
};
```

Update `STORAGE_KEYS`:

```js
const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape', 'providerType', 'authMethod', 'providerConfigs', 'a2aServers'];
const A2A_TOKEN_STORAGE_KEY = 'a2aServerTokens';
```

Add helpers after `storageRemove`:

```js
function getA2aTokenStorageArea() {
  return chrome.storage.local || chrome.storage.sync;
}

function createA2aProviderType(serverId) {
  return `${PROVIDER_TYPES.A2A_PREFIX}${serverId}`;
}

function isA2aProviderType(value) {
  return typeof value === 'string' && value.startsWith(PROVIDER_TYPES.A2A_PREFIX);
}

function getA2aServerIdFromProviderType(value) {
  return isA2aProviderType(value) ? value.slice(PROVIDER_TYPES.A2A_PREFIX.length) : '';
}

function normalizeA2aServer(server) {
  return {
    id: String(server?.id || '').trim(),
    name: String(server?.name || '').trim(),
    endpoint: String(server?.endpoint || '').trim().replace(/\/$/, ''),
    enabled: server?.enabled !== false,
    agentCard: server?.agentCard || null,
    lastDiscoveredAt: server?.lastDiscoveredAt || ''
  };
}

async function loadA2aServers() {
  const stored = await storageGet(['a2aServers'], getConfigStorageArea());
  return (stored.a2aServers || [])
    .map(normalizeA2aServer)
    .filter(server => server.id && server.endpoint);
}

async function loadA2aServerTokens() {
  const stored = await storageGet([A2A_TOKEN_STORAGE_KEY], getA2aTokenStorageArea());
  return stored[A2A_TOKEN_STORAGE_KEY] || {};
}

async function loadA2aServersWithTokens() {
  const [servers, tokens] = await Promise.all([loadA2aServers(), loadA2aServerTokens()]);
  return servers.map(server => ({ ...server, token: tokens[server.id] || '' }));
}

async function getA2aServerWithToken(serverId) {
  const servers = await loadA2aServersWithTokens();
  return servers.find(server => server.id === serverId) || null;
}
```

Update `normalizeProviderType` so A2A IDs survive:

```js
function normalizeProviderType(value, legacyAuthMethod) {
  if (isA2aProviderType(value)) return value;
  if (PROVIDERS[value]) return value;
  if (legacyAuthMethod === AUTH_METHODS.GITHUB_COPILOT) return PROVIDER_TYPES.GITHUB_COPILOT;
  return PROVIDER_TYPES.CUSTOM;
}
```

Update `getProvider` so A2A does not fall into normal providers:

```js
function getProvider(config) {
  if (isA2aProviderType(config.providerType)) {
    return { usesA2a: true, requiresApiKey: false, supportsModelsEndpoint: false };
  }
  return PROVIDERS[normalizeProviderType(config.providerType, config.authMethod)] || PROVIDERS[PROVIDER_TYPES.CUSTOM];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node background.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add background.js background.test.js docs/superpowers/specs/2026-06-25-a2a-client-support-design.md docs/superpowers/plans/2026-06-25-a2a-client-support.md
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "test: cover a2a storage helpers"
```

## Task 2: Add A2A discovery and token cleanup in background

**Files:**
- Modify: `background.js`
- Test: `background.test.js`

- [ ] **Step 1: Write failing tests for discovery and delete cleanup**

Append before `main()` in `background.test.js`:

```js
async function assertA2aDiscoveryFetchesAgentCardWithBearerToken() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ],
      a2aServerTokens: { 'a2a-1': 'secret-token' }
    },
    fetchImpl: async url => {
      if (url === 'https://planner.example/.well-known/agent.json') {
        return {
          ok: true,
          json: async () => ({ name: 'Planning Agent', description: 'Plans work', capabilities: { streaming: false } })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.discoverA2aServer('a2a-1');

  assert.strictEqual(result.name, 'Planning Agent');
  assert.strictEqual(result.description, 'Plans work');
  assert.deepStrictEqual(result.capabilities, { streaming: false });
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer secret-token');
}

async function assertA2aDiscoveryFallsBackToEndpointAgentCard() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ],
      a2aServerTokens: {}
    },
    fetchImpl: async url => {
      if (url === 'https://planner.example/.well-known/agent.json') {
        return { ok: false, status: 404 };
      }
      if (url === 'https://planner.example/a2a/.well-known/agent.json') {
        return {
          ok: true,
          json: async () => ({ name: 'Endpoint Card', skills: [{ name: 'research' }] })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.discoverA2aServer('a2a-1');

  assert.strictEqual(result.name, 'Endpoint Card');
  assert.deepStrictEqual(result.skills, [{ name: 'research' }]);
  assert.deepStrictEqual(requests.map(request => request.url), [
    'https://planner.example/.well-known/agent.json',
    'https://planner.example/a2a/.well-known/agent.json'
  ]);
}

async function assertRemoveA2aServerRemovesLocalTokenOnlyForThatServer() {
  const { context, stores } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'a2a-1', name: 'One', endpoint: 'https://one.example/a2a', enabled: true },
        { id: 'a2a-2', name: 'Two', endpoint: 'https://two.example/a2a', enabled: true }
      ],
      a2aServerTokens: { 'a2a-1': 'one-token', 'a2a-2': 'two-token' }
    }
  });

  await context.removeA2aServer('a2a-1');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(stores.syncStore.a2aServers)), [
    { id: 'a2a-2', name: 'Two', endpoint: 'https://two.example/a2a', enabled: true }
  ]);
  assert.deepStrictEqual(stores.localStore.a2aServerTokens, { 'a2a-2': 'two-token' });
}
```

Add to `main()`:

```js
  await assertA2aDiscoveryFetchesAgentCardWithBearerToken();
  await assertA2aDiscoveryFallsBackToEndpointAgentCard();
  await assertRemoveA2aServerRemovesLocalTokenOnlyForThatServer();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node background.test.js`

Expected: FAIL with `context.discoverA2aServer is not a function`.

- [ ] **Step 3: Implement discovery and removal helpers**

Add after A2A storage helpers in `background.js`:

```js
function createA2aHeaders(token) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function getA2aDiscoveryUrls(endpoint) {
  const normalized = String(endpoint || '').replace(/\/$/, '');
  const urls = [];
  try {
    const url = new URL(normalized);
    urls.push(`${url.origin}/.well-known/agent.json`);
  } catch {
    // Ignore invalid endpoint here; the fetch below will surface the configured endpoint error.
  }
  urls.push(`${normalized}/.well-known/agent.json`);
  return [...new Set(urls)];
}

async function discoverA2aServer(serverId) {
  const server = await getA2aServerWithToken(serverId);
  if (!server) throw new Error('A2A server not found.');
  if (!server.endpoint) throw new Error('A2A server endpoint is required.');

  const headers = createA2aHeaders(server.token);
  let lastError = null;

  for (const url of getA2aDiscoveryUrls(server.endpoint)) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        lastError = new Error(`Discovery failed with HTTP ${response.status || 'error'}.`);
        continue;
      }
      const card = await response.json();
      if (!card || typeof card !== 'object') throw new Error('A2A discovery returned an invalid agent card.');
      return card;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('A2A discovery failed.');
}

async function removeA2aServer(serverId) {
  const [servers, tokens] = await Promise.all([loadA2aServers(), loadA2aServerTokens()]);
  const nextServers = servers.filter(server => server.id !== serverId);
  const nextTokens = { ...tokens };
  delete nextTokens[serverId];

  await Promise.all([
    storageSet({ a2aServers: nextServers }, getConfigStorageArea()),
    storageSet({ [A2A_TOKEN_STORAGE_KEY]: nextTokens }, getA2aTokenStorageArea())
  ]);
}
```

Add runtime message handlers inside `chrome.runtime.onMessage.addListener` before Copilot handlers:

```js
  if (request.type === 'A2A_DISCOVER_SERVER') {
    discoverA2aServer(request.serverId)
      .then(agentCard => sendResponse({ success: true, agentCard }))
      .catch(err => sendResponse({ success: false, error: err.message || 'A2A discovery failed.' }));
    return true;
  }
  if (request.type === 'A2A_REMOVE_SERVER') {
    removeA2aServer(request.serverId)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message || 'A2A server removal failed.' }));
    return true;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node background.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add background.js background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "feat: add a2a discovery helpers"
```

## Task 3: Add A2A task dispatch and async polling in background

**Files:**
- Modify: `background.js`
- Test: `background.test.js`

- [ ] **Step 1: Write failing tests for immediate and async A2A task results**

Append before `main()` in `background.test.js`:

```js
async function assertA2aDelegateTaskReturnsImmediateTextResult() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ],
      a2aServerTokens: { 'a2a-1': 'secret-token' }
    },
    fetchImpl: async url => {
      if (url === 'https://planner.example/a2a') {
        return {
          ok: true,
          json: async () => ({ result: { message: { parts: [{ kind: 'text', text: 'Delegated result' }] } } })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.delegateA2aTask({
    serverId: 'a2a-1',
    task: 'Research this',
    contextText: 'Selected context'
  });

  assert.strictEqual(result, 'Delegated result');
  assert.strictEqual(requests[0].options.method, 'POST');
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer secret-token');
  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.jsonrpc, '2.0');
  assert.strictEqual(body.method, 'message/send');
  assert.ok(body.params.message.parts[0].text.includes('Research this'));
  assert.ok(body.params.message.parts[0].text.includes('Selected context'));
}

async function assertA2aDelegateTaskPollsUntilCompleted() {
  let pollCount = 0;
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ],
      a2aServerTokens: {}
    },
    fetchImpl: async (url, options) => {
      if (url !== 'https://planner.example/a2a') throw new Error(`Unexpected fetch ${url}`);
      const body = JSON.parse(options.body);
      if (body.method === 'message/send') {
        return { ok: true, json: async () => ({ result: { id: 'task-1', status: { state: 'working' } } }) };
      }
      if (body.method === 'tasks/get') {
        pollCount += 1;
        return {
          ok: true,
          json: async () => pollCount === 1
            ? ({ result: { id: 'task-1', status: { state: 'working' } } })
            : ({ result: { id: 'task-1', status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: 'Async done' }] }] } })
        };
      }
      throw new Error(`Unexpected method ${body.method}`);
    }
  });

  const result = await context.delegateA2aTask({ serverId: 'a2a-1', task: 'Do async work', contextText: '' });

  assert.strictEqual(result, 'Async done');
  assert.deepStrictEqual(requests.map(request => JSON.parse(request.options.body).method), ['message/send', 'tasks/get', 'tasks/get']);
}

async function assertA2aDelegateTaskSurfacesFailedTaskState() {
  const { context } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ]
    },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === 'message/send') {
        return { ok: true, json: async () => ({ result: { id: 'task-1', status: { state: 'failed', message: { parts: [{ text: 'No access' }] } } } }) };
      }
      throw new Error(`Unexpected method ${body.method}`);
    }
  });

  await assert.rejects(
    () => context.delegateA2aTask({ serverId: 'a2a-1', task: 'Do work', contextText: '' }),
    err => err.message.includes('No access')
  );
}
```

Add to `main()`:

```js
  await assertA2aDelegateTaskReturnsImmediateTextResult();
  await assertA2aDelegateTaskPollsUntilCompleted();
  await assertA2aDelegateTaskSurfacesFailedTaskState();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node background.test.js`

Expected: FAIL with `context.delegateA2aTask is not a function`.

- [ ] **Step 3: Implement A2A request/response helpers**

Add after discovery helpers in `background.js`:

```js
const A2A_POLL_INTERVAL_MS = 500;
const A2A_MAX_POLL_ATTEMPTS = 60;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildA2aTaskText(task, contextText) {
  const trimmedTask = String(task || '').trim();
  const trimmedContext = String(contextText || '').trim();
  if (!trimmedTask) throw new Error('A2A task prompt is required.');
  return trimmedContext
    ? `${trimmedTask}\n\nContext from selected page text:\n${trimmedContext}`
    : trimmedTask;
}

function createA2aRpcRequest(method, params) {
  return {
    jsonrpc: '2.0',
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    method,
    params
  };
}

function createA2aMessageParams(task, contextText) {
  return {
    message: {
      role: 'user',
      parts: [{ kind: 'text', type: 'text', text: buildA2aTaskText(task, contextText) }]
    }
  };
}

function extractA2aTextFromParts(parts = []) {
  return parts
    .map(part => part?.text || part?.content || '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractA2aText(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (payload.text) return String(payload.text);
  if (payload.content && typeof payload.content === 'string') return payload.content;
  if (payload.message?.parts) return extractA2aTextFromParts(payload.message.parts);
  if (payload.status?.message?.parts) return extractA2aTextFromParts(payload.status.message.parts);
  if (Array.isArray(payload.parts)) return extractA2aTextFromParts(payload.parts);
  if (Array.isArray(payload.artifacts)) {
    return payload.artifacts
      .map(artifact => extractA2aTextFromParts(artifact.parts || []))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

function getA2aTaskState(task) {
  return String(task?.status?.state || task?.state || '').toLowerCase();
}

function getA2aTaskId(task) {
  return task?.id || task?.taskId || task?.task_id || '';
}

function assertA2aTaskNotFailed(task) {
  const state = getA2aTaskState(task);
  if (['failed', 'canceled', 'cancelled', 'rejected'].includes(state)) {
    throw new Error(extractA2aText(task) || `A2A task ${state}.`);
  }
}

function isA2aTaskComplete(task) {
  const state = getA2aTaskState(task);
  return ['completed', 'complete', 'succeeded', 'success', 'done'].includes(state) || Boolean(extractA2aText(task) && !getA2aTaskId(task));
}

async function postA2aRpc(server, method, params) {
  const response = await fetch(server.endpoint, {
    method: 'POST',
    headers: createA2aHeaders(server.token),
    body: JSON.stringify(createA2aRpcRequest(method, params))
  });

  if (!response.ok) {
    let message = `A2A server error: ${response.status}`;
    if (response.status === 401 || response.status === 403) message += '. Check the A2A token.';
    throw new Error(message);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'A2A server returned an error.');
  return data.result || data;
}

async function pollA2aTask(server, taskId) {
  for (let attempt = 0; attempt < A2A_MAX_POLL_ATTEMPTS; attempt += 1) {
    const task = await postA2aRpc(server, 'tasks/get', { id: taskId });
    assertA2aTaskNotFailed(task);
    if (isA2aTaskComplete(task)) return task;
    await wait(A2A_POLL_INTERVAL_MS);
  }
  throw new Error('A2A task timed out.');
}

async function delegateA2aTask({ serverId, task, contextText = '' }) {
  const server = await getA2aServerWithToken(serverId);
  if (!server) throw new Error('A2A server not found.');
  if (!server.enabled) throw new Error('A2A server is disabled.');
  if (!server.endpoint) throw new Error('A2A server endpoint is required.');

  const result = await postA2aRpc(server, 'message/send', createA2aMessageParams(task, contextText));
  assertA2aTaskNotFailed(result);

  if (isA2aTaskComplete(result)) {
    const text = extractA2aText(result);
    if (text) return text;
  }

  const taskId = getA2aTaskId(result);
  if (taskId) {
    const completed = await pollA2aTask(server, taskId);
    const text = extractA2aText(completed);
    if (text) return text;
  }

  const text = extractA2aText(result);
  if (text) return text;
  throw new Error('A2A server returned an empty or unsupported response.');
}
```

- [ ] **Step 4: Add runtime message handler**

Add inside `chrome.runtime.onMessage.addListener`:

```js
  if (request.type === 'A2A_DELEGATE_TASK') {
    delegateA2aTask(request)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message || 'A2A delegation failed.' }));
    return true;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node background.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add background.js background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "feat: delegate tasks to a2a servers"
```

## Task 4: Route active A2A provider chat through A2A

**Files:**
- Modify: `background.js`
- Test: `background.test.js`

- [ ] **Step 1: Write failing provider-mode chat tests**

Append before `main()` in `background.test.js`:

```js
async function assertA2aProviderChatDelegatesLatestUserMessageWithHistoryContext() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'a2a:a2a-1',
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ],
      a2aServerTokens: { 'a2a-1': 'secret-token' }
    },
    fetchImpl: async url => {
      if (url === 'https://planner.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ text: 'A2A chat response' }] } } }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([
    { role: 'user', content: 'Additional selected context:\nAlpha' },
    { role: 'assistant', content: 'Earlier response' },
    { role: 'user', content: 'Can you plan next steps?' }
  ]);

  assert.strictEqual(result, 'A2A chat response');
  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.method, 'message/send');
  assert.ok(body.params.message.parts[0].text.includes('Can you plan next steps?'));
  assert.ok(body.params.message.parts[0].text.includes('Additional selected context'));
}
```

Add to `main()`:

```js
  await assertA2aProviderChatDelegatesLatestUserMessageWithHistoryContext();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node background.test.js`

Expected: FAIL because `handleAIChat` still calls normal API execution.

- [ ] **Step 3: Implement A2A provider chat routing**

Add these helpers before `handleAIChat` in `background.js`:

```js
function getLatestUserMessage(messages = []) {
  return [...messages].reverse().find(message => message.role === 'user' && typeof message.content === 'string')?.content || '';
}

function getA2aConversationContext(messages = []) {
  return messages
    .slice(0, -1)
    .map(message => `${message.role}: ${message.content}`)
    .join('\n\n')
    .trim();
}

async function handleA2aProviderChat(config, messages) {
  return delegateA2aTask({
    serverId: getA2aServerIdFromProviderType(config.providerType),
    task: getLatestUserMessage(messages),
    contextText: getA2aConversationContext(messages)
  });
}
```

Replace `handleAIChat` with:

```js
async function handleAIChat(messages) {
  const config = await loadConfig();
  if (isA2aProviderType(config.providerType)) {
    return handleA2aProviderChat(config, messages);
  }

  return executeApiRequest({
    messages,
    systemPrompt: 'You are a helpful assistant. Continue the conversation naturally.',
    config
  });
}
```

Update `executeApiRequest` signature so optional preloaded config avoids double loading:

```js
async function executeApiRequest({ messages, systemPrompt, config: preloadedConfig }) {
  const config = preloadedConfig || await loadConfig();
  const provider = getProvider(config);
  let copilotToken = '';
  // keep the rest unchanged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node background.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add background.js background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "feat: route a2a provider chat"
```

## Task 5: Add A2A settings UI

**Files:**
- Modify: `options.html`
- Modify: `options.js`
- Modify: `i18n.js`
- Test: `options.test.js`

- [ ] **Step 1: Write failing options tests for A2A settings**

In `options.test.js`, extend the `elements` object in `createTestContext` with:

```js
    a2aServerName: createElement('Planner'),
    a2aServerEndpoint: createElement('https://planner.example/a2a'),
    a2aServerToken: createElement('secret-token'),
    addA2aServerBtn: createElement(),
    a2aServerList: createElement(),
    a2aStatus: createElement()
```

Extend `chrome.storage.local` in `createTestContext` so it captures writes/removes:

```js
      local: {
        get(keys, callback) {
          if (localStorageGetImpl) return localStorageGetImpl(keys, callback, context);
          callback({});
        },
        set(value, callback) { context.localWrites.push(value); callback?.(); },
        remove(keys, callback) { context.localRemoves.push(keys); callback?.(); }
      }
```

Add these arrays to `context` before `chrome`:

```js
    localWrites: [],
    localRemoves: [],
```

Update the return value:

```js
  return { context, elements, fetchUrls, sendMessageCalls, domListeners, timeoutCalls, syncWrites, localWrites: context.localWrites, localRemoves: context.localRemoves };
```

Append tests before `main()`:

```js
async function testAddA2aServerStoresMetadataInSyncAndTokenInLocal() {
  const { elements, domListeners, syncWrites, localWrites } = createTestContext();
  await domListeners.DOMContentLoaded();

  await elements.addA2aServerBtn.listeners.click();

  const syncSaved = syncWrites.at(-1);
  assert.strictEqual(syncSaved.a2aServers.length, 1);
  assert.strictEqual(syncSaved.a2aServers[0].name, 'Planner');
  assert.strictEqual(syncSaved.a2aServers[0].endpoint, 'https://planner.example/a2a');
  assert.strictEqual(syncSaved.a2aServers[0].enabled, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(syncSaved.a2aServers[0], 'token'));
  assert.strictEqual(localWrites.at(-1).a2aServerTokens[syncSaved.a2aServers[0].id], 'secret-token');
}

async function testRenderA2aServersShowsStoredServersWithoutTokenText() {
  const { elements, domListeners } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        languagePreference: 'en',
        a2aServers: [
          { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
        ]
      });
    },
    localStorageGetImpl(keys, callback) {
      callback({ a2aServerTokens: { 'a2a-1': 'secret-token' } });
    }
  });

  await domListeners.DOMContentLoaded();

  assert.ok(elements.a2aServerList.innerHTML.includes('Planner'));
  assert.ok(elements.a2aServerList.innerHTML.includes('https://planner.example/a2a'));
  assert.ok(!elements.a2aServerList.innerHTML.includes('secret-token'));
}

async function testDiscoverA2aServerUpdatesAgentCardMetadata() {
  const { context, elements, domListeners, sendMessageCalls, syncWrites } = createTestContext({
    storageGetImpl(keys, callback) {
      callback({
        languagePreference: 'en',
        a2aServers: [
          { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
        ]
      });
    },
    sendMessageImpl(message, callback) {
      if (message.type === 'GET_MODELS') return callback({ models: [] });
      if (message.type === 'A2A_DISCOVER_SERVER') {
        callback({ success: true, agentCard: { name: 'Discovered Planner', description: 'Plans work' } });
        return;
      }
      callback({ success: false, error: `Unexpected message ${message.type}` });
    }
  });

  await domListeners.DOMContentLoaded();
  await context.discoverAndSaveA2aServer('a2a-1');

  assert.strictEqual(sendMessageCalls.at(-1).type, 'A2A_DISCOVER_SERVER');
  assert.strictEqual(sendMessageCalls.at(-1).serverId, 'a2a-1');
  const saved = syncWrites.at(-1).a2aServers[0];
  assert.strictEqual(saved.agentCard.name, 'Discovered Planner');
  assert.strictEqual(elements.a2aStatus.className, 'status');
}
```

Add to `main()`:

```js
  await testAddA2aServerStoresMetadataInSyncAndTokenInLocal();
  await testRenderA2aServersShowsStoredServersWithoutTokenText();
  await testDiscoverA2aServerUpdatesAgentCardMetadata();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node options.test.js`

Expected: FAIL because A2A UI functions/listeners are missing.

- [ ] **Step 3: Add A2A settings card to `options.html`**

Insert after the Connection card and before the Model card:

```html
    <div class="card" id="a2aCard">
      <div class="card-title" data-i18n="a2aServers">A2A Servers</div>
      <div class="field">
        <label data-i18n="a2aServerName">Server Name</label>
        <input type="text" id="a2aServerName" placeholder="Planning Agent">
      </div>
      <div class="field">
        <label data-i18n="a2aEndpoint">A2A Endpoint</label>
        <input type="text" id="a2aServerEndpoint" placeholder="https://agent.example.com/a2a">
        <div class="hint" data-i18n="a2aEndpointHint">Add the A2A JSON-RPC endpoint. Discovery will also try the agent card well-known URL.</div>
      </div>
      <div class="field">
        <label data-i18n="a2aToken">Token</label>
        <input type="password" id="a2aServerToken" placeholder="optional bearer token">
        <div class="hint" data-i18n="a2aTokenHint">Tokens are stored locally and are not synced.</div>
      </div>
      <button type="button" class="edit-models-btn" id="addA2aServerBtn" data-i18n="addA2aServer">Add A2A Server</button>
      <div class="model-status" id="a2aStatus"></div>
      <div id="a2aServerList"></div>
    </div>
```

Add compact list styles before `</style>`:

```css
    .a2a-server-row {
      margin-top: 10px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg3);
    }
    .a2a-server-title { font-size: 13px; font-weight: 600; margin-bottom: 3px; }
    .a2a-server-meta { font-size: 11px; color: var(--ink2); overflow-wrap: anywhere; }
    .a2a-server-actions { display: flex; gap: 6px; margin-top: 8px; }
    .a2a-server-actions button {
      flex: 1;
      padding: 6px 8px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 7px;
      color: var(--ink2);
      cursor: pointer;
      font: inherit;
      font-size: 11px;
    }
    .a2a-server-actions button:hover { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 4: Add i18n labels**

In `i18n.js`, add English keys inside `MESSAGES.en`:

```js
      a2aDelegate: 'Delegate to A2A…',
      a2aEndpoint: 'A2A Endpoint',
      a2aEndpointHint: 'Add the A2A JSON-RPC endpoint. Discovery will also try the agent card well-known URL.',
      a2aServerName: 'Server Name',
      a2aServers: 'A2A Servers',
      a2aToken: 'Token',
      a2aTokenHint: 'Tokens are stored locally and are not synced.',
      addA2aServer: 'Add A2A Server',
      discover: 'Discover',
      remove: 'Remove',
```

Add Chinese keys inside `MESSAGES.zh`:

```js
      a2aDelegate: '委托给 A2A…',
      a2aEndpoint: 'A2A 端点',
      a2aEndpointHint: '添加 A2A JSON-RPC 端点。发现功能也会尝试 agent card well-known URL。',
      a2aServerName: '服务器名称',
      a2aServers: 'A2A 服务器',
      a2aToken: '令牌',
      a2aTokenHint: '令牌仅保存在本地，不会同步。',
      addA2aServer: '添加 A2A 服务器',
      discover: '发现',
      remove: '删除',
```

- [ ] **Step 5: Implement A2A options helpers in `options.js`**

Update `STORAGE_KEYS`:

```js
const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'models', 'themePreference', 'apiShape', 'languagePreference', 'providerType', 'authMethod', 'providerConfigs', 'a2aServers'];
const A2A_TOKEN_STORAGE_KEY = 'a2aServerTokens';
```

Add module state near existing globals:

```js
let a2aServers = [];
let a2aServerTokens = {};
```

Add helpers before `DOMContentLoaded`:

```js
function createA2aServerId() {
  return `a2a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeA2aEndpoint(endpoint) {
  return String(endpoint || '').trim().replace(/\/$/, '');
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

function getA2aTokens() {
  return new Promise(resolve => getA2aTokenStorageArea().get([A2A_TOKEN_STORAGE_KEY], stored => resolve(stored[A2A_TOKEN_STORAGE_KEY] || {})));
}

function saveA2aServers() {
  return new Promise(resolve => chrome.storage.sync.set({ a2aServers }, resolve));
}

function saveA2aTokens() {
  return new Promise(resolve => getA2aTokenStorageArea().set({ [A2A_TOKEN_STORAGE_KEY]: a2aServerTokens }, resolve));
}

function renderA2aServers() {
  const list = document.getElementById('a2aServerList');
  if (!list) return;
  if (!a2aServers.length) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = a2aServers.map(server => {
    const cardName = server.agentCard?.name ? ` · ${escapeHtml(server.agentCard.name)}` : '';
    return `<div class="a2a-server-row" data-server-id="${escapeHtml(server.id)}">
      <div class="a2a-server-title">${escapeHtml(server.name)}${cardName}</div>
      <div class="a2a-server-meta">${escapeHtml(server.endpoint)}</div>
      <div class="a2a-server-actions">
        <button type="button" data-a2a-discover="${escapeHtml(server.id)}">${label('discover')}</button>
        <button type="button" data-a2a-remove="${escapeHtml(server.id)}">${label('remove')}</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-a2a-discover]').forEach(button => {
    button.addEventListener('click', () => discoverAndSaveA2aServer(button.getAttribute('data-a2a-discover')));
  });
  list.querySelectorAll('[data-a2a-remove]').forEach(button => {
    button.addEventListener('click', () => removeA2aServer(button.getAttribute('data-a2a-remove')));
  });
}

async function addA2aServerFromForm() {
  const name = document.getElementById('a2aServerName')?.value.trim();
  const endpoint = normalizeA2aEndpoint(document.getElementById('a2aServerEndpoint')?.value);
  const token = document.getElementById('a2aServerToken')?.value.trim() || '';
  const status = document.getElementById('a2aStatus');

  if (!name || !endpoint) {
    if (status) {
      status.textContent = `${label('errorPrefix')} name and endpoint are required.`;
      status.className = 'status error';
    }
    return;
  }

  const server = { id: createA2aServerId(), name, endpoint, enabled: true };
  a2aServers = [...a2aServers, server];
  if (token) a2aServerTokens = { ...a2aServerTokens, [server.id]: token };

  await Promise.all([saveA2aServers(), saveA2aTokens()]);
  document.getElementById('a2aServerToken').value = '';
  if (status) {
    status.textContent = label('saved');
    status.className = 'status';
  }
  renderA2aServers();
}

async function discoverAndSaveA2aServer(serverId) {
  const status = document.getElementById('a2aStatus');
  if (status) {
    status.textContent = label('checking');
    status.className = 'model-status loading';
  }

  const result = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'A2A_DISCOVER_SERVER', serverId }, resolve));
  if (!result?.success) {
    if (status) {
      status.textContent = `${label('errorPrefix')} ${result?.error || 'A2A discovery failed.'}`;
      status.className = 'status error';
    }
    return;
  }

  a2aServers = a2aServers.map(server => server.id === serverId
    ? { ...server, agentCard: result.agentCard, lastDiscoveredAt: new Date().toISOString() }
    : server);
  await saveA2aServers();
  if (status) {
    status.textContent = label('saved');
    status.className = 'status';
  }
  renderA2aServers();
}

async function removeA2aServer(serverId) {
  a2aServers = a2aServers.filter(server => server.id !== serverId);
  const nextTokens = { ...a2aServerTokens };
  delete nextTokens[serverId];
  a2aServerTokens = nextTokens;
  await Promise.all([
    saveA2aServers(),
    saveA2aTokens(),
    new Promise(resolve => chrome.runtime.sendMessage({ type: 'A2A_REMOVE_SERVER', serverId }, resolve))
  ]);
  renderA2aServers();
}
```

Inside `DOMContentLoaded`, after `providerConfigs` initialization, load tokens and render:

```js
    a2aServers = (storedConfig.a2aServers || []).map(server => ({ ...server, enabled: server.enabled !== false }));
    getA2aTokens().then(tokens => {
      a2aServerTokens = tokens;
      renderA2aServers();
    });
```

At the end of `DOMContentLoaded`, add listener:

```js
  document.getElementById('addA2aServerBtn')?.addEventListener('click', addA2aServerFromForm);
```

- [ ] **Step 6: Run tests**

Run: `node options.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add options.html options.js options.test.js i18n.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "feat: add a2a settings UI"
```

## Task 6: Show A2A servers in content provider selector

**Files:**
- Modify: `content.js`
- Test: `content-language.test.js` or add content VM coverage in `content-language.test.js`

- [ ] **Step 1: Write failing content provider selector test**

Open `content-language.test.js` and add a VM test that loads `i18n.js` and `content.js` with fake storage containing:

```js
{
  providerType: 'a2a:a2a-1',
  a2aServers: [
    { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
  ]
}
```

The assertion should verify that `getProviderLabel('a2a:a2a-1', '')` returns `Planner` and that A2A provider entries are included by `getProviderEntries()`.

Use this complete test function if the file already has a VM context pattern:

```js
async function testA2aProviderLabelUsesConfiguredServerName() {
  const { context } = createContentContext({
    storage: {
      providerType: 'a2a:a2a-1',
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ]
    }
  });

  assert.strictEqual(context.getProviderLabel('a2a:a2a-1', ''), 'Planner');
  assert.ok(context.getProviderEntries().some(entry => entry.providerType === 'a2a:a2a-1' && entry.label === 'Planner'));
}
```

Add it to that test file's `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node content-language.test.js`

Expected: FAIL because `getProviderEntries` or A2A label support is missing.

- [ ] **Step 3: Implement provider labels and storage loading in `content.js`**

Near existing provider globals, add:

```js
  let a2aServers = [];
```

Update initial storage load defaults:

```js
  chrome.storage.sync.get({ model: 'claude-sonnet-4-5', endpoint: 'https://api.omnillm.com/v1', apiKey: '', providerType: 'custom-provider', authMethod: 'api-key', a2aServers: [] }, cfg => {
    a2aServers = cfg.a2aServers || [];
    currentModel = cfg.model || 'claude-sonnet-4-5';
    currentProviderType = cfg.providerType || 'custom-provider';
    currentAuthMethod = cfg.authMethod || 'api-key';
    currentApiKey = cfg.apiKey || '';
    currentEndpoint = cfg.endpoint || '';
    currentProvider = getProviderLabel(currentProviderType || currentAuthMethod, currentEndpoint);
    hasApiKey = currentProviderType === 'github-copilot' || currentAuthMethod === 'github-copilot' || currentProviderType?.startsWith?.('a2a:') || Boolean(currentApiKey);
    updatePanelMeta();
  });
```

Update storage change listener:

```js
    if (changes.a2aServers) a2aServers = changes.a2aServers.newValue || [];
    if (changes.endpoint || changes.providerType || changes.authMethod || changes.a2aServers) {
      currentProvider = getProviderLabel(currentProviderType || currentAuthMethod, currentEndpoint);
      updatePanelMeta();
    }
    if (changes.apiKey || changes.authMethod || changes.providerType || changes.a2aServers) {
      hasApiKey = currentProviderType === 'github-copilot' || currentAuthMethod === 'github-copilot' || currentProviderType?.startsWith?.('a2a:') || Boolean(currentApiKey);
    }
```

Add helpers near `getProviderLabel`:

```js
  function isA2aProviderType(providerType) {
    return typeof providerType === 'string' && providerType.startsWith('a2a:');
  }

  function getA2aServerIdFromProviderType(providerType) {
    return isA2aProviderType(providerType) ? providerType.slice(4) : '';
  }

  function getA2aServerLabel(providerType) {
    const serverId = getA2aServerIdFromProviderType(providerType);
    return a2aServers.find(server => server.id === serverId)?.name || 'A2A';
  }

  function getProviderEntries() {
    return [
      ...Object.entries(PROVIDER_LABELS).map(([providerType, label]) => ({ providerType, label })),
      ...a2aServers
        .filter(server => server.enabled !== false)
        .map(server => ({ providerType: `a2a:${server.id}`, label: server.name || 'A2A' }))
    ];
  }
```

Update `getProviderLabel`:

```js
  function getProviderLabel(providerType, endpoint) {
    if (isA2aProviderType(providerType)) return getA2aServerLabel(providerType);
    return PROVIDER_LABELS[providerType] || detectProvider(endpoint || '');
  }
```

Update `showProviderSelector` loop:

```js
    getProviderEntries().forEach(({ providerType, label: providerLabel }) => {
```

- [ ] **Step 4: Run content tests**

Run: `node content-language.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add content.js content-language.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "feat: show a2a providers in panel"
```

## Task 7: Add explicit Delegate to A2A flow in content script

**Files:**
- Modify: `content.js`
- Modify: `i18n.js`
- Test: `content-language.test.js` or existing content test file

- [ ] **Step 1: Write failing delegation UI test**

Add a VM test that sets enabled A2A server storage, calls the exposed `getDropdownActionIds()` helper, and asserts it includes `delegate-a2a`. If no helper exists, add it in the implementation and test it.

Test code:

```js
async function testDelegateA2aActionAppearsWhenServerEnabled() {
  const { context } = createContentContext({
    storage: {
      apiKey: 'test-key',
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ]
    }
  });

  assert.ok(context.getDropdownActionIds().includes('delegate-a2a'));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node content-language.test.js`

Expected: FAIL because `getDropdownActionIds` is missing or delegation is absent.

- [ ] **Step 3: Add i18n labels**

In `i18n.js`, add English keys:

```js
      a2aTaskPlaceholder: 'Describe the task to delegate...',
      delegate: 'Delegate',
      delegating: 'Delegating',
```

Add Chinese keys:

```js
      a2aTaskPlaceholder: '描述要委托的任务...',
      delegate: '委托',
      delegating: '委托中',
```

- [ ] **Step 4: Implement Delegate to A2A action in `content.js`**

Add helper near `ACTIONS`:

```js
  function hasEnabledA2aServers() {
    return a2aServers.some(server => server.enabled !== false);
  }

  function getDropdownActions() {
    return hasEnabledA2aServers()
      ? [...ACTIONS, { id: 'delegate-a2a', labelKey: 'a2aDelegate', icon: '🤝' }]
      : ACTIONS;
  }

  function getDropdownActionIds() {
    return getDropdownActions().map(action => action.id);
  }
```

Update `createDropdown()` action loop:

```js
      getDropdownActions().forEach(action => {
```

Inside click handler before `runAction(action.id);`:

```js
          if (action.id === 'delegate-a2a') {
            showA2aDelegationPanel();
            return;
          }
```

Add delegation panel functions before `runAction`:

```js
  function showA2aDelegationPanel() {
    hideDropdown();
    hideBubble();
    currentAction = '';
    if (!panel) showPanel('', false, false);
    else panel.style.display = 'flex';
    updatePanelMeta();

    const enabledServers = a2aServers.filter(server => server.enabled !== false);
    const body = panel.querySelector('.omnipilot-panel-body');
    const selected = lastSelection ? renderSelectionContext(lastSelection) : '';
    body.innerHTML = `${selected}
      <div class="omnipilot-a2a-form">
        <select class="omnipilot-a2a-server">
          ${enabledServers.map(server => `<option value="${escapeHtml(server.id)}">${escapeHtml(server.name || 'A2A')}</option>`).join('')}
        </select>
        <textarea class="omnipilot-a2a-task" placeholder="${label('a2aTaskPlaceholder')}"></textarea>
        <button class="omnipilot-a2a-submit">${label('delegate')}</button>
      </div>`;

    body.querySelector('.omnipilot-a2a-submit')?.addEventListener('click', () => {
      const serverId = body.querySelector('.omnipilot-a2a-server')?.value || '';
      const task = body.querySelector('.omnipilot-a2a-task')?.value || '';
      sendA2aDelegation(serverId, task);
    });

    if (!panel.dataset.dragged) positionPanel();
    body.querySelector('.omnipilot-a2a-task')?.focus();
  }

  function sendA2aDelegation(serverId, task) {
    const body = panel.querySelector('.omnipilot-panel-body');
    const trimmedTask = task.trim();
    if (!trimmedTask) {
      body.innerHTML += `<div class="omnipilot-error">${label('a2aTaskPlaceholder')}</div>`;
      return;
    }

    body.innerHTML += `<div class="omnipilot-msg omnipilot-msg-user">${escapeHtml(trimmedTask)}</div>`;
    body.innerHTML += `<div class="omnipilot-loading"><div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">${label('delegating')}</span><button class="omnipilot-cancel-btn" title="${label('cancel')}">✕</button></div>`;
    body.querySelector('.omnipilot-cancel-btn')?.addEventListener('click', cancelRequest);

    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      body.querySelector('.omnipilot-loading')?.remove();
      body.innerHTML += `<div class="omnipilot-error">${label('extensionContextUnavailable')}</div>`;
      return;
    }

    abortController = new AbortController();
    const signal = abortController.signal;
    runtime.sendMessage({ type: 'A2A_DELEGATE_TASK', serverId, task: trimmedTask, contextText: lastSelection || '' }, response => {
      if (signal.aborted) return;
      body.querySelector('.omnipilot-loading')?.remove();
      if (runtime.lastError) {
        body.innerHTML += `<div class="omnipilot-error">${humanizeError(runtime.lastError.message)}</div>`;
        return;
      }
      if (!response?.success) {
        body.innerHTML += `<div class="omnipilot-error">${humanizeError(response?.error)}</div>`;
        return;
      }
      conversationHistory.push({ role: 'user', content: trimmedTask });
      conversationHistory.push({ role: 'assistant', content: response.result });
      body.innerHTML += `<div class="omnipilot-msg omnipilot-msg-assistant">${formatResult(response.result)}</div>`;
      body.scrollTop = body.scrollHeight;
    });
  }
```

Add minimal CSS to `styles.css`:

```css
.omnipilot-a2a-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.omnipilot-a2a-form select,
.omnipilot-a2a-form textarea {
  width: 100%;
  border: 1px solid var(--op-border);
  border-radius: 8px;
  background: var(--op-bg-2);
  color: var(--op-text);
  padding: 8px;
  font: inherit;
}
.omnipilot-a2a-form textarea {
  min-height: 84px;
  resize: vertical;
}
.omnipilot-a2a-submit {
  border: 0;
  border-radius: 8px;
  background: var(--op-accent);
  color: #fff;
  padding: 8px 10px;
  cursor: pointer;
}
```

- [ ] **Step 5: Run content tests**

Run: `node content-language.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add content.js styles.css i18n.js content-language.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "feat: add explicit a2a delegation"
```

## Task 8: Add documentation and full regression verification

**Files:**
- Modify: `README.md`
- Test: all test files

- [ ] **Step 1: Update README configuration table**

In `README.md`, replace the configuration table block with:

```markdown
| Field | Default | Description |
|-------|---------|-------------|
| Provider | `Custom Provider` | Choose GitHub Copilot, Custom Provider, Azure Foundry, or a configured A2A server |
| API Endpoint | `https://api.omnillm.com/v1` | OmniLLM/Anthropic-compatible API endpoint for API key mode |
| API Key | — | Your API key for API key mode |
| API Format | `OpenAI-compatible` | Request shape for API key mode: OpenAI chat completions, Anthropic Messages, or OpenAI Responses |
| Model | `claude-sonnet-4-5` | Any model available to your selected provider |
| A2A Servers | — | Optional remote A2A agents with name, endpoint, and local-only bearer token |
```

Add after the paragraph about GitHub Copilot:

```markdown
### A2A Delegation

OmniPilot can act as an A2A client. In Settings, add one or more A2A servers with a display name, JSON-RPC endpoint, and optional bearer token. Server metadata syncs through browser storage, while tokens stay in local extension storage and are not synced.

Configured A2A servers appear in the provider selector for panel chat. When selected text needs work outside OmniPilot's built-in actions, choose **Delegate to A2A…**, pick a server, and describe the task. OmniPilot sends the task and selected page text to the remote A2A server and shows the normalized result in the panel.
```

- [ ] **Step 2: Run unit tests**

Run: `npm run test:unit`

Expected: PASS.

- [ ] **Step 3: Run Playwright tests**

Run: `npm run test:playwright`

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Run code review and security review before final commit**

Run the available review skill or agents required by project instructions. At minimum, run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 6: Commit docs and final verification changes**

Run:

```bash
git add README.md
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "docs: document a2a client support"
```

## Self-Review

- Spec coverage: The tasks cover hybrid A2A server storage, settings UI, discovery, provider-mode chat, explicit delegation, async polling, error paths, tests, and documentation.
- Placeholder scan: No TBD/TODO placeholders are present. Each task includes concrete test and implementation snippets.
- Type consistency: A2A provider IDs consistently use `a2a:<serverId>`. Server metadata uses `a2aServers`; tokens use `a2aServerTokens`; task dispatch uses `A2A_DELEGATE_TASK`.
