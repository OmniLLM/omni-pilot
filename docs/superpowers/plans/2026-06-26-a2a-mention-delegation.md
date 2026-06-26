# A2A Mention Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make A2A an explicit mention-triggered delegation target instead of a normal provider/model mode.

**Architecture:** `content.js` decides whether a panel follow-up is normal chat or A2A delegation by parsing a leading mention tag. `background.js` stops treating A2A provider IDs as active providers, while keeping the existing `A2A_DELEGATE_TASK` transport helpers. Settings still manages A2A servers separately.

**Tech Stack:** Vanilla JavaScript Chrome extension, Node `vm` tests, Playwright settings tests, `npm test`.

---

## File Structure

- Modify `content.js`
  - Remove A2A servers from normal provider entries.
  - Normalize legacy A2A provider selection to `custom-provider` for panel display.
  - Add A2A mention parsing helpers.
  - Route tagged follow-ups through `A2A_DELEGATE_TASK`.
- Modify `content-language.test.js`
  - Update provider-entry expectations.
  - Add follow-up tag routing tests.
- Modify `background.js`
  - Treat `a2a:<id>` provider types as legacy invalid provider values.
  - Remove automatic configured-A2A routing from ordinary `AI_CHAT`.
- Modify `background.test.js`
  - Replace old A2A provider-mode tests with legacy fallback / normal chat behavior.

## Task 1: Content provider list excludes A2A

**Files:**
- Modify: `content-language.test.js`
- Modify: `content.js`

- [ ] **Step 1: Write failing test**

Change `testA2aProviderLabelUsesConfiguredServerName()` in `content-language.test.js` to assert A2A servers are not provider entries:

```js
async function testA2aServersDoNotAppearAsProviderEntries() {
  const { context } = await createContentContext({
    providerType: 'a2a:a2a-1',
    a2aServers: [
      { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
    ]
  });

  assert.strictEqual(context.getProviderLabel('a2a:a2a-1', ''), 'Custom');
  assert.ok(!context.getProviderEntries().some(entry => entry.providerType === 'a2a:a2a-1'));
  assert.ok(!context.getProviderEntries().some(entry => entry.label === 'Planner'));
}
```

Update `main()` to call `testA2aServersDoNotAppearAsProviderEntries()`.

- [ ] **Step 2: Run failing test**

Run: `node content-language.test.js`

Expected: FAIL because `getProviderLabel('a2a:a2a-1')` still returns `Planner` and provider entries still include A2A.

- [ ] **Step 3: Implement minimal content provider change**

In `content.js`, make provider entries built-in only:

```js
function getProviderEntries() {
  return Object.entries(PROVIDER_LABELS)
    .map(([providerType, label]) => ({ providerType, label }));
}
```

Add provider normalization:

```js
function normalizeProviderType(providerType) {
  return PROVIDER_LABELS[providerType] ? providerType : 'custom-provider';
}
```

Use it when loading and changing `providerType`:

```js
currentProviderType = normalizeProviderType(cfg.providerType || 'custom-provider');
```

```js
if (changes.providerType) currentProviderType = normalizeProviderType(changes.providerType.newValue || 'custom-provider');
```

Update `getProviderLabel()`:

```js
function getProviderLabel(providerType, endpoint) {
  return PROVIDER_LABELS[normalizeProviderType(providerType)] || detectProvider(endpoint || '');
}
```

- [ ] **Step 4: Verify content test passes**

Run: `node content-language.test.js`

Expected: PASS.

## Task 2: Mention tags delegate to A2A from follow-up input

**Files:**
- Modify: `content-language.test.js`
- Modify: `content.js`

- [ ] **Step 1: Add failing tests**

Add tests in `content-language.test.js`:

```js
async function testA2aMentionFollowUpDelegatesInsteadOfChat() {
  const { documentRef, sendMessageCalls, setSelectionText } = await createContentContext({
    apiKey: 'test-key',
    languagePreference: 'en',
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  await selectText(documentRef, setSelectionText, 'selected context for A2A');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const input = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-input');
  input.value = '@A2Alocalhost hihihi';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  const delegateMessage = sendMessageCalls.findLast(message => message.type === 'A2A_DELEGATE_TASK');
  assert.ok(delegateMessage, 'A2A mention should send A2A_DELEGATE_TASK');
  assert.strictEqual(delegateMessage.serverId, 'server-1');
  assert.strictEqual(delegateMessage.task, 'hihihi');
  assert.ok(delegateMessage.contextText.includes('selected context for A2A'));
  assert.ok(!sendMessageCalls.some(message => message.type === 'AI_CHAT' && message.messages?.some(item => item.content === '@A2Alocalhost hihihi')));
}

async function testA2aMentionMatchingIgnoresCaseSpacesAndPunctuation() {
  const { context } = await createContentContext({
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  assert.strictEqual(context.globalThis.__omnipilotTestApi.parseA2aMentionTask('@a2a-localhost run').server.id, 'server-1');
  assert.strictEqual(context.globalThis.__omnipilotTestApi.parseA2aMentionTask('@A2Alocalhost run').server.id, 'server-1');
}

async function testUnknownA2aMentionShowsErrorWithoutChat() {
  const { documentRef, sendMessageCalls, setSelectionText } = await createContentContext({
    apiKey: 'test-key',
    languagePreference: 'en',
    a2aServers: [{ id: 'server-1', name: 'A2A localhost', endpoint: 'http://127.0.0.1:1423', enabled: true }]
  });

  await selectText(documentRef, setSelectionText, 'selected context');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const input = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-input');
  input.value = '@A2Aunknown hi';
  input.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} });

  const body = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-body');
  assert.ok(body.textContent.includes('A2A server not found: @A2Aunknown'));
  assert.ok(!sendMessageCalls.some(message => message.type === 'AI_CHAT'));
  assert.ok(!sendMessageCalls.some(message => message.type === 'A2A_DELEGATE_TASK'));
}
```

Call these tests from `main()`.

- [ ] **Step 2: Run failing test**

Run: `node content-language.test.js`

Expected: FAIL because `parseA2aMentionTask` is not exposed and follow-ups always send `AI_CHAT`.

- [ ] **Step 3: Implement mention parsing helpers**

Add to `content.js` near A2A helpers:

```js
function normalizeA2aTag(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findA2aServerByMention(tag) {
  const normalizedTag = normalizeA2aTag(tag);
  return a2aServers
    .filter(server => server && server.enabled !== false)
    .find(server => normalizeA2aTag(server.name || server.id || '') === normalizedTag) || null;
}

function parseA2aMentionTask(text) {
  const match = String(text || '').trim().match(/^@(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  const rawTag = match[1];
  const normalizedTag = normalizeA2aTag(rawTag);
  if (!normalizedTag.startsWith('a2a')) return null;

  const server = findA2aServerByMention(rawTag);
  if (!server) return { error: `A2A server not found: @${rawTag}` };

  const task = String(match[2] || '').trim();
  if (!task) return { error: 'A2A task is required.' };

  return { server, task };
}

function getA2aDelegationContext() {
  return conversationHistory
    .filter(message => message?.role === 'user' && message.kind === 'selection-context' && typeof message.content === 'string')
    .map(message => message.content.trim())
    .filter(Boolean)
    .join('\n\n') || lastSelection || '';
}
```

- [ ] **Step 4: Route follow-ups by mention**

In `sendFollowUp(question)`, compute:

```js
const a2aMentionTask = parseA2aMentionTask(question);
```

Before `AI_CHAT`, if `a2aMentionTask?.error`, remove loading and append an error. If it has a server, send:

```js
{
  type: 'A2A_DELEGATE_TASK',
  serverId: a2aMentionTask.server.id,
  task: a2aMentionTask.task,
  contextText: getA2aDelegationContext()
}
```

On success, append assistant result and store conversation history with `{ kind: 'a2a-result' }`.

Expose parser for tests:

```js
globalThis.__omnipilotTestApi = {
  ...(globalThis.__omnipilotTestApi || {}),
  getDropdownActionIds,
  parseA2aMentionTask
};
```

- [ ] **Step 5: Verify content tests**

Run: `node content-language.test.js`

Expected: PASS.

## Task 3: Background no longer treats A2A as chat provider

**Files:**
- Modify: `background.test.js`
- Modify: `background.js`

- [ ] **Step 1: Replace failing background expectations**

In `background.test.js`, replace A2A provider-mode chat tests with:

```js
async function assertLegacyA2aProviderTypeFallsBackToCustomProvider() {
  const { context } = await createBackgroundContext({
    storage: {
      providerType: 'a2a:a2a-1',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [{ id: 'a2a-1', endpoint: 'https://planner.example/a2a', enabled: true }]
    }
  });

  const config = await context.loadConfig();

  assert.strictEqual(config.providerType, 'custom-provider');
  assert.strictEqual(config.model, 'custom-model');
}

async function assertConfiguredA2aServerDoesNotAutomaticallyHandleChat() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [{ id: 'planner', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }]
    },
    fetchImpl: async (url) => {
      assert.strictEqual(url, 'https://custom.example/v1/chat/completions');
      return { ok: true, json: async () => RESPONSE_BY_SHAPE['openai-compatible'] };
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'Plan my day' }]);

  assert.strictEqual(result, 'ok');
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://custom.example/v1/chat/completions');
}
```

Update `main()` to call the new tests and remove calls to old provider-mode tests.

- [ ] **Step 2: Run failing background tests**

Run: `node background.test.js`

Expected: FAIL because `normalizeProviderType` still accepts A2A and `handleAIChat` still auto-routes configured A2A.

- [ ] **Step 3: Implement background fallback**

In `background.js`:

```js
function normalizeProviderType(value, legacyAuthMethod) {
  if (PROVIDERS[value]) return value;
  if (legacyAuthMethod === AUTH_METHODS.GITHUB_COPILOT) return PROVIDER_TYPES.GITHUB_COPILOT;
  return PROVIDER_TYPES.CUSTOM;
}
```

Remove the A2A branch from `getProvider(config)`.

Remove A2A provider and auto-configured A2A routing from `handleAIChat()`, leaving only normal API request handling.

- [ ] **Step 4: Verify background tests**

Run: `node background.test.js`

Expected: PASS.

## Task 4: Full verification and review

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run full verification**

Run: `git diff --check && npm test`

Expected: PASS, including Playwright settings tests.

- [ ] **Step 2: Run focused code review**

Use a review agent to inspect changed files for correctness/security regressions around A2A mention routing and provider fallback.

Expected: no high-confidence issues.

- [ ] **Step 3: Report final status**

Summarize changed files, behavior, and verification results. Do not claim completion unless `git diff --check && npm test` passed in the current turn.
