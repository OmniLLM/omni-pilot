# A2A Client Support Design

**Date:** 2026-06-25
**Status:** Approved for implementation

## Goal

Add A2A client support to OmniPilot so users can configure multiple remote A2A servers and delegate tasks to them. OmniPilot will not expose itself as an A2A server; it will only act as a browser-extension client.

## Scope

The feature covers two user flows:

1. **A2A as provider:** Configured A2A servers can appear in OmniPilot's provider selector and handle panel chat as the active provider.
2. **Explicit A2A delegation:** Users can choose **Delegate to A2A…** for tasks that are not covered by OmniPilot's built-in Translate, Summarize, Explain, and Improve actions.

The feature does not add a public agent-card endpoint, inbound task handling, or a browser-hosted A2A server.

## Architecture

Add a dedicated A2A client layer beside the current LLM provider layer:

- `options.html` / `options.js` gain an A2A server management section.
- `background.js` owns A2A network calls, discovery, auth headers, result normalization, and async task polling.
- `content.js` exposes A2A servers in the provider selector and adds an explicit delegation composer.
- Existing LLM provider logic remains in place. A2A-specific protocol details stay behind adapter helpers in `background.js`.

This keeps the implementation provider-neutral and avoids Claude/Anthropic-specific assumptions.

## Storage model

Use hybrid storage:

- `chrome.storage.sync.a2aServers` stores non-secret metadata:
  - `id`
  - `name`
  - `endpoint`
  - `enabled`
  - optional `agentCard`
  - optional `lastDiscoveredAt`
- `chrome.storage.local.a2aServerTokens` stores tokens by server `id`.

A2A server provider selection is represented by an active provider type that can identify either a built-in provider or an A2A server. The design should preserve backward compatibility with the existing `providerType`, `authMethod`, and `providerConfigs` storage.

## Settings page behavior

The Settings page adds an **A2A Servers** card below the existing provider/model settings. It supports:

- Add server
- Edit server name, endpoint, token, and enabled state
- Remove server
- Discover/Test server
- Display last discovery status and basic metadata when available

Manual name/endpoint/token entry is the source of truth. Discovery enriches the server with agent-card/capability metadata but must not be required for saving the server.

Tokens must never be written to `chrome.storage.sync`.

## Runtime behavior

### Provider-mode A2A chat

When the active provider is an A2A server:

1. `content.js` sends the existing `AI_CHAT` request to `background.js`.
2. `background.js` detects the active A2A provider.
3. It converts the conversation into an A2A task/message request.
4. It sends the request to the configured server with the local token when present.
5. It returns normalized text to `content.js`.

Built-in actions may also route through A2A when an A2A server is the active provider, but the explicit delegation flow is the primary path for non-built-in tasks.

### Explicit delegation

When the user selects text and chooses **Delegate to A2A…**:

1. OmniPilot opens the panel with a delegation composer.
2. The user chooses an enabled A2A server.
3. The user writes a free-form task prompt.
4. Selected webpage text is attached as context.
5. `content.js` sends `A2A_DELEGATE_TASK` to `background.js`.
6. `background.js` sends the A2A request and returns a normalized result.

The default prompt should be empty or lightly seeded. The flow is meant for tasks not already supported by OmniPilot's built-in actions.

## A2A protocol handling

Implement A2A protocol details in small helpers so request/response shape changes are isolated. The adapter should support:

- Agent-card discovery from a likely well-known path and/or the configured endpoint.
- JSON request dispatch with bearer-token authorization when a token exists.
- Immediate response extraction.
- Async task ID extraction.
- Polling for async task completion until success, failure, cancellation, or timeout.

Because A2A implementations may vary, parsing should be tolerant but explicit. If the response cannot be normalized, show a clear error rather than silently falling back.

## Error handling

User-visible errors should distinguish:

- Missing or disabled A2A server
- Missing endpoint
- Auth failure (`401`/`403`)
- Server/network failure
- Invalid A2A response
- Async task timeout
- Async task failed/cancelled

Sensitive headers and tokens must be redacted from logs. A2A errors must not mutate existing LLM provider configuration.

## Testing plan

Add or update tests for:

- Settings page rendering and persistence of multiple A2A servers
- Token storage in `chrome.storage.local`, not sync
- Discovery success and failure
- Removing a server also removes its local token
- A2A server appearing in provider selector
- `AI_CHAT` routing through A2A when active provider is an A2A server
- Explicit `A2A_DELEGATE_TASK` request flow
- Immediate A2A result normalization
- Async task polling success, failure, and timeout
- Regression coverage for existing Custom Provider, GitHub Copilot, and Azure Foundry flows

Run at least:

- `npm test`

## Implementation notes

Prefer focused helpers over expanding large functions inline. The existing codebase is vanilla JavaScript with no build step, so the implementation should remain dependency-free.

Recommended new helper boundaries inside existing files:

- A2A storage helpers
- A2A provider ID helpers
- A2A discovery helpers
- A2A request/polling helpers
- A2A UI row rendering helpers

If files become too large during implementation, extract only when useful and only if compatible with MV3 no-build loading.
