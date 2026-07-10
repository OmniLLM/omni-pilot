# Configurable Response Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synchronized settings-page control that imposes a 30-second to 30-minute hard deadline on every user-initiated AI request, defaulting to five minutes.

**Architecture:** A small shared timeout utility is concatenated into every extension surface by the custom build. The background creates one deadline per top-level request and reuses its abort signal through provider and A2A work; content and side-panel surfaces use the same stored duration as an activity watchdog without extending the background deadline.

**Tech Stack:** Manifest V3, JavaScript modules concatenated by `build.mjs`, Chrome storage APIs, AbortController, Node VM unit tests, Playwright.

---

## File map

- Create `src/utils/timeout.mjs`: canonical constants, normalization, minute conversion, duration formatting, and timeout message.
- Create `src/background/agent/deadline.mjs`: background-only total-deadline lifecycle and abort classification.
- Modify `build.mjs`: inline timeout utilities into background, content, popup, options, and side-panel bundles.
- Modify `src/background/index.mjs` and `src/background/agent/{agent,runner}.mjs`: configuration, deadline creation, signal propagation, provider cancellation, and A2A deadline handling.
- Modify `src/options/{index.html,index.mjs}`, `src/utils/i18n.mjs`: settings control, persistence, validation, and localization.
- Modify `src/content-script/index.mjs`, `src/sidepanel/index.mjs`: configured inactivity watchdog.
- Modify `tests/unit/{background,options,i18n,content-language,options-language}.test.js` and `tests/settings-page.spec.js`: regression coverage.
- Modify `README.md`: document semantics and supported range.

### Task 1: Shared timeout primitives

- [ ] Add failing unit assertions for a default of `300000`, clamping at `30000` and `1800000`, minute conversion, and stable messages such as `Response timed out after 5 minutes.`
- [ ] Run the focused test and confirm the timeout symbols are missing.
- [ ] Create `src/utils/timeout.mjs` with `RESPONSE_TIMEOUT_DEFAULT_MS`, `RESPONSE_TIMEOUT_MIN_MS`, `RESPONSE_TIMEOUT_MAX_MS`, `normalizeResponseTimeoutMs`, `responseTimeoutMinutesToMs`, `responseTimeoutMsToMinutes`, `formatResponseTimeoutDuration`, and `createResponseTimeoutMessage`.
- [ ] Update `build.mjs` to strip the utility's exports and prepend it to every generated JavaScript bundle.
- [ ] Build and run the focused test until it passes.

### Task 2: Settings page and synchronized configuration

- [ ] Add failing options tests for `responseTimeoutMs` load, save, default, and clamping behavior.
- [ ] Add failing Playwright coverage for default `5`, persistence in milliseconds, and boundary normalization.
- [ ] Add `responseTimeoutMs` to background/options defaults and storage keys.
- [ ] Add the Advanced Settings number input with `min="0.5"`, `max="30"`, and `step="0.5"`; load minutes and save normalized milliseconds.
- [ ] Add English and Chinese `responseTimeout` and `responseTimeoutHint` translations and update language tests.
- [ ] Run focused options, language, and settings-page tests until green.

### Task 3: One background deadline for provider requests

- [ ] Add failing background tests proving non-streaming, streaming, and agent-loop provider fetches receive the same abort signal and timeout with the canonical message.
- [ ] Create `src/background/agent/deadline.mjs` with a deadline object exposing `signal`, `remainingMs()`, `timedOut`, `throwIfExpired()`, `toError(error)`, and `clear()`; guard environments without AbortController/timers.
- [ ] Create one deadline in each top-level `chat`, `action`, and `chatStreaming` path and clear it in `finally`.
- [ ] Thread the deadline/signal through raw, streaming, runner, and Copilot AI-provider request paths without changing device-auth polling.
- [ ] Convert deadline-triggered aborts to `Response timed out after <duration>.` while preserving unrelated failures.
- [ ] Run focused background tests until green.

### Task 4: Apply the deadline to A2A delegation

- [ ] Add failing tests showing A2A initial send, fallbacks, and polling share the top-level deadline, and status heartbeats do not extend it.
- [ ] Pass the shared signal to A2A fetches.
- [ ] Replace the independent 300/330-second limits with remaining-deadline checks while retaining a finite fallback attempt cap when no deadline implementation exists.
- [ ] Keep 10-second status heartbeats and ensure cleanup on completion/error.
- [ ] Run focused A2A/background tests until green.

### Task 5: Configured UI inactivity watchdogs

- [ ] Add failing content and side-panel tests for the default duration, stored duration, activity reset, and storage-read fallback.
- [ ] Replace each hard-coded 90-second constant with a normalized runtime value loaded from `chrome.storage.sync`.
- [ ] Preserve re-arming on every chunk/status and display the canonical timeout message.
- [ ] Run focused UI unit tests until green.

### Task 6: Documentation and end-to-end verification

- [ ] Update README configuration documentation with the five-minute default, 0.5–30-minute range, hard total deadline, and activity-watchdog distinction.
- [ ] Run all unit tests and fix only regressions caused by this implementation.
- [ ] Run all Playwright tests.
- [ ] Build and package the extension.
- [ ] Load the extension in Chromium, save/reload the setting, exercise a request that finishes before its deadline, and exercise a delayed request that shows the configured timeout.
- [ ] Run `git diff --check`, review the complete diff, and request code review.
- [ ] Commit with author `James Zhu <zhujian0805@gmail.com>`, merge to `main`, push, and prune the merged feature branch only after all verification passes.
