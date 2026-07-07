# GitHub Copilot Model Handling — Port from omnillm

**Date:** 2026-07-07
**Status:** Approved
**Author:** James Zhu

## Problem

`src/background/index.mjs` decides which GitHub Copilot endpoint to hit
(`/chat/completions` vs `/responses`) with a hardcoded regex:

```js
function isCopilotResponsesOnlyModel(model) {
  return /^mai-code-/i.test(String(model || ''));
}
```

Every other decision that depends on the model — `max_tokens` vs
`max_completion_tokens`, whether to send `temperature`/`top_p`,
whether to allow a function-name `tool_choice` — is either hardcoded to
a single model (`gpt-5.4`) or missing entirely. `fetchCopilotModels`
throws away the `supported_endpoints` and `capabilities` fields that
Copilot returns from `GET /models`.

The sibling project **omnillm** (`internal/providers/copilot/`) already
solves this. It builds a per-model shape cache from
`supported_endpoints`, falls back to a family heuristic on cache miss,
retries transparently when Copilot returns `unsupported_api_for_model`,
and applies per-model parameter quirks. We are porting that method to
omni-pilot.

## Goals

1. Decide `/chat/completions` vs `/responses` per model from Copilot's
   own `supported_endpoints` metadata, not a regex over model IDs.
2. Self-correct: when a chat-completions request returns
   `unsupported_api_for_model` (HTTP 400), transparently retry on
   `/responses` and update the cache.
3. Apply per-model parameter rules that match Copilot's expectations
   (`max_completion_tokens`, dropping `temperature`/`top_p` for
   reasoning models, string-only `tool_choice`).
4. Capture richer model metadata (context window, output tokens, vision,
   function-calling) from `GET /models` for future UI use.
5. Do all of this without regressing existing behavior for the `custom`
   or `azure-foundry` providers.

## Non-Goals

- Extending the shape routing to non-Copilot OpenAI-compatible
  providers (deliberately excluded to keep the blast radius small).
- Persisting the shape cache across service-worker restarts. In-memory
  only; warmed on first use.
- Changing the wire contract of `handleGetModels` back to the options
  page. It still returns a `string[]` of model IDs; the richer metadata
  is retained internally.

## Design Overview

Introduce a new module `src/background/providers/copilot.mjs` that owns
every Copilot-specific concern: HTTP headers, OAuth device flow, token
refresh, model discovery, shape cache, request builders, and the
runtime downgrade wrapper. `src/background/index.mjs` calls one entry
point (`runCopilotRequest`) plus a description helper (`describeCopilotRequest`)
for logging.

The build script `build.mjs` gains a `concatProviders()` function that
inlines every `.mjs` in `src/background/providers/` into the background
bundle, mirroring the existing `concatAgentPrimitives()` for
`src/background/agent/`.

## Module Boundary

### `src/background/providers/copilot.mjs` (new)

**Owns:**

- `COPILOT_CONFIG` constants (client ID, URLs, editor/plugin version,
  API version, user agent).
- OAuth device-code flow: `startCopilotDeviceFlow`,
  `pollCopilotAccessToken`, `clearCopilotAuth`, `getCopilotAccessToken`
  (with token refresh via `COPILOT_API_KEY_URL`).
- `createCopilotHeaders(token, { forVision } = {})`.
- `fetchCopilotModels()` — returns
  `{ models: [{id, name, maxTokens, outputTokens, capabilities}], shapeCache: Map }`
  and populates the module-scoped `copilotShapeCache`.
- Shape logic: `shapeFromEndpoints(endpoints)`,
  `selectCopilotShape(model, { forceChatCompletions })`.
- Reasoning-model detection: `isCopilotReasoningModel(model)`,
  `copilotModelUsesMaxCompletionTokens(model)`.
- Error detectors: `isUnsupportedChatCompletionsModel(status, body)`.
- Body builders: `buildCopilotChatBody`, `buildCopilotResponsesBody`.
- Public entry points:
  - `runCopilotRequest({ token, config, systemPrompt, messages, tools, stream, onChunk, onDone, onError, allowModelFallback, forceChatCompletions })`
    — executes a Copilot request end-to-end.
  - `describeCopilotRequest({ config, systemPrompt, messages, tools, stream })`
    — returns `{ apiShape, requestUrl, requestHeaders, requestBody }`
    without executing. Used by `agent.mjs` for logging.

**Reads (top-level bindings from index.mjs, available via bundle
concatenation):** `getCopilotStorageArea`, `storageGet`, `storageSet`,
`storageRemove`, `COPILOT_STORAGE_KEYS`.

### `src/background/index.mjs` (edits)

- `buildApiRequest` — Copilot branch collapses. When
  `getProvider(config).usesCopilotAuth`, this function returns `null`,
  signaling to callers to use `runCopilotRequest` instead.
- `executeApiRequestRaw` and `executeApiRequestStreaming` — early-out:
  if `getProvider(config).usesCopilotAuth`, delegate to
  `runCopilotRequest(...)` and return its result.
- `handleGetModels` — Copilot branch calls the new `fetchCopilotModels`
  and maps to `[id]` (same wire shape as today).
- Removed: `isCopilotResponsesOnlyModel`, `createCopilotHeaders`,
  `startCopilotDeviceFlow`, `pollCopilotAccessToken`,
  `getCopilotAccessToken`, `clearCopilotAuth`, `fetchCopilotModels`,
  `COPILOT_CONFIG`.
- `getOpenAIChatTokenLimitParams` — the Copilot branch (the `providerType === PROVIDER_TYPES.GITHUB_COPILOT` special case for `gpt-5.4`) is removed; the Azure Foundry branch is preserved unchanged. The Copilot equivalent now lives inside `buildCopilotChatBody` and covers the full `o1/o3/o4/gpt-5*` family, not just `gpt-5.4`.

### `build.mjs` (edits)

Add `concatProviders()` matching `concatAgentPrimitives()`, then
prepend the concatenated providers block to the background bundle
before `src/background/index.mjs`. Same `stripExports` treatment so
declarations land top-level.

## Shape Cache & Selection

### Data structure

```js
// module scope in copilot.mjs
let copilotShapeCache = null; // null = unwarmed; Map<string, 'chat'|'responses'> once populated
```

### Building from `GET /models`

```js
async function fetchCopilotModels() {
  const token = await getCopilotAccessToken();
  const res = await fetch(`${COPILOT_CONFIG.COPILOT_API_BASE_URL}/models`, {
    headers: createCopilotHeaders(token)
  });
  if (!res.ok) return { models: [], shapeCache: copilotShapeCache };

  const data = await res.json();
  const cache = new Map();
  const models = [];
  for (const m of data.data || []) {
    const id = m.id || m.name;
    if (!id) continue;
    cache.set(id.toLowerCase(), shapeFromEndpoints(m.supported_endpoints || []));
    models.push({
      id,
      name: m.name || id,
      maxTokens: m.capabilities?.limits?.max_context_window_tokens
              || m.capabilities?.limits?.max_output_tokens
              || 0,
      outputTokens: m.capabilities?.limits?.max_output_tokens || 0,
      capabilities: {
        tokenizer: m.capabilities?.tokenizer,
        functionCalling: !!m.capabilities?.supports?.tool_calls,
        parallelToolCalls: !!m.capabilities?.supports?.parallel_tool_calls,
        vision: !!m.capabilities?.supports?.vision
      }
    });
  }
  copilotShapeCache = cache;
  return { models, shapeCache: cache };
}

function shapeFromEndpoints(endpoints) {
  const hasResponses = endpoints.some(e => e.endsWith('/responses'));
  const hasChat = endpoints.some(e => e.endsWith('/chat/completions'));
  if (hasResponses && !hasChat) return 'responses';
  return 'chat';
}
```

### Selection

```js
function selectCopilotShape(model, { forceChatCompletions = false } = {}) {
  if (forceChatCompletions) return 'chat';
  const key = String(model || '').trim().toLowerCase();
  if (copilotShapeCache?.has(key)) return copilotShapeCache.get(key);
  // Hardcoded fallback for models Copilot may not yet describe in /models.
  if (/^mai-code-/i.test(key)) return 'responses';
  // Family heuristic — mirror omnillm's shared.IsGPT5Family.
  if (isGPT5Family(key) && !key.includes('-mini')) return 'responses';
  return 'chat';
}

function isGPT5Family(model) {
  return /^gpt-5(\.|$|-)/i.test(model);
}

function isCopilotReasoningModel(model) {
  const lower = String(model || '').toLowerCase();
  return /^o[134]/.test(lower) || isGPT5Family(lower);
}

function copilotModelUsesMaxCompletionTokens(model) {
  return isCopilotReasoningModel(model);
}
```

### Warming

`runCopilotRequest` calls `ensureShapeCache()` at the start of every
request. If `copilotShapeCache === null`, it kicks off
`fetchCopilotModels()` **without awaiting** so the current request
proceeds on the heuristic. Subsequent requests hit the cache. On
`clearCopilotAuth`, the cache is reset to `null`.

## Request Execution

### `runCopilotRequest`

```js
async function runCopilotRequest({
  token, config, systemPrompt, messages, tools,
  stream = false, onChunk, onDone, onError,
  allowModelFallback = true, forceChatCompletions = false
}) {
  ensureShapeCache(); // fire and forget
  const shape = selectCopilotShape(config.model, { forceChatCompletions });
  return executeCopilotRequest({
    shape, token, config, systemPrompt, messages, tools,
    stream, onChunk, onDone, onError,
    allowModelFallback, forceChatCompletions,
    // Prevents infinite recursion when the retry itself hits an error.
    allowShapeDowngrade: shape === 'chat' && !forceChatCompletions
  });
}
```

### Error ladder (initial-response 4xx only; mid-SSE errors never retry)

1. `sentTools && isToolsUnsupportedError(status, body)` — throw a tagged
   `Error` with `err.toolsUnsupported = true`. Existing behavior; the
   runner already reruns without tools.
2. `allowShapeDowngrade && isUnsupportedChatCompletionsModel(status, body)`
   — retry once on `/responses`, update
   `copilotShapeCache.set(model.toLowerCase(), 'responses')`, disable
   further shape downgrade on the retry.
3. `allowModelFallback && isModelNotSupportedError(status, body)` —
   existing fallback: `chooseCopilotFallbackModel(await fetchCopilotModels(), config.model)`
   → `replaceStoredModel(fallback)` → recurse with `allowModelFallback: false`.
4. Otherwise — build a diagnostic message (401/403/429 shaping
   preserved) and throw.

### `isUnsupportedChatCompletionsModel`

```js
function isUnsupportedChatCompletionsModel(status, errorText) {
  if (status !== 400) return false;
  try {
    const err = JSON.parse(errorText);
    if (err.error?.code === 'unsupported_api_for_model') return true;
    if (/\/chat\/completions/i.test(err.error?.message || '')) return true;
  } catch {}
  return /unsupported_api_for_model/i.test(errorText);
}
```

### Body builders

- **`buildCopilotChatBody(config, systemPrompt, messages, tools)`**
  - `messages: [{role:'system', content: systemPrompt}, ...messages]`.
  - `max_completion_tokens: 1024` if `copilotModelUsesMaxCompletionTokens(model)`, else `max_tokens: 1024`.
  - Skip `temperature` / `top_p` if `isCopilotReasoningModel(model)`.
  - If tools present: `tools`, `tool_choice: 'auto'`, `parallel_tool_calls: true`.
  - Filter `tool_choice` on reasoning models to string values only.

- **`buildCopilotResponsesBody(config, systemPrompt, messages, tools)`**
  - `instructions: systemPrompt`, `input: messages`.
  - `max_output_tokens: 1024` for non-reasoning, `max_completion_tokens: 1024` for reasoning.
  - Same tool rules as chat.

### Streaming

When `stream: true`, `runCopilotRequest` sets `stream: true` in the
body, opens a reader, delegates SSE parsing based on the chosen shape:
- `chat` → `parseStreamChunkOpenAIChat` (already in index.mjs).
- `responses` → `parseStreamChunkOpenAIResponses` (already in index.mjs).

Mid-stream errors invoke `onError` without retry.

## Backward Compatibility

- Storage key **values** unchanged (`copilotDeviceCode`, `copilotUserCode`, `copilotVerificationUri`, `copilotUserExpiry`, `copilotPollInterval`, `copilotGithubToken`, `copilotAccessToken`, `copilotTokenExpiry`); only the declaration file moves from `index.mjs` to `providers/copilot.mjs`. Data stored under those keys is fully compatible across upgrade.
- `agent/agent.mjs` and `agent/runner.mjs` continue to log
  `requestUrl` — they call `describeCopilotRequest` (Copilot) or
  `buildApiRequest` (non-Copilot).
- `chooseCopilotFallbackModel` → `replaceStoredModel` behavior
  preserved unchanged.
- `isToolsUnsupportedError` retry-without-tools contract preserved.
- `/^mai-code-/i` preserved as a hardcoded fallback in
  `selectCopilotShape` alongside the heuristic — zero-regression if
  Copilot's `/models` does not yet describe those endpoints.
- `handleGetModels` still returns `string[]` to the options page.

## Testing

### New unit tests (add to `tests/unit/background.test.js` or new `copilot.test.js`)

- `shapeFromEndpoints`: chat-only, responses-only, both, empty,
  unknown endpoint strings.
- `selectCopilotShape`:
  - cache hit chat, cache hit responses;
  - cache miss + `gpt-5-codex` → responses;
  - cache miss + `gpt-5-mini` → chat;
  - cache miss + `gpt-4o` → chat;
  - cache miss + `mai-code-anything` → responses;
  - `forceChatCompletions: true` overrides cache-set-responses.
- `isUnsupportedChatCompletionsModel`: 400 with `error.code`, 400 with
  message-only, 400 with raw text, non-400.
- `isCopilotReasoningModel` / `copilotModelUsesMaxCompletionTokens`:
  `o1`, `o3-mini`, `o4`, `gpt-5`, `gpt-5.4`, `gpt-4o` (no),
  `claude-*` (no).
- `runCopilotRequest` retry (fetch mock): 400
  `unsupported_api_for_model` on `/chat/completions`, then 200 on
  `/responses`. Assert exactly one retry, that
  `copilotShapeCache.get(model.toLowerCase()) === 'responses'` after,
  and that a subsequent request skips the wasted first attempt.

### Existing tests

Any test that referenced `isCopilotResponsesOnlyModel`,
`createCopilotHeaders`, or `getOpenAIChatTokenLimitParams` for Copilot
gets rewritten to exercise the new module. Non-Copilot tests are
unaffected.

## Open Questions

None at spec time. All decisions during brainstorming were made
explicitly.

## References

- omnillm copilot provider:
  `/c/Users/jzhu/repos/omnillm/internal/providers/copilot/`
  — see `models.go`, `shape.go`, `adapter.go`, `payload.go`.
- Current omni-pilot Copilot code in `src/background/index.mjs`:
  `isCopilotResponsesOnlyModel` (line ~1135), `buildApiRequest`
  (line ~1139), `createCopilotHeaders` (line ~1852),
  `fetchCopilotModels` (line ~1983), `executeApiRequestRaw`
  (line ~2167), `executeApiRequestStreaming` (line ~2286).
