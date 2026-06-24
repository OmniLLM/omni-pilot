# Direct GitHub Copilot Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GitHub Copilot OAuth mode list selectable Copilot models and send requests directly to GitHub Copilot using the exchanged Copilot token.

**Architecture:** Keep OmniPilot's existing vanilla-JS extension structure. Add Copilot-specific request/model helpers in `background.js`, keep options-page model UI visible for Copilot, and let the existing generic `GET_MODELS` message return provider models based on the selected auth method. The implementation mirrors omnillm's flow: GitHub device OAuth token → short-lived Copilot API token → `https://api.githubcopilot.com/models` and `https://api.githubcopilot.com/chat/completions` with Copilot headers.

**Tech Stack:** Chrome/Firefox Manifest V3 extension, vanilla JavaScript, `chrome.storage.sync`, `fetch`, Node `vm`-based tests using `assert`.

---

## File Structure

- `background.js`
  - Owns OAuth token exchange, Copilot request headers, model listing, and AI action/chat API calls.
  - Add constants for Copilot API base URL and header values.
  - Add `createCopilotHeaders()`, `fetchCopilotModels()`, and Copilot branch in `buildApiRequest()` / `handleGetModels()`.
- `options.js`
  - Owns the settings page behavior.
  - Keep the model card visible in GitHub Copilot mode.
  - Fetch models through the background `GET_MODELS` message when GitHub Copilot mode is active, because options page does not have direct access to the exchanged Copilot token.
- `background.test.js`
  - Add focused tests for direct Copilot `/models`, direct Copilot chat completion URL/headers, token exchange auth header, and message handler `GET_MODELS` behavior.
  - Update existing expectations where direct Copilot mode should no longer use the configured endpoint.
- `options.test.js`
  - Add a focused test that Copilot mode shows the model card and asks the background service worker for models.
- `README.md`
  - Document GitHub Copilot auth mode and direct model selection.

---

### Task 1: Add Copilot Header and Model Helpers in `background.js`

**Files:**
- Modify: `background.js:13-19`
- Modify: `background.js:240-251`
- Modify: `background.js:337-350`
- Test: `background.test.js`

- [ ] **Step 1: Write failing tests for Copilot model listing**

Add these helper tests before `main()` in `background.test.js`:

```js
async function assertCopilotGetModelsUsesDirectCopilotEndpoint() {
  const requests = [];

  const context = {
    console: { info() {}, error() {}, warn() {} },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        sync: {
          get(defaults, cb) {
            cb({
              ...defaults,
              endpoint: 'http://localhost:5000/v1',
              apiKey: '',
              model: 'gpt-4o',
              authMethod: 'github-copilot',
              copilotGithubToken: 'gho_token',
              copilotAccessToken: 'copilot_tok',
              copilotTokenExpiry: Date.now() + 60000
            });
          },
          set() { return Promise.resolve(); }
        }
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 'gpt-4o', name: 'GPT-4o' },
            { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5' }
          ],
          object: 'list'
        })
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  const models = await context.handleGetModels();

  assert.deepStrictEqual(models, ['claude-sonnet-4.5', 'gpt-4o']);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/models');
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer copilot_tok');
  assert.strictEqual(requests[0].options.headers['Editor-Plugin-Version'], 'copilot-chat/0.26.7');
  assert.strictEqual(requests[0].options.headers['X-Github-Api-Version'], '2025-04-01');
}

async function assertCopilotGetModelsRefreshesExpiredTokenFirst() {
  const requests = [];

  const context = {
    console: { info() {}, error() {}, warn() {} },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        sync: {
          get(defaults, cb) {
            cb({
              ...defaults,
              apiKey: '',
              model: 'gpt-4o',
              authMethod: 'github-copilot',
              copilotGithubToken: 'gho_token',
              copilotAccessToken: 'expired_tok',
              copilotTokenExpiry: Date.now() - 1000
            });
          },
          set() { return Promise.resolve(); }
        }
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === 'https://api.github.com/copilot_internal/v2/token') {
        return {
          ok: true,
          json: async () => ({ token: 'fresh_copilot_tok', expires_at: Math.floor(Date.now() / 1000) + 3600 })
        };
      }
      return {
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-4o' }] })
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  const models = await context.handleGetModels();

  assert.deepStrictEqual(models, ['gpt-4o']);
  assert.strictEqual(requests[0].url, 'https://api.github.com/copilot_internal/v2/token');
  assert.strictEqual(requests[1].url, 'https://api.githubcopilot.com/models');
  assert.strictEqual(requests[1].options.headers.Authorization, 'Bearer fresh_copilot_tok');
}
```

Add these calls in `main()` after the existing Copilot access token exchange tests:

```js
  await assertCopilotGetModelsUsesDirectCopilotEndpoint();
  await assertCopilotGetModelsRefreshesExpiredTokenFirst();
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
node background.test.js
```

Expected: FAIL because `handleGetModels()` returns `[]` or fetches the configured endpoint instead of `https://api.githubcopilot.com/models`.

- [ ] **Step 3: Add Copilot API constants**

In `background.js`, replace the existing `COPILOT_CONFIG` object at `background.js:13-19` with:

```js
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
```

- [ ] **Step 4: Add Copilot headers helper**

After `createAuthHeaders()` in `background.js`, add:

```js
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
```

- [ ] **Step 5: Use constants in the token exchange headers**

In `startCopilotDeviceFlow()`, replace:

```js
'User-Agent': 'GitHubCopilotChat/0.26.7'
```

with:

```js
'User-Agent': COPILOT_CONFIG.USER_AGENT
```

In `pollCopilotToken()`, replace:

```js
'User-Agent': 'GitHubCopilotChat/0.26.7'
```

with:

```js
'User-Agent': COPILOT_CONFIG.USER_AGENT
```

In `getCopilotAccessToken()`, replace its fetch headers with:

```js
headers: {
  Accept: 'application/json',
  Authorization: `Bearer ${stored.copilotGithubToken}`,
  'User-Agent': COPILOT_CONFIG.USER_AGENT,
  'Editor-Version': COPILOT_CONFIG.EDITOR_VERSION,
  'Editor-Plugin-Version': COPILOT_CONFIG.EDITOR_PLUGIN_VERSION,
  'X-Github-Api-Version': COPILOT_CONFIG.API_VERSION
}
```

- [ ] **Step 6: Add direct Copilot model fetch helper**

Before `handleGetModels()` in `background.js`, add:

```js
async function fetchCopilotModels() {
  const token = await getCopilotAccessToken();
  const resp = await fetch(`${COPILOT_CONFIG.COPILOT_API_BASE_URL}/models`, {
    headers: createCopilotHeaders(token)
  });

  if (!resp.ok) return [];

  const data = await resp.json();
  return (data.data || data.models || [])
    .map(m => m.id || m.name)
    .filter(Boolean)
    .sort();
}
```

- [ ] **Step 7: Route `handleGetModels()` through Copilot helper**

Replace `handleGetModels()` in `background.js:337-350` with:

```js
async function handleGetModels() {
  const config = await loadConfig();

  if (config.authMethod === AUTH_METHODS.GITHUB_COPILOT) {
    return fetchCopilotModels();
  }

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
```

- [ ] **Step 8: Run tests for Task 1**

Run:

```powershell
node background.test.js
```

Expected: PASS for the new model-listing tests. Existing tests may fail only where they still expect the old Copilot routing; those are updated in Task 3.

- [ ] **Step 9: Commit Task 1**

```powershell
git add background.js background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "feat: fetch GitHub Copilot models directly"
```

---

### Task 2: Keep Model Selector Visible and Fetch Models Through Background in Copilot Mode

**Files:**
- Modify: `options.js:44-107`
- Modify: `options.js:123-140`
- Modify: `options.js:109-117`
- Modify: `options.js:278-313`
- Test: `options.test.js`

- [ ] **Step 1: Write failing options-page test**

Append this test helper before `main()` in `options.test.js`:

```js
async function assertCopilotModeShowsModelCardAndUsesBackgroundModels() {
  const elements = {
    modelSelect: createElement(),
    model: createElement('gpt-4o'),
    modelStatus: createElement(),
    refreshBtn: createElement(),
    apiShape: createElement('openai-compatible'),
    endpoint: createElement('http://localhost:5000'),
    apiKey: createElement(''),
    saveBtn: createElement(),
    status: createElement(),
    languageSelect: createElement('en'),
    apiKeyField: createElement(),
    copilotSection: createElement(),
    endpointField: createElement(),
    modelCard: createElement()
  };

  const appendedOptions = [];
  elements.modelSelect.appendChild = option => appendedOptions.push(option.value);
  elements.modelSelect.insertBefore = option => appendedOptions.unshift(option.value);

  const context = {
    console,
    setTimeout,
    clearTimeout,
    document: {
      documentElement: { lang: '', setAttribute() {} },
      createElement: () => createElement(),
      getElementById: id => elements[id],
      querySelectorAll: () => [],
      addEventListener() {}
    },
    globalThis: {},
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, cb) {
          assert.deepStrictEqual(message, { type: 'GET_MODELS' });
          cb({ models: ['claude-sonnet-4.5', 'gpt-4o'] });
        }
      },
      storage: { sync: { get() {}, set() {} } },
      tabs: { create() {} }
    },
    fetch: async () => { throw new Error('options page should not fetch Copilot models directly'); }
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(i18nSource, context);
  vm.runInContext(source, context);

  context.updateAuthMethodUI('github-copilot');
  await context.fetchModels('http://localhost:5000', '', 'openai-compatible', 'github-copilot');

  assert.strictEqual(elements.modelCard.style.display, '');
  assert.deepStrictEqual(appendedOptions, ['claude-sonnet-4.5', 'gpt-4o']);
  assert.strictEqual(elements.modelInput?.style?.display, undefined);
  assert.strictEqual(elements.model.value, 'gpt-4o');
  assert.ok(elements.modelStatus.innerHTML.includes('2 models'));
}
```

Update `main()` to call it after the existing test:

```js
  await assertCopilotModeShowsModelCardAndUsesBackgroundModels();
```

If `elements.modelInput` does not exist in this test harness, remove that single assertion; keep `elements.model.style.display` assertions in the next implementation task.

- [ ] **Step 2: Run the failing options test**

Run:

```powershell
node options.test.js
```

Expected: FAIL because `updateAuthMethodUI('github-copilot')` currently hides `modelCard`, and `fetchModels()` currently uses page `fetch()` instead of background messaging.

- [ ] **Step 3: Add background model fetch helper in `options.js`**

After `normalizeEndpoint()` in `options.js`, add:

```js
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
```

- [ ] **Step 4: Update `fetchModels()` signature and Copilot branch**

Change the function declaration in `options.js:44` from:

```js
async function fetchModels(endpoint, apiKey, apiShape) {
```

to:

```js
async function fetchModels(endpoint, apiKey, apiShape, authMethod = 'api-key') {
```

Inside the `try` block, replace the direct fetch/model parsing block:

```js
const url = normalizeEndpoint(endpoint) + '/models';
const headers = { 'Content-Type': 'application/json' };
if (apiKey) {
  if (apiShape === 'anthropic-messages') headers['x-api-key'] = apiKey;
  else headers['Authorization'] = `Bearer ${apiKey}`;
}

const resp = await fetch(url, { headers });
if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

const data = await resp.json();
const models = (data.data || data.models || [])
  .map(m => m.id || m.name)
  .filter(Boolean)
  .sort();
```

with:

```js
let models;
if (authMethod === 'github-copilot') {
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
```

- [ ] **Step 5: Keep the model card visible in Copilot mode**

In `updateAuthMethodUI()` in `options.js`, replace:

```js
if (modelCard) modelCard.style.display = 'none';
```

with:

```js
if (modelCard) modelCard.style.display = '';
```

Keep the API key and endpoint fields hidden for Copilot mode.

- [ ] **Step 6: Update scheduled/manual model fetch call sites**

In `scheduleFetch()`, replace:

```js
const apiShape = getSelectedApiShape(endpoint);
if (endpoint) fetchModels(endpoint, apiKey, apiShape);
```

with:

```js
const apiShape = getSelectedApiShape(endpoint);
const authMethod = document.getElementById('authMethod').value || DEFAULT_CONFIG.authMethod;
if (endpoint || authMethod === 'github-copilot') fetchModels(endpoint, apiKey, apiShape, authMethod);
```

In the `DOMContentLoaded` initialization, replace:

```js
if (config.endpoint && config.authMethod !== 'github-copilot') fetchModels(config.endpoint, config.apiKey, apiShape);
```

with:

```js
if (config.endpoint || config.authMethod === 'github-copilot') fetchModels(config.endpoint, config.apiKey, apiShape, config.authMethod);
```

In the manual refresh handler, replace:

```js
const apiShape = getSelectedApiShape(endpoint);
if (endpoint) fetchModels(endpoint, apiKey, apiShape);
```

with:

```js
const apiShape = getSelectedApiShape(endpoint);
const authMethod = document.getElementById('authMethod').value || DEFAULT_CONFIG.authMethod;
if (endpoint || authMethod === 'github-copilot') fetchModels(endpoint, apiKey, apiShape, authMethod);
```

In the `authMethod` change listener, replace:

```js
updateAuthMethodUI(e.target.value);
```

with:

```js
updateAuthMethodUI(e.target.value);
scheduleFetch();
```

- [ ] **Step 7: Run options tests**

Run:

```powershell
node options.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```powershell
git add options.js options.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "fix: show Copilot models in settings"
```

---

### Task 3: Route Copilot AI Requests Directly to GitHub Copilot

**Files:**
- Modify: `background.js:253-298`
- Modify: `background.js:369-391`
- Test: `background.test.js`

- [ ] **Step 1: Write failing tests for direct Copilot chat requests**

Add this test helper before `main()` in `background.test.js`:

```js
async function assertCopilotAuthUsesDirectCopilotChatCompletions() {
  const requests = [];

  const context = {
    console: { info() {}, error() {}, warn() {} },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        sync: {
          get(defaults, cb) {
            cb({
              ...defaults,
              endpoint: 'http://localhost:5000/v1',
              apiKey: '',
              model: 'gpt-4o',
              apiShape: 'anthropic-messages',
              authMethod: 'github-copilot',
              copilotGithubToken: 'gho_github_token',
              copilotAccessToken: 'copilot_api_token_123',
              copilotTokenExpiry: Date.now() + 60000
            });
          },
          set() { return Promise.resolve(); }
        }
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] })
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  const result = await context.handleAIAction('summarize', 'hello');

  assert.strictEqual(result, 'ok');
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/chat/completions');
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer copilot_api_token_123');
  assert.strictEqual(requests[0].options.headers['copilot-integration-id'], 'vscode-chat');

  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.model, 'gpt-4o');
  assert.strictEqual(body.max_tokens, 1024);
  assert.deepStrictEqual(body.messages.map(message => message.role), ['system', 'user']);
}
```

Add this call in `main()` after `assertCopilotAuthUsesTokenForApiRequest()`:

```js
  await assertCopilotAuthUsesDirectCopilotChatCompletions();
```

- [ ] **Step 2: Run failing background test**

Run:

```powershell
node background.test.js
```

Expected: FAIL because Copilot mode still sends chat requests to `http://localhost:5000/v1/...`.

- [ ] **Step 3: Add Copilot branch to API request builder**

Change `buildApiRequest()` signature from:

```js
function buildApiRequest({ config, messages, systemPrompt }) {
```

to:

```js
function buildApiRequest({ config, messages, systemPrompt, copilotToken }) {
```

At the start of `buildApiRequest()`, before the existing endpoint/apiShape logic, add:

```js
if (config.authMethod === AUTH_METHODS.GITHUB_COPILOT) {
  return {
    apiShape: API_SHAPES.OPENAI_COMPATIBLE,
    requestUrl: `${COPILOT_CONFIG.COPILOT_API_BASE_URL}/chat/completions`,
    requestHeaders: createCopilotHeaders(copilotToken),
    requestBody: {
      model: config.model,
      max_tokens: 1024,
      messages: [{ role: 'system', content: systemPrompt }, ...messages]
    },
    parseContent: parseOpenAIChatText
  };
}
```

- [ ] **Step 4: Pass Copilot token into request builder**

In `executeApiRequest()`, change:

```js
if (isCopilotAuth) {
  try {
    const copilotToken = await getCopilotAccessToken();
    config.apiKey = copilotToken;
  } catch (e) {
    throw new Error('GitHub Copilot authentication failed. Please re-authenticate in Settings.');
  }
} else if (!config.apiKey) {
```

to:

```js
let copilotToken = '';
if (isCopilotAuth) {
  try {
    copilotToken = await getCopilotAccessToken();
    config.apiKey = copilotToken;
  } catch (e) {
    throw new Error('GitHub Copilot authentication failed. Please re-authenticate in Settings.');
  }
} else if (!config.apiKey) {
```

Then change the builder call from:

```js
} = buildApiRequest({ config, messages, systemPrompt });
```

to:

```js
} = buildApiRequest({ config, messages, systemPrompt, copilotToken });
```

- [ ] **Step 5: Update obsolete test expectations**

In `background.test.js`, update these existing tests because direct Copilot mode no longer uses user-configured endpoint/API shape:

1. In `assertCopilotAuthUsesTokenForApiRequest()`, replace expected URL:

```js
assert.strictEqual(requests[0].url, 'http://localhost:5000/v1/chat/completions');
```

with:

```js
assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/chat/completions');
```

2. In `assertCopilotAuthCachesAndReusesToken()`, keep the token assertion but expect the same direct URL:

```js
assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/chat/completions');
```

3. Replace `assertCopilotAuthUsesAnthropicFormat()` and `assertCopilotAuthUsesResponsesFormat()` bodies with assertions that Copilot ignores `apiShape` and uses direct OpenAI-compatible request shape:

```js
async function assertCopilotAuthUsesAnthropicFormat() {
  const requests = [];

  const context = {
    console: { info() {}, error() {} },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        sync: {
          get(defaults, cb) {
            cb({
              ...defaults,
              endpoint: 'http://localhost:5000/v1',
              apiKey: '',
              model: 'claude-3',
              apiShape: 'anthropic-messages',
              authMethod: 'github-copilot',
              copilotGithubToken: 'gho_token',
              copilotAccessToken: 'copilot_tok',
              copilotTokenExpiry: Date.now() + 60000
            });
          },
          set() { return Promise.resolve(); }
        }
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] })
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  const result = await context.handleAIAction('summarize', 'hello');
  assert.strictEqual(result, 'ok');
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/chat/completions');
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer copilot_tok');
}

async function assertCopilotAuthUsesResponsesFormat() {
  const requests = [];

  const context = {
    console: { info() {}, error() {} },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        sync: {
          get(defaults, cb) {
            cb({
              ...defaults,
              endpoint: 'http://localhost:5000/v1',
              apiKey: '',
              model: 'gpt-4o',
              apiShape: 'openai-responses',
              authMethod: 'github-copilot',
              copilotGithubToken: 'gho_token',
              copilotAccessToken: 'copilot_tok',
              copilotTokenExpiry: Date.now() + 60000
            });
          },
          set() { return Promise.resolve(); }
        }
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] })
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  const result = await context.handleAIAction('summarize', 'hello');
  assert.strictEqual(result, 'ok');
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/chat/completions');
}
```

4. In `assertCopilotAuthEndpointOverride()`, replace its final assertion with:

```js
assert.strictEqual(capturedUrl, 'https://api.githubcopilot.com/chat/completions');
```

5. In `assertCopilotFullFlowInitiateToApiRequest()`, replace the final endpoint assertion:

```js
assert.ok(fetchUrls[3].includes('chat/completions'));
```

with:

```js
assert.strictEqual(fetchUrls[3], 'https://api.githubcopilot.com/chat/completions');
```

- [ ] **Step 6: Run background tests**

Run:

```powershell
node background.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add background.js background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "fix: route Copilot requests directly"
```

---

### Task 4: Update Documentation and Final Verification

**Files:**
- Modify: `README.md:32-38`
- Verify: all `*.test.js`

- [ ] **Step 1: Update README configuration table**

In `README.md`, replace lines `32-38`:

```md
| Field | Default | Description |
|-------|---------|-------------|
| API Endpoint | `https://api.omnillm.com/v1` | OmniLLM/Anthropic-compatible API endpoint |
| API Key | — | Your API key |
| Model | `claude-sonnet-4-5` | Any model available to your API key |

OmniPilot works with [OmniLLM](https://github.com/OmniLLM) by default. It also supports OpenAI-compatible providers when configured with an OpenAI-style endpoint.
```

with:

```md
| Field | Default | Description |
|-------|---------|-------------|
| Authentication | `API Key` | Choose API key auth or GitHub Copilot device-code sign-in |
| API Endpoint | `https://api.omnillm.com/v1` | OmniLLM/Anthropic-compatible API endpoint for API key mode |
| API Key | — | Your API key for API key mode |
| API Format | `OpenAI-compatible` | Request shape for API key mode: OpenAI chat completions, Anthropic Messages, or OpenAI Responses |
| Model | `claude-sonnet-4-5` | Any model available to your selected provider |

OmniPilot works with [OmniLLM](https://github.com/OmniLLM) by default. It also supports OpenAI-compatible providers when configured with an OpenAI-style endpoint. In GitHub Copilot mode, OmniPilot signs in through GitHub's device-code flow, exchanges the GitHub OAuth token for a Copilot API token, lists models from `https://api.githubcopilot.com/models`, and sends requests directly to GitHub Copilot.
```

- [ ] **Step 2: Run all tests**

Run each test file:

```powershell
node background.test.js
node options.test.js
node options-language.test.js
node i18n.test.js
node popup.test.js
node content-language.test.js
node options.test.js
```

Expected: every command exits with code 0. If a test fails, read the assertion message and update only the code or expectation directly related to direct Copilot model listing/routing.

- [ ] **Step 3: Optional manual extension smoke test**

Manual steps:

1. Open `chrome://extensions/`.
2. Reload OmniPilot unpacked extension.
3. Open extension options.
4. Choose `GitHub Copilot` under Authentication.
5. Complete sign-in.
6. Confirm the Model card remains visible.
7. Click refresh.
8. Confirm the model dropdown shows models from Copilot.
9. Save a model.
10. Select text on a page and run Summarize.
11. Confirm the request succeeds.

Expected: no manual model entry is required after Copilot OAuth.

- [ ] **Step 4: Commit Task 4**

```powershell
git add README.md
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "docs: document GitHub Copilot model selection"
```

---

## Self-Review

**Spec coverage:**
- Direct Copilot model listing is covered by Task 1.
- Options UI model selector visibility is covered by Task 2.
- Direct Copilot chat/action routing is covered by Task 3.
- Documentation and full verification are covered by Task 4.

**Placeholder scan:** No `TBD`, `TODO`, `implement later`, or unspecified edge-case placeholders remain.

**Type/name consistency:** Function names are consistent across tasks: `createCopilotHeaders()`, `fetchCopilotModels()`, `getModelsFromBackground()`, `handleGetModels()`, `buildApiRequest()`. Storage keys remain unchanged from the existing implementation.
