# A2A Auto-Routing Design

**Date:** 2026-06-26
**Status:** Approved for specification

## Goal

Let OmniPilot **automatically pick and call the right A2A agent** based on the user's prompt, using each agent's discovered capabilities. The user should not have to remember a `@mention` tag to delegate — typing a normal question is enough.

`@mention` delegation (from the prior spec) stays as an explicit manual override.

## Current Problem

A2A is already wired into OmniPilot as a client (multi-server settings, agent-card discovery, async polling) and as `@A2Aname task` delegation. That works, but it requires the user to:

1. Remember which agents exist.
2. Remember each agent's name well enough to type a matching tag.
3. Decide manually whether the agent is suitable for the current prompt.

This is a usability ceiling. Once users have more than 1–2 agents configured, the value of auto-discovery is undermined by the need to manually fan out by name.

## Desired Behavior

### Auto-routing from any normal prompt

When the user sends a follow-up message in the panel:

- If the message starts with `@A2A...`, behave exactly as in the mention spec (manual override).
- Otherwise, OmniPilot should:
  1. Build a tool definition for each **enabled** A2A server, using its discovered agent card to populate the tool description.
  2. Inject those tools into the outbound LLM request (the active LLM, not an A2A server).
  3. If the model picks a tool call, OmniPilot invokes `delegateA2aTask` for the matched server and returns the agent's result in the panel.
  4. If the model returns a normal text response, behave exactly as today — no A2A involved.

### Tool-call result handling

When the model picks an A2A tool:

- OmniPilot extracts the `task` string from the tool-call arguments.
- It calls `delegateA2aTask({ serverId, task, contextText })` using the same context rules as the mention flow (current selected text + prior selected context messages, no assistant responses).
- The returned A2A text is appended to the panel as an assistant message tagged `kind: 'a2a-result'` (so future routing turns don't include it as "selected context").

A second LLM round trip to summarize/wrap the A2A output is **out of scope** for v1. The A2A agent's reply is shown directly.

### Settings control

A new boolean setting `a2aAutoRoute` (default `true`):

- When `true` and at least one enabled A2A server exists with an agent card, OmniPilot injects the tools.
- When `false`, OmniPilot never auto-injects A2A tools. `@mention` still works.
- When `true` but **no** A2A server has a usable agent card, OmniPilot skips injection silently — the chat behaves like today.

The setting lives next to the existing A2A server card in the Settings page.

### Provider-format compatibility

The active LLM provider can be in any of three API shapes (`openai-compatible`, `anthropic-messages`, `openai-responses`). The router must:

- Inject tools in the correct shape for each format.
- Detect tool calls in the response of each format.
- Not break model fallback paths (Copilot `model_not_supported`).

If the active provider doesn't support tools (or returns a tool-related error), OmniPilot falls back to a plain chat request transparently and logs a warning. The user sees a normal text response.

### Mention override

When the prompt begins with `@A2A...`:

- OmniPilot uses the existing mention path. Tools are **not** injected. The model is bypassed.
- This guarantees that a user who knows exactly which agent they want never pays the tool-injection round-trip and isn't subject to model picks.

### Error behavior

- Tool-call extracted with unknown `serverId` → show `A2A server not found: <serverId>`.
- Tool-call with empty `task` argument → show `A2A task is required.`.
- A2A delegation network failure → same error surface as today's `A2A_DELEGATE_TASK`.
- LLM rejects tools (HTTP 400 with tool-related error) → retry the same request without tools, log a console warning, and continue.

## Architecture

### Where logic lives

The router is a thin layer **inside `background.js`** that wraps the existing `handleAIChat`/`executeApiRequest` path:

- `content.js` is **unchanged** for auto-routing — it still sends `AI_CHAT` with the message history. The mention path is untouched.
- All tool schema, injection, response parsing, and delegation dispatch happens server-worker-side. Keeping it in the background script means content scripts don't gain new responsibilities and the same routing is available to popup chat in the future.

### New helpers in `background.js`

- `loadEnabledA2aServersWithAgentCards()` — returns enabled servers that have an `agentCard` (discovered).
- `buildA2aToolName(serverId)` — deterministic tool-name from a server id. Must satisfy OpenAI tool-name regex `^[a-zA-Z0-9_-]{1,64}$`. Use a stable prefix like `a2a__<sanitized-id>`.
- `parseA2aToolName(name)` — inverse: extracts `serverId` from a tool name, or `null` if it isn't an A2A tool.
- `buildA2aToolDescription(server)` — builds the tool's `description` string from the agent card's `description`, `skills[]` (name + description, capped), and `name`. This is the text the model uses to decide whether to call the tool.
- `buildA2aToolSchemas(servers)` — returns `{ openai: [...], anthropic: [...], responses: [...] }`, each in the correct tool format for that API shape.
- `injectA2aToolsIntoRequest(requestBody, apiShape, toolSchemas)` — sets `tools`, `tool_choice: 'auto'` on the body for the active shape.
- `extractA2aToolCall(responseData, apiShape)` — returns `{ serverId, task, callId }` if the model picked an A2A tool, else `null`.
- `routeA2aChatIfTool(messages, response, apiShape, helpers)` — orchestrates the tool-call path.

### Modified entry points

- `handleAIChat(messages)` becomes:
  1. Load config + enabled-with-card A2A servers.
  2. If `a2aAutoRoute && servers.length > 0`, call `executeApiRequest` with tool schemas attached.
  3. After the response, if a tool call is present, invoke `delegateA2aTask`, then return its text.
  4. Otherwise return the plain content as today.

- `executeApiRequestWithConfig` gains an optional `tools` parameter passed through to `buildApiRequest`.

- `buildApiRequest` gains an optional `tools` and writes them into the request body per shape (openai: `tools` + `tool_choice`; anthropic: `tools`; responses: `tools`).

### Tool-name & schema conventions

- Tool name: `a2a__` + lowercase, alphanumerics-and-hyphens-only sanitization of the server id, truncated to 60 chars (leaves room for the prefix within OpenAI's 64-char limit).
- Each tool takes exactly one required parameter:

  ```json
  { "type": "object", "properties": { "task": { "type": "string", "description": "The task to delegate to this agent. Be specific and self-contained." } }, "required": ["task"] }
  ```

- Description shape: `"<agent.name> — <agent.description>. Skills: <skill1.name> (<skill1.description>); ...". Truncated to 1024 chars to stay within model limits across providers.`

### Auto-route gating

Auto-route triggers a tool-enabled LLM round trip **only when**:

- `a2aAutoRoute === true`
- The active provider is an LLM (not an A2A provider).
- At least one enabled A2A server has an `agentCard`.
- The latest user message does not begin with `@A2A...`.

Otherwise, the existing code path runs unchanged.

## Storage

- New key in `chrome.storage.sync`: `a2aAutoRoute` (boolean, default `true`). Added to `STORAGE_KEYS`.
- Migration: missing key reads as `true` to give existing users the new behavior by default.

## Testing plan

Add unit tests in `background.test.js`:

- `buildA2aToolName` / `parseA2aToolName` round-trip.
- `buildA2aToolDescription` truncation and structure.
- `buildA2aToolSchemas` produces three shape-correct outputs.
- `injectA2aToolsIntoRequest` for each shape.
- `extractA2aToolCall` for each shape (positive + negative).
- End-to-end: `handleAIChat` sends a request with tools when servers exist and routing is on; runs `delegateA2aTask` and returns its result when the response contains a tool call.
- End-to-end: `handleAIChat` sends **no** tools when `a2aAutoRoute=false`.
- End-to-end: `handleAIChat` sends **no** tools when no enabled server has an agent card.
- Regression: `handleAIChat` unchanged when message starts with `@mention` (mention path stays in `content.js`).
- Regression: model fallback for `model_not_supported` still works when tools are attached.
- LLM-rejects-tools fallback: when a 400 + tool error is returned, the request is retried without tools.

Settings test:

- `options.test.js` covers persistence of `a2aAutoRoute` toggle.

Playwright:

- Re-run the existing settings-page test to ensure no regressions.

## Non-goals (v1)

- A second LLM round trip to summarize A2A output.
- Parallel multi-agent fan-out from a single prompt.
- Streaming. `delegateA2aTask` already polls and returns a final string.
- Cost/latency display in the panel for tool calls.
- A separate model classifier hop (would add latency for marginal gain; tool-call routing through the user's chosen LLM is sufficient).

## Compatibility

- Storage shape backward-compatible: a brand-new `a2aAutoRoute` key with a default does not affect existing users.
- Tool injection is conditional and skipped when there are no agent cards, so users without A2A servers see zero change.
- `@mention` flow untouched.
- All three API shapes supported. Providers that don't implement tools should reject only when tools are present in the body; the auto-fallback path covers them.
