# A2A Mention-Triggered Delegation Design

**Date:** 2026-06-26
**Status:** Approved for specification

## Goal

Change A2A integration from provider-mode chat to explicit mention-triggered delegation.

A2A servers should not appear as normal LLM providers or share OmniPilot's selected model. When OmniPilot delegates to an A2A server, it sends only the task and context to that server; the backend A2A agent uses its own configured defaults, primarily its own model.

Example user input:

```text
@A2Alocalhost hihihi
```

This should delegate `hihihi` to the configured A2A server named `A2A localhost`.

## Current Problem

The current A2A provider-mode flow lets A2A servers appear in the panel provider selector. This makes the UI show combinations such as:

```text
Chat · A2A localhost · claude-sonnet-4-5
```

That is misleading because the model shown is OmniPilot's selected LLM model, not necessarily the backend A2A agent's model. Provider-mode chat also routes ordinary follow-up messages to A2A, which has caused `A2A request failed: 404` errors when the selected A2A server endpoint is not a direct JSON-RPC endpoint.

A2A should instead behave as an explicit delegation target.

## Desired Behavior

### Provider and model UI

The provider selector should list only normal LLM providers:

- Custom
- GitHub Copilot
- Azure Foundry

A2A servers should not appear in this provider selector.

The model selector should remain tied to the active LLM provider only. When a user delegates to A2A, OmniPilot should not display or send OmniPilot's selected model as if it controls the backend A2A agent.

If existing storage contains an old A2A provider selection such as `providerType: "a2a:<serverId>"`, OmniPilot should treat it as a legacy value and fall back to a normal provider, currently `custom-provider`.

### Mention syntax

A follow-up message beginning with an A2A mention tag triggers delegation:

```text
@A2Alocalhost hihihi
```

The tag matching should be forgiving:

- Case-insensitive
- Ignores spaces and punctuation in the typed tag and configured server name
- Supports examples such as:
  - `@A2Alocalhost hihihi`
  - `@a2alocalhost hihihi`
  - `@A2A-localhost hihihi`

For a configured server named `A2A localhost`, all of those tags should match.

The task sent to the A2A server is the remaining text after the tag. For example:

```text
@A2Alocalhost hihihi
```

sends:

```text
hihihi
```

### Context handling

When a tag-triggered delegation happens from the panel, OmniPilot should send the same relevant context it already uses for delegation:

- Current selected page text if available
- Prior selected context messages in the conversation when available

Assistant responses in the panel history should not be included as selected context.

### Backend A2A model/config

The A2A request should not include OmniPilot's selected model. The backend A2A server is responsible for choosing and using its own configured model and defaults.

### Error behavior

If a message starts with an A2A-style tag but no configured A2A server matches, show a clear error in the panel:

```text
A2A server not found: @A2Alocalhost
```

If a matching tag is present but the task text after the tag is empty, show a clear error that an A2A task is required.

Existing network/protocol failures from `delegateA2aTask` should continue to surface as user-visible errors.

## Architecture

### `content.js`

`content.js` owns the panel input and should make the routing decision before sending a runtime message.

Add small helpers:

- `normalizeA2aTag(value)`
  - Lowercases and removes non-alphanumeric characters.
- `findA2aServerByMention(tag)`
  - Compares normalized tag text against normalized enabled A2A server names.
- `parseA2aMentionTask(text)`
  - Detects a leading `@...` token.
  - Resolves it to an enabled A2A server.
  - Returns `{ server, task }` when matched.
  - Returns a structured "unknown tag" result when the message begins with `@A2A...` but has no match.
  - Returns `null` for ordinary chat with no A2A tag.
- `getA2aDelegationContext()`
  - Gathers selected-context messages without assistant replies.

Update `sendFollowUp(question)`:

1. Append the user message to the panel as today.
2. Parse the message for a leading A2A tag.
3. If it is a valid A2A mention:
   - Send `{ type: 'A2A_DELEGATE_TASK', serverId, task, contextText }`.
4. If it is an unknown A2A tag or empty task:
   - Show a clear panel error and do not call `AI_CHAT`.
5. If no A2A tag exists:
   - Send the existing `{ type: 'AI_CHAT', messages }` request.

Remove A2A servers from `getProviderEntries()` so they do not appear in the provider selector.

The explicit "Delegate to A2A…" action can remain available for selected-text workflows. This design only removes A2A from normal provider/model configuration and adds mention-triggered delegation.

### `background.js`

`background.js` should no longer route normal `AI_CHAT` automatically to A2A just because A2A is configured.

Update behavior:

- `normalizeProviderType()` should not treat `a2a:<serverId>` as an active provider type for new runtime behavior.
- `handleAIChat()` should always use the selected normal LLM provider.
- `A2A_DELEGATE_TASK` remains the only runtime path for A2A delegation, apart from the existing explicit delegation UI.

Keep the A2A request helpers and recent RPC endpoint fixes. They are still needed for tag-triggered and explicit A2A delegation.

### `options.js`

A2A server management remains in Settings as a separate A2A Servers section.

A2A servers should not be inserted into the provider configuration model. Existing A2A server metadata and token storage remain unchanged:

- `chrome.storage.sync.a2aServers`
- `chrome.storage.local.a2aServerTokens`

## Data Flow

### Normal chat

```text
Panel input: "hello"
content.js -> AI_CHAT
background.js -> selected LLM provider
```

### A2A tag delegation

```text
Panel input: "@A2Alocalhost hihihi"
content.js parses tag
content.js -> A2A_DELEGATE_TASK { serverId, task: "hihihi", contextText }
background.js -> A2A JSON-RPC message/send
A2A backend -> uses its own model/config
```

## Testing Plan

Add or update tests for these behaviors:

### Content script tests

- A2A servers do not appear in `getProviderEntries()`.
- `@A2Alocalhost hihihi` sends `A2A_DELEGATE_TASK`, not `AI_CHAT`.
- Mention matching ignores case, spaces, and punctuation.
- Ordinary follow-up text still sends `AI_CHAT`.
- Unknown A2A mention shows a clear panel error and does not send `AI_CHAT`.
- Empty A2A task after a valid mention shows a clear panel error.

### Background tests

- `providerType: "a2a:<serverId>"` is treated as legacy and no longer activates provider-mode A2A chat.
- Configured A2A servers no longer automatically route ordinary `AI_CHAT`.
- Existing `A2A_DELEGATE_TASK` tests continue to pass, including agent-card RPC URL handling and 404 discovery retry.

### Full suite

Run:

```sh
npm test
```

## Out of Scope

- Creating a new A2A protocol.
- Sending OmniPilot model settings to A2A.
- Removing the existing Settings A2A Servers management UI.
- Removing the explicit selected-text "Delegate to A2A…" flow.
- Persisting custom aliases beyond normalized server-name matching.
