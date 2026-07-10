# Response Timeout Setting Design

**Date:** 2026-07-10
**Status:** Approved

## Objective

Add a single user-configurable **Response timeout** setting that limits every AI request made by OmniPilot, including direct provider requests, streaming provider requests, and A2A delegations.

The setting defaults to **5 minutes** and accepts values from **30 seconds through 30 minutes**.

## Current Behavior

OmniPilot currently has several unrelated timeout behaviors:

- Direct and streaming provider `fetch()` calls have no background abort timeout and can remain pending indefinitely.
- Content-script and side-panel streaming views use a 90-second inactivity watchdog that resets when response activity arrives.
- A2A polling is limited to approximately 300 seconds.
- A2A delegation has an approximately 330-second total timeout.
- A2A status heartbeats are emitted every 10 seconds so active delegations do not trigger the UI inactivity watchdog.

The new setting replaces these user-visible response limits with one coherent configured duration while preserving heartbeat behavior.

## User Experience

Add a numeric field to the options page's Advanced Settings section:

- **Label:** Response timeout
- **Unit:** minutes
- **Default:** 5
- **Minimum:** 0.5
- **Maximum:** 30
- **Step:** 0.5
- **Helper text:** Maximum total wait for an AI request. Streaming activity keeps the interface active, but the request still stops at this total limit.

The control uses minutes because this is easier to understand for normal and long-running agent requests. Internally, the setting is stored as milliseconds under `responseTimeoutMs`.

Invalid, empty, non-finite, or otherwise unusable values normalize to the 5-minute default. Numeric values outside the supported range are clamped to 30 seconds or 30 minutes.

## Configuration and Storage

Add `responseTimeoutMs` to the background and options `DEFAULT_CONFIG` and `STORAGE_KEYS` definitions. Store it in `chrome.storage.sync` with the rest of the provider configuration so the preference follows the user's synchronized browser profile.

All runtime surfaces load the same normalized value. Shared timeout constants and normalization rules must avoid divergent defaults among the background worker, content script, and side panel.

## Runtime Semantics

### Total request deadline

The configured duration is a hard total deadline measured from the start of one user-initiated AI request. It does not restart when response data arrives.

Apply the deadline to:

- non-streaming custom-provider and Azure provider requests;
- streaming custom-provider and Azure provider requests;
- GitHub Copilot model/provider requests used to answer a user AI request;
- the complete A2A delegation, including initial send and polling;
- agentic provider loops and tool-routing requests that belong to the same user turn.

Internal authentication setup operations such as the GitHub device authorization polling flow are not AI response requests and remain outside this setting.

### Provider cancellation

Create an `AbortController` for each top-level AI request. Schedule an abort at `responseTimeoutMs`, pass its signal to every provider `fetch()` belonging to that request, and always clear the deadline timer when the request succeeds or fails.

A timeout abort is converted into the user-facing error:

`Response timed out after <formatted duration>.`

Non-timeout network aborts and provider failures retain their existing error behavior.

### Streaming inactivity watchdog

The content-script and side-panel UI watchdogs load `responseTimeoutMs` from synchronized storage. Each incoming chunk or status message resets this UI inactivity watchdog so an active stream does not appear frozen.

This UI watchdog is a presentation safeguard, not the authoritative total deadline. The background's total request timer continues from request start and stops the operation once the configured duration is reached, even if chunks or A2A heartbeats continue.

### A2A delegation and polling

Use the configured duration as the single total deadline for the complete A2A operation. Polling must check the remaining deadline rather than maintaining an independent fixed five-minute ceiling. Initial send, fallback attempts, agent-card discovery required for delegation, and result polling all consume the same deadline.

Keep the existing 10-second A2A status heartbeat. Heartbeats reset the UI inactivity watchdog but never extend the background deadline.

## Boundaries and Isolation

Introduce focused timeout helpers rather than duplicating timer and formatting logic:

- A configuration normalizer owns default/minimum/maximum handling.
- A deadline helper owns the `AbortController`, timer cleanup, remaining-time calculation, and timeout classification for one top-level request.
- A duration formatter produces stable user-facing timeout messages.
- UI watchdog code consumes the normalized stored duration but does not own background cancellation.

The top-level request handlers create the deadline and pass its signal/deadline context through provider and A2A paths. Nested operations must reuse that context rather than starting fresh independent timers.

## Error Handling

- Timeout: show `Response timed out after <formatted duration>.`
- Manual or unrelated abort: preserve the original error when available.
- Missing or malformed stored setting: use 5 minutes.
- Values below 30 seconds or above 30 minutes: clamp to the supported boundary.
- Storage read failure in a UI surface: use 5 minutes so the interface remains usable.
- Timer cleanup occurs in `finally` paths to prevent stale aborts or leaked handles.

## Testing

### Unit tests

Cover:

- default normalization to 300,000 ms;
- conversion from the options-page minute value;
- clamping to 30,000 ms and 1,800,000 ms;
- save/load behavior for `responseTimeoutMs`;
- duration formatting for seconds and minutes;
- non-streaming and streaming provider requests receive and honor an abort signal;
- all provider/tool calls within one agent turn reuse the same total deadline;
- A2A initial send and polling stop at the configured total deadline;
- A2A heartbeats do not extend the total deadline;
- content-script and side-panel watchdogs load the stored duration and reset on activity;
- timeout errors use the consistent user-facing message;
- timers are cleared after success and ordinary failure.

### Browser tests

Extend the settings-page Playwright coverage to confirm:

- the default 5-minute value is rendered;
- saved values reload correctly;
- below-minimum and above-maximum values normalize to the supported boundaries;
- the field and helper text are localized consistently with existing settings labels.

### Runtime verification

Load the extension in Chromium and exercise:

1. Save a short supported timeout and reload Settings to confirm persistence.
2. Start a deliberately delayed provider response and observe the configured timeout message.
3. Start an active streaming response and confirm chunks keep the UI watchdog alive while the background total deadline still terminates the request.
4. Confirm a normal request finishing before the deadline succeeds unchanged.

## Documentation

Update the README configuration section to document the setting's default, range, total-deadline semantics, and the distinction between streaming activity and the hard request limit.

The privacy policy does not need a behavioral change because timeout configuration is already covered as a synchronized provider preference and does not introduce new data collection or transmission.
