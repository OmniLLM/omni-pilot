# A2A Auto-Routing Implementation Plan

**Date:** 2026-06-26
**Status:** Approved
**Spec:** `docs/superpowers/specs/2026-06-26-a2a-auto-routing-design.md`

## Scope

Build on top of the existing A2A client (mention delegation + discovery + polling). Add LLM tool-call based auto-routing so users get the right agent picked automatically from a normal prompt, while `@mention` remains as a manual override.

## Files touched

- `background.js` — new helpers + `handleAIChat` enhancements + `buildApiRequest` tools parameter.
- `background.test.js` — unit + integration coverage.
- `options.html`, `options.js`, `options.test.js` — new `a2aAutoRoute` toggle.
- `i18n.js` — labels for the toggle.
- `README.md` — short A2A auto-routing note.

`content.js` is **not** touched in this change. The mention override already lives there and the AI_CHAT contract is unchanged.

## Step-by-step

### 1. Background helpers (pure functions, easy to unit-test)

Add to `background.js`:

- `MAX_A2A_TOOL_DESCRIPTION_LEN = 1024`
- `A2A_TOOL_NAME_PREFIX = 'a2a__'`
- `sanitizeA2aToolNameSegment(serverId)` — lowercase, replace `[^a-z0-9_-]` with `_`, dedupe `_`, slice to 58 chars.
- `buildA2aToolName(serverId)` → `${prefix}${sanitized}`.
- `parseA2aToolName(toolName)` → server id string or `null`.
- `buildA2aToolDescription(server)` → from `agentCard.name`, `agentCard.description`, `agentCard.skills[]`. Capped.
- `buildA2aToolParameters()` → constant JSON schema with `{ task: string (required) }`.
- `loadEnabledA2aServersWithAgentCards()` → wraps `loadA2aServers()`, filters `enabled !== false && server.agentCard`.
- `buildA2aToolSchemas(servers)` → returns `{ openai, anthropic, responses }`.
- `extractA2aToolCallFromResponse(data, apiShape)` → returns `{ serverId, task, callId }` or `null`.

### 2. Storage / config

- Add `'a2aAutoRoute'` to `STORAGE_KEYS`.
- Add `a2aAutoRoute: true` to `DEFAULT_CONFIG`.
- No migration step needed; missing key reads as default.

### 3. `buildApiRequest` accepts `tools`

Extend signature: `buildApiRequest({ config, messages, systemPrompt, copilotToken, tools })`. When `tools && tools.length > 0`:

- `openai-compatible` + copilot path: set `requestBody.tools = tools` and `requestBody.tool_choice = 'auto'`.
- `anthropic-messages`: set `requestBody.tools = tools`. (Anthropic tool_choice default is `auto` already.)
- `openai-responses`: set `requestBody.tools = tools` and `requestBody.tool_choice = 'auto'`.

### 4. `executeApiRequestWithConfig` accepts `tools` and returns raw JSON when tools were sent

Change the contract so that when tools are present and the response includes a tool call, we **return the parsed response data**, not just text. Simplest: when `tools` is set, return `{ rawData, content }` instead of just the string. Internal call sites stay backward-compatible by passing no tools.

To minimize the blast radius, prefer a thin new function `executeApiRequestRaw(...)` that returns both, and keep `executeApiRequestWithConfig` calling it and discarding `rawData`.

### 5. `handleAIChat` orchestrates

```pseudo
async function handleAIChat(messages):
  config = await loadConfig()

  # Only auto-route in normal LLM mode
  if isA2aProviderType(config.providerType): existing handleA2aProviderChat path
  if not config.a2aAutoRoute: existing path
  servers = await loadEnabledA2aServersWithAgentCards()
  if servers.length == 0: existing path

  toolSchemas = buildA2aToolSchemas(servers)
  apiShape = effective shape from config/provider

  try:
    { rawData, content } = await executeApiRequestRaw({ config, messages, systemPrompt, tools: toolSchemas[shape] })
  except ToolsRejectedError:
    return executeApiRequest({ config, messages, systemPrompt })  # fallback without tools

  toolCall = extractA2aToolCallFromResponse(rawData, apiShape)
  if toolCall is None: return content  # plain text answer

  if not validServerId(toolCall.serverId): throw 'A2A server not found: <id>'
  if not toolCall.task: throw 'A2A task is required.'

  return delegateA2aTask({ serverId, task, contextText: getA2aConversationContext(messages) })
```

Reuse the existing `getA2aConversationContext(messages)` helper from the mention path.

### 6. Tools-rejected fallback detection

Wrap the 400 path in `executeApiRequestWithConfig` to detect tool-related errors:

- HTTP 400
- `error.code === 'tools_not_supported'` or error message includes `tools` and `not supported` / `unsupported`.

When matched and tools were attached, throw a sentinel `ToolsNotSupportedError`. The caller catches and retries without tools.

### 7. Settings UI

`options.html`:

- New row under the A2A servers card: `<label><input type="checkbox" id="a2aAutoRoute" checked> <span data-i18n="a2aAutoRouteLabel">…</span></label>` plus a small description.

`options.js`:

- Read `a2aAutoRoute` on load (default true).
- Persist on toggle change.

`i18n.js`:

- Add `a2aAutoRouteLabel` and `a2aAutoRouteDescription` strings (English baseline; existing i18n shape covers the rest).

### 8. Tests

`background.test.js` — add:

- `runAutoRouteTest({ servers, autoRoute, apiShape, mockToolCall })` helper.
- Tests:
  - injects OpenAI tools when servers + autoRoute
  - injects Anthropic tools when shape=anthropic-messages
  - injects Responses tools when shape=openai-responses
  - omits tools when `a2aAutoRoute=false`
  - omits tools when no agent cards
  - tool name round-trip
  - tool description truncation
  - extract tool call OpenAI shape
  - extract tool call Anthropic shape
  - extract tool call Responses shape
  - end-to-end: tool call → `delegateA2aTask` → result
  - end-to-end: no tool call → content returned as today
  - tools-rejected fallback: 400 with tool error → retried without tools
  - regression: copilot model fallback path still works

`options.test.js` — add:

- toggle renders, reads stored value, persists changes.

### 9. README

Append a short paragraph under "Configuration":

> When you configure A2A servers and Discover them, OmniPilot will automatically suggest the right agent for each prompt using its discovered capabilities. You can toggle this off in Settings, or override it manually with `@AgentName task`.

## Risks & mitigations

- **Risk:** Some providers/models reject `tools` even with `tool_choice: 'auto'`. *Mitigation:* tools-rejected fallback retries without tools.
- **Risk:** Tool description gets too long for some providers. *Mitigation:* 1024-char cap.
- **Risk:** Tool names contain invalid characters. *Mitigation:* sanitizer + strict regex test.
- **Risk:** Copilot's model fallback path becomes a no-op because the retry doesn't preserve tools. *Mitigation:* the retry already rebuilds the request via `executeApiRequestWithConfig`, so tools are re-injected naturally if we plumb the `tools` argument through. Add a test.
- **Risk:** A future ambient browser context (e.g. tab title, URL) might be appropriate to send to A2A but isn't in v1. *Out of scope — v1 reuses the same `getA2aConversationContext` as mentions.*

## Acceptance criteria

- All existing tests (`npm test:unit`) still pass.
- All new tests pass.
- Manually toggling A2A Auto-Route off in Settings stops tool injection (verified by inspecting console request logs).
- `@mention` continues to work and bypasses auto-routing.
- A normal prompt with an applicable agent triggers `A2A_DELEGATE_TASK` automatically.
- A normal prompt with no applicable agent returns the plain LLM answer.
