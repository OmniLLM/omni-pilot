# Memory Subsystem Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-session memory subsystem so the omni-pilot Agent remembers user preferences and recent activity across browser restarts. Adds two tiers: a curated `MEMORY.md` (user-editable) and rolling daily logs (auto-appended). The Agent injects both into the system prompt on every chat/action turn; the options page grows a "Memory" card to view/edit `MEMORY.md` and clear logs.

**Architecture:** New `src/background/agent/memory.mjs` primitive owns read/write of both tiers, backed by `chrome.storage.local`. `createMemory()` returns `{ getLongTerm(), setLongTerm(text), getRecent(days), appendDailyLog(entry), pruneOldLogs(retentionDays), summary() }`. Loading happens once inside `createAgent()`; the resulting `summary()` string is prepended to whatever `systemPrompt` a caller supplies. Writing happens once at the end of every completed `chat()`/`action()` — small structured entries so a future auto-curation step (deferred to a later phase) has clean input. The options page gets a new card with a textarea for `MEMORY.md`, a "clear daily logs" button, and a status line showing storage usage.

**Tech Stack:** Vanilla ES modules, Chrome MV3 service worker, `chrome.storage.local`, existing hand-inlined concat build. No new dependencies.

**Reference docs read for this plan:**
- Harness Guide — [Memory and Context](https://harness-guide.com/guide/memory-and-context/) (three-concept split: context/session/memory; two-tier design; startup should read memory).
- Existing agent primitives from phase 1: `docs/superpowers/plans/2026-07-04-adk-restructure.md`.
- Chrome storage API — `chrome.storage.local` has a 10 MB default quota in MV3. `unlimitedStorage` permission would lift it but is overkill here; a 7-day rolling window on daily logs stays well under quota.

**Out of scope (deferred to later phases):**
- **LLM-driven auto-curation of `MEMORY.md`.** Users edit `MEMORY.md` themselves in phase 2. Auto-curation ("model, look at the last week of logs and update MEMORY.md") lands in a later phase (call it 2.5 if it becomes big enough for its own plan).
- **Priority-based context assembly with token budget.** Phase 3.
- **Semantic search across daily logs.** No embedding infra in the browser bundle; phase 5+ if it happens at all.
- **Per-conversation memory** (`AGENTS.md`-style behavior rules that scope to a project). Would need workspace concept; not currently in the extension.
- **Memory read on options page load** for editing — the textarea just reads the current stored value on card render, no fancy live-sync.
- **Streaming path.** Same limitation as phase 1: `handleAIChatStreaming` isn't yet routed through `Agent`, so it doesn't get memory in this phase. Adding memory to the streaming path is a small follow-up but not required here; the plan explicitly leaves it out.

---

## Design decisions worth calling out

1. **Storage keys.** Two keys under `chrome.storage.local`:
   - `omnipilotMemoryLongTerm` — string (the raw `MEMORY.md` content).
   - `omnipilotMemoryDailyLogs` — object shaped `{ [YYYY-MM-DD]: string[] }`. Each entry is one line (kept short — timestamp + one-sentence description). Storing per-day arrays makes pruning O(days), not O(all-entries).

2. **When Memory is read.** Once per `createAgent()` invocation. Since `handleAIChat` currently instantiates `createAgent` per message, memory is re-read every turn — that's a `chrome.storage.local.get` call, cheap and always fresh so user edits show up on the next message with no reload dance.

3. **When Memory is written.** Every `agent.chat()`/`agent.action()` call appends ONE log entry after the turn completes successfully. Failures do NOT append (a failed turn isn't a useful memory). The log entry is a short summary line — for phase 2 it's just `HH:MM:SS action=chat|<action> ... user_len=... assistant_len=...` (no PII, no full text). Full-text logging can be a debug toggle later.

4. **Pruning.** Runs opportunistically inside `appendDailyLog` — after appending, if the log has entries for more than `RETENTION_DAYS = 7` distinct dates, drop the oldest dates until only 7 remain. Cheap, avoids scheduling.

5. **Summary format injected into the system prompt.** A fenced markdown block titled `Memory` containing (in order): (a) the `MEMORY.md` content if present; (b) a "Recent activity (last 7 days)" section with the daily log entries. If both are empty, the memory block is omitted entirely so we don't pollute short prompts with `Memory:\n(empty)\n`.

6. **Memory is opt-out.** New config key `memoryEnabled` (default `true`, stored in `chrome.storage.sync` alongside the other `STORAGE_KEYS`). Users who don't want cross-session memory can disable it from the options page. When disabled, `createAgent` skips the memory read entirely and no logs are written.

7. **Concurrency.** Multiple side-panel windows could race on `appendDailyLog`. We swallow this: `chrome.storage.local.set` is atomic per call but concurrent `get`+`modify`+`set` sequences can lose entries. Acceptable for phase 2 — the memory subsystem's correctness properties don't hinge on 100% log completeness. A tiny best-effort retry (read-modify-write once more on collision) is fine; skip the retry if it complicates the code.

8. **No new streaming integration.** The plan does NOT route memory through `handleAIChatStreaming`. When phase 5 restructures streaming to use the Agent/Runner primitives, memory comes along automatically.

---

## File Structure

**New files (all under `src/background/agent/`):**
- `memory.mjs` — `createMemory()` factory returning read/write helpers and a `summary()` string.

**Modified files:**
- `src/background/agent/agent.mjs` — `createAgent` awaits `createMemory()` when memory is enabled, prepends `memory.summary()` to the system prompt for both `chat` and `action`, and calls `memory.appendDailyLog(...)` after each successful call.
- `src/background/agent/constants.mjs` — add `MEMORY_LONG_TERM_KEY`, `MEMORY_DAILY_LOGS_KEY`, `MEMORY_RETENTION_DAYS = 7`.
- `src/background/index.mjs` — add `memoryEnabled` to `DEFAULT_CONFIG` and `STORAGE_KEYS`. No other changes.
- `src/options/index.html` — new "Memory" card with `<textarea id="memoryLongTerm">`, `<button id="clearDailyLogs">`, `<button id="saveMemory">`, `<div id="memoryStatus">`, and `<input type="checkbox" id="memoryEnabled">`.
- `src/options/index.mjs` — wire the new card: on load read from storage, on Save write `MEMORY.md`, on Clear delete `omnipilotMemoryDailyLogs`, on toggle change persist `memoryEnabled`.
- `src/utils/i18n.mjs` — add memory-related i18n keys (`memory`, `memoryEnabled`, `memoryLongTerm`, `memoryClearLogs`, `memorySaved`, `memoryLogsCleared`, `memoryEmpty`).
- `tests/unit/background.test.js` — three new tests: memory primitive round-trip, Agent injects memory into system prompt, Agent skips memory when disabled.
- `tests/unit/options.test.js` — one new test: options page can render the memory card and save/clear.

**Preserved verbatim (no touch):**
- `src/background/agent/runner.mjs`, `session.mjs`, `state.mjs`, `tool.mjs`, `tool-registry.mjs`, `a2a-tool-provider.mjs`, `follow-up.mjs` — phase-1 primitives untouched.
- `src/sidepanel/index.mjs`, `src/popup/index.mjs`, `src/content-script/index.mjs` — no UI changes to chat surfaces.
- `manifest.json` — no permission changes; `storage` was already declared in phase 0.

---

## Task 1: Create the `memory.mjs` primitive with round-trip tests

**Files:**
- Create: `src/background/agent/memory.mjs`
- Modify: `src/background/agent/constants.mjs` (add 3 constants)
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/background.test.js`:

```js
async function assertMemoryPrimitiveRoundTripsLongTermAndDailyLogs() {
  const { context, stores } = await createBackgroundContext({ storage: {} });

  const memory = await context.createMemory({
    // Deterministic clock — real code reads `new Date()` inside `appendDailyLog`,
    // which we override here so the test doesn't depend on wall-clock time.
    now: () => new Date('2026-07-04T12:34:56Z')
  });

  // Long-term memory round-trip.
  assert.strictEqual(await memory.getLongTerm(), '');
  await memory.setLongTerm('Prefers TypeScript. Timezone Asia/Shanghai.');
  assert.strictEqual(await memory.getLongTerm(), 'Prefers TypeScript. Timezone Asia/Shanghai.');

  // Daily log append is grouped by YYYY-MM-DD.
  await memory.appendDailyLog('12:34:56 action=chat user_len=5 assistant_len=12');
  const recent = await memory.getRecent(1);
  assert.strictEqual(recent.length, 1);
  assert.strictEqual(recent[0].date, '2026-07-04');
  assert.strictEqual(recent[0].entries.length, 1);
  assert.ok(recent[0].entries[0].includes('action=chat'));

  // Storage was actually written to chrome.storage.local (not sync).
  assert.ok(stores.localStore.omnipilotMemoryLongTerm);
  assert.ok(stores.localStore.omnipilotMemoryDailyLogs);
  assert.strictEqual(stores.syncStore.omnipilotMemoryLongTerm, undefined);
}

async function assertMemoryPrunesLogsOlderThanRetentionWindow() {
  const { context, stores } = await createBackgroundContext({ storage: {} });

  // Pre-seed 10 days of logs directly into local storage so we can prove
  // the pruner drops the oldest ones on the next append.
  const seeded = {};
  for (let i = 0; i < 10; i += 1) {
    const d = new Date(Date.UTC(2026, 6, 1 + i));
    seeded[d.toISOString().slice(0, 10)] = [`seed entry for day ${i}`];
  }
  stores.localStore.omnipilotMemoryDailyLogs = seeded;

  const memory = await context.createMemory({
    now: () => new Date('2026-07-11T00:00:00Z')
  });
  await memory.appendDailyLog('new entry');

  const stored = stores.localStore.omnipilotMemoryDailyLogs;
  const dates = Object.keys(stored).sort();
  assert.strictEqual(dates.length, 7, 'should retain exactly MEMORY_RETENTION_DAYS = 7 dates');
  // Oldest three (2026-07-01, 02, 03) should be gone; 04-11 remain (though 08-10
  // are seeded and 11 has the fresh entry, all within window).
  assert.ok(!dates.includes('2026-07-01'));
  assert.ok(!dates.includes('2026-07-02'));
  assert.ok(!dates.includes('2026-07-03'));
  assert.ok(dates.includes('2026-07-11'));
}

async function assertMemorySummaryOmitsEmptyBlockAndFormatsFilledBlock() {
  const { context } = await createBackgroundContext({ storage: {} });

  // Empty memory → empty summary (no "Memory: (empty)" pollution).
  const empty = await context.createMemory({ now: () => new Date('2026-07-04T00:00:00Z') });
  assert.strictEqual(await empty.summary(), '');

  // Filled memory → fenced block with long-term first, then recent activity.
  const filled = await context.createMemory({ now: () => new Date('2026-07-04T00:00:00Z') });
  await filled.setLongTerm('Prefers concise answers.');
  await filled.appendDailyLog('09:00:00 action=chat user_len=3 assistant_len=42');
  const s = await filled.summary();
  assert.ok(s.startsWith('## Memory'), 'summary starts with a Memory heading');
  assert.ok(s.includes('Prefers concise answers.'));
  assert.ok(/Recent activity/i.test(s));
  assert.ok(s.includes('2026-07-04'));
}
```

Register all three in `main()` alongside phase-1 tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — `context.createMemory is not a function`.

- [ ] **Step 3: Add memory constants to `src/background/agent/constants.mjs`**

Append to the constants file:

```js
// Memory subsystem — storage keys and retention policy.
// Long-term memory (MEMORY.md-equivalent) is user-editable; daily logs
// are agent-appended and rolled over every MEMORY_RETENTION_DAYS days.
const MEMORY_LONG_TERM_KEY = 'omnipilotMemoryLongTerm';
const MEMORY_DAILY_LOGS_KEY = 'omnipilotMemoryDailyLogs';
const MEMORY_RETENTION_DAYS = 7;
```

- [ ] **Step 4: Create `src/background/agent/memory.mjs`**

```js
// OmniPilot agent primitives — Memory.
//
// Cross-session memory backed by chrome.storage.local. Two tiers:
//   * Long-term memory: a single user-editable string (MEMORY.md-equivalent).
//   * Daily logs: agent-appended entries grouped by YYYY-MM-DD, pruned
//     to a rolling MEMORY_RETENTION_DAYS window on every write.
//
// Concatenated into dist/background.js; do not add `export`s.
// All storage APIs go through the existing storageGet/storageSet
// helpers in src/background/index.mjs so tests hit the same fakes.

function createMemory({ now = () => new Date() } = {}) {
  async function getLongTerm() {
    const stored = await storageGet([MEMORY_LONG_TERM_KEY], chrome.storage.local);
    return stored[MEMORY_LONG_TERM_KEY] || '';
  }

  async function setLongTerm(text) {
    await storageSet({ [MEMORY_LONG_TERM_KEY]: String(text || '') }, chrome.storage.local);
  }

  async function getDailyLogs() {
    const stored = await storageGet([MEMORY_DAILY_LOGS_KEY], chrome.storage.local);
    return (stored[MEMORY_DAILY_LOGS_KEY] && typeof stored[MEMORY_DAILY_LOGS_KEY] === 'object')
      ? stored[MEMORY_DAILY_LOGS_KEY]
      : {};
  }

  async function setDailyLogs(logs) {
    await storageSet({ [MEMORY_DAILY_LOGS_KEY]: logs }, chrome.storage.local);
  }

  function todayKey() {
    return now().toISOString().slice(0, 10);
  }

  async function appendDailyLog(entry) {
    if (!entry) return;
    const logs = await getDailyLogs();
    const key = todayKey();
    const day = Array.isArray(logs[key]) ? logs[key].slice() : [];
    day.push(String(entry));
    logs[key] = day;

    // Prune: keep only the newest MEMORY_RETENTION_DAYS distinct dates.
    const dates = Object.keys(logs).sort();
    while (dates.length > MEMORY_RETENTION_DAYS) {
      delete logs[dates.shift()];
    }

    await setDailyLogs(logs);
  }

  async function getRecent(days = MEMORY_RETENTION_DAYS) {
    const logs = await getDailyLogs();
    const sorted = Object.keys(logs).sort();
    const window = sorted.slice(-days);
    return window.map(date => ({ date, entries: logs[date] }));
  }

  async function clearDailyLogs() {
    await storageSet({ [MEMORY_DAILY_LOGS_KEY]: {} }, chrome.storage.local);
  }

  async function summary() {
    const longTerm = await getLongTerm();
    const recent = await getRecent(MEMORY_RETENTION_DAYS);
    if (!longTerm && recent.length === 0) return '';

    const parts = ['## Memory'];
    if (longTerm) {
      parts.push('', longTerm.trim());
    }
    if (recent.length) {
      parts.push('', '### Recent activity');
      for (const { date, entries } of recent) {
        parts.push(`- ${date}`);
        for (const entry of entries) parts.push(`  - ${entry}`);
      }
    }
    return parts.join('\n');
  }

  return { getLongTerm, setLongTerm, appendDailyLog, getRecent, clearDailyLogs, summary };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS — all three new tests + every existing test.

- [ ] **Step 6: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/agent/constants.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/agent/memory.mjs src/background/agent/constants.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: add Memory primitive with long-term + daily-log tiers

createMemory() owns cross-session memory backed by chrome.storage.local:
long-term memory is a user-editable string (MEMORY.md-equivalent);
daily logs are agent-appended entries grouped by YYYY-MM-DD and pruned
to the last MEMORY_RETENTION_DAYS (7) days on every write. summary()
returns a fenced markdown block that createAgent will prepend to the
system prompt on later tasks. Empty summary returns "" so short prompts
don't get "Memory: (empty)" pollution.

Tests cover: long-term + daily-log round-trip in chrome.storage.local,
pruning to the retention window, and summary formatting when empty vs
filled.
EOF
)"
```

---

## Task 2: Add `memoryEnabled` toggle to config

**Files:**
- Modify: `src/background/index.mjs` (`DEFAULT_CONFIG`, `STORAGE_KEYS`)
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write the failing test**

Append:

```js
async function assertMemoryEnabledDefaultsTrueAndPersists() {
  const { context, stores } = await createBackgroundContext({ storage: {} });

  const config = await context.loadConfig();
  assert.strictEqual(config.memoryEnabled, true, 'memoryEnabled defaults to true');

  // Persisting via the same helpers used elsewhere.
  stores.syncStore.memoryEnabled = false;
  const config2 = await context.loadConfig();
  assert.strictEqual(config2.memoryEnabled, false, 'stored false is honored');
}
```

Register in `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — `config.memoryEnabled` is `undefined`.

- [ ] **Step 3: Add `memoryEnabled` to `DEFAULT_CONFIG` and `STORAGE_KEYS`**

In `src/background/index.mjs`, locate `DEFAULT_CONFIG` (currently around line 59). Add `memoryEnabled: true` to it. Then locate `STORAGE_KEYS` (currently around line 70) and add `'memoryEnabled'` to the array. Exact edits:

```js
const DEFAULT_CONFIG = {
  endpoint: 'https://api.omnillm.com/v1',
  apiKey: '',
  model: 'claude-sonnet-4-5',
  models: '',
  apiShape: 'openai-compatible',
  providerType: PROVIDER_TYPES.CUSTOM,
  authMethod: AUTH_METHODS.API_KEY,
  a2aAutoRoute: true,
  memoryEnabled: true
};

const STORAGE_KEYS = ['endpoint', 'apiKey', 'model', 'models', 'apiShape', 'providerType', 'authMethod', 'providerConfigs', 'a2aServers', 'a2aAutoRoute', 'memoryEnabled'];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/index.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/index.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "feat: add memoryEnabled config flag defaulting to true"
```

---

## Task 3: Wire Memory into `createAgent`

**Files:**
- Modify: `src/background/agent/agent.mjs`
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write the failing tests**

Append:

```js
async function assertAgentInjectsMemoryIntoSystemPrompt() {
  // Pre-seed memory so createAgent picks it up on first chat().
  const seedLocalStore = {
    omnipilotMemoryLongTerm: 'Prefers concise answers.',
    omnipilotMemoryDailyLogs: {
      '2026-07-03': ['09:00:00 action=chat user_len=3 assistant_len=42']
    }
  };

  let capturedSystemPrompt = null;
  const { context } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible',
      a2aAutoRoute: false,
      memoryEnabled: true,
      ...seedLocalStore
    },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      capturedSystemPrompt = body.messages.find(m => m.role === 'system')?.content || '';
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    }
  });

  const agent = await context.createAgent();
  await agent.chat([{ role: 'user', content: 'hi' }]);

  assert.ok(capturedSystemPrompt.includes('## Memory'), 'system prompt should carry the Memory block');
  assert.ok(capturedSystemPrompt.includes('Prefers concise answers.'));
  assert.ok(capturedSystemPrompt.includes('2026-07-03'));
}

async function assertAgentSkipsMemoryWhenDisabled() {
  let capturedSystemPrompt = null;
  const { context } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible',
      a2aAutoRoute: false,
      memoryEnabled: false,
      omnipilotMemoryLongTerm: 'Should not appear.'
    },
    fetchImpl: async (_url, options) => {
      capturedSystemPrompt = JSON.parse(options.body).messages.find(m => m.role === 'system')?.content || '';
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    }
  });

  const agent = await context.createAgent();
  await agent.chat([{ role: 'user', content: 'hi' }]);

  assert.ok(!capturedSystemPrompt.includes('## Memory'), 'Memory block must NOT appear when disabled');
  assert.ok(!capturedSystemPrompt.includes('Should not appear.'));
}

async function assertAgentAppendsDailyLogAfterSuccessfulChat() {
  const { context, stores } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible',
      a2aAutoRoute: false,
      memoryEnabled: true
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'the reply' } }] })
    })
  });

  const agent = await context.createAgent();
  await agent.chat([{ role: 'user', content: 'hello' }]);

  const logs = stores.localStore.omnipilotMemoryDailyLogs;
  assert.ok(logs, 'daily-log storage should be populated after a chat');
  const dates = Object.keys(logs);
  assert.strictEqual(dates.length, 1, 'exactly one day should be logged');
  const entries = logs[dates[0]];
  assert.strictEqual(entries.length, 1, 'exactly one entry should be appended');
  assert.ok(/action=chat/.test(entries[0]), 'entry should be tagged with the action');
}
```

Register all three in `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — memory block not present / logs not written.

- [ ] **Step 3: Wire Memory into `createAgent`**

Modify `src/background/agent/agent.mjs`. Replace the entire file with:

```js
// OmniPilot agent primitives — Agent.
//
// High-level entry point. Owns provider selection (loadConfig,
// getCopilotAccessToken when applicable), assembles a ToolRegistry
// from currently-enabled A2A servers when auto-routing is on, and
// delegates the loop to createRunner. When memoryEnabled is on
// (default), loads long-term + daily-log memory and prepends a
// Memory block to the system prompt, then appends one log entry
// per completed chat/action.

async function createAgent(overrides = {}) {
  const config = overrides.config || await loadConfig();
  const provider = getProvider(config);
  let copilotToken = '';
  if (provider.usesCopilotAuth) {
    try {
      copilotToken = await getCopilotAccessToken();
      config.apiKey = copilotToken;
    } catch {
      throw new Error('GitHub Copilot authentication failed. Please re-authenticate in Settings.');
    }
  } else if (!config.apiKey) {
    throw new Error('No API key configured. Click the OmniPilot icon to set up.');
  }

  const memory = config.memoryEnabled === false ? null : createMemory();
  const memoryPrefix = memory ? (await memory.summary()) : '';

  function combinedSystemPrompt(base) {
    if (!memoryPrefix) return base;
    return `${memoryPrefix}\n\n${base}`;
  }

  async function chat(messages) {
    const systemPrompt = combinedSystemPrompt(overrides.systemPrompt || CHAT_SYSTEM_PROMPT);
    let result;
    if (shouldAutoRouteA2a(config)) {
      const a2aServers = await ensureEnabledA2aServersDiscovered();
      if (a2aServers.length) {
        result = await executeApiRequestWithA2aRouting({
          config,
          messages,
          systemPrompt,
          a2aServers,
          toolSchemas: buildA2aToolSchemas(a2aServers),
          onStatus: overrides.onStatus
        });
      }
    }
    if (result === undefined) {
      result = await executeApiRequestWithConfig({
        config,
        messages,
        systemPrompt,
        copilotToken,
        allowModelFallback: provider.usesCopilotAuth
      });
    }
    if (memory) {
      const userLen = String(messages[messages.length - 1]?.content || '').length;
      const assistantLen = String(result || '').length;
      await memory.appendDailyLog(buildLogEntry({ action: 'chat', userLen, assistantLen }));
    }
    return result;
  }

  async function action(actionName, text) {
    const basePrompt = ACTION_PROMPTS[actionName];
    if (!basePrompt) throw new Error(`Unknown action: ${actionName}`);
    const systemPrompt = combinedSystemPrompt(basePrompt);
    const result = await executeApiRequestWithConfig({
      config,
      messages: [{ role: 'user', content: text }],
      systemPrompt,
      copilotToken,
      allowModelFallback: provider.usesCopilotAuth
    });
    if (memory) {
      await memory.appendDailyLog(buildLogEntry({
        action: actionName,
        userLen: String(text || '').length,
        assistantLen: String(result || '').length
      }));
    }
    return result;
  }

  return { chat, action, config, memory };
}

function buildLogEntry({ action, userLen, assistantLen, now = new Date() }) {
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} action=${action} user_len=${userLen} assistant_len=${assistantLen}`;
}
```

Notes:
- `memory` (or `null`) is returned on the agent so options-page code can reach it via `agent.memory` for the "clear logs" button (Task 5 uses this).
- `buildLogEntry` is a plain function inside the same file; concat-bundle friendly.
- Failed calls DO NOT append (the `await memory.appendDailyLog(...)` sits after the `await` that would throw on failure). Good — matches the plan's failure-omission policy.

- [ ] **Step 4: Run test to verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS — all three new tests plus every phase-1 test still green.

- [ ] **Step 5: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/agent/agent.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/agent/agent.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: Agent injects Memory into system prompt and logs completed turns

createAgent now instantiates a Memory (when memoryEnabled) at construction
time, prepends its summary() block to the system prompt for both chat and
action, and appends one daily-log entry per successful call. Failures do
not append.

Log entry format is compact and PII-free for phase 2: timestamp, action,
user/assistant lengths. Full-text logging can land as a debug toggle later.
EOF
)"
```

---

## Task 4: Add "Memory" card to the options page

**Files:**
- Modify: `src/options/index.html`
- Modify: `src/options/index.mjs`
- Modify: `src/utils/i18n.mjs`
- Test: `tests/unit/options.test.js`

- [ ] **Step 1: Add i18n keys**

Read `src/utils/i18n.mjs` first to understand its structure. Add these keys (both English and Chinese if the file has Chinese; match existing pattern) to the translations block:

```js
memory: 'Memory',
memoryEnabled: 'Enable cross-session memory',
memoryLongTerm: 'Long-term notes',
memoryLongTermHint: 'Facts, preferences, and context you want the assistant to remember across sessions.',
memoryClearLogs: 'Clear recent activity',
memorySave: 'Save memory',
memorySaved: 'Memory saved',
memoryLogsCleared: 'Recent activity cleared',
memoryEmpty: '(no memory recorded yet)'
```

(Chinese translations: use whatever the file already does for other cards — copy the pattern.)

- [ ] **Step 2: Add the Memory card to `src/options/index.html`**

Find a good insertion point (after the A2A card, before the About/version card if there is one). Add:

```html
<div class="card">
  <div class="card-title" id="memoryTitle" data-i18n="memory">Memory</div>
  <div class="toggle-row">
    <label>
      <input type="checkbox" id="memoryEnabled">
      <span data-i18n="memoryEnabled">Enable cross-session memory</span>
    </label>
  </div>
  <div class="field">
    <label for="memoryLongTerm" data-i18n="memoryLongTerm">Long-term notes</label>
    <textarea id="memoryLongTerm" rows="8" placeholder=""></textarea>
    <div class="hint" data-i18n="memoryLongTermHint">Facts, preferences, and context you want the assistant to remember across sessions.</div>
  </div>
  <div class="button-row">
    <button id="saveMemory" data-i18n="memorySave">Save memory</button>
    <button id="clearDailyLogs" data-i18n="memoryClearLogs">Clear recent activity</button>
  </div>
  <div class="status" id="memoryStatus"></div>
</div>
```

If the existing CSS doesn't already style `.toggle-row`, `.button-row`, `.hint`, and `.status`, copy the styling from analogous classes already present in the file — don't invent new ones.

- [ ] **Step 3: Wire the card in `src/options/index.mjs`**

Read the existing options mjs first to understand its module structure (it has an on-load initializer and `chrome.storage.sync/local` calls). Add a new `initMemoryCard()` function called from the DOM-ready block, and add change-handler + button-click helpers. Skeleton:

```js
async function initMemoryCard() {
  const enabledEl = document.getElementById('memoryEnabled');
  const longTermEl = document.getElementById('memoryLongTerm');
  const saveBtn = document.getElementById('saveMemory');
  const clearBtn = document.getElementById('clearDailyLogs');
  const statusEl = document.getElementById('memoryStatus');
  if (!enabledEl || !longTermEl || !saveBtn || !clearBtn) return;

  // Read initial state from storage.
  const syncStored = await new Promise(resolve => chrome.storage.sync.get(['memoryEnabled'], resolve));
  enabledEl.checked = syncStored.memoryEnabled !== false; // default true
  const localStored = await new Promise(resolve => chrome.storage.local.get(['omnipilotMemoryLongTerm'], resolve));
  longTermEl.value = localStored.omnipilotMemoryLongTerm || '';

  enabledEl.addEventListener('change', () => {
    chrome.storage.sync.set({ memoryEnabled: enabledEl.checked });
  });

  saveBtn.addEventListener('click', async () => {
    await new Promise(resolve => chrome.storage.local.set({ omnipilotMemoryLongTerm: longTermEl.value }, resolve));
    statusEl.textContent = getI18n('memorySaved');
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  });

  clearBtn.addEventListener('click', async () => {
    await new Promise(resolve => chrome.storage.local.set({ omnipilotMemoryDailyLogs: {} }, resolve));
    statusEl.textContent = getI18n('memoryLogsCleared');
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  });
}
```

If the existing options code uses a different pattern for `getI18n` or storage helpers, follow that pattern instead of introducing new ones. The exact function name and DOMContentLoaded wiring should match the existing style.

Call `initMemoryCard()` from wherever the other card initializers get called (DOMContentLoaded handler, most likely).

- [ ] **Step 4: Add an options-page unit test**

Append to `tests/unit/options.test.js`. This file uses `jsdom` or a similar DOM harness — read the file first to confirm the pattern, then add:

```js
async function assertOptionsMemoryCardSavesAndClears() {
  // If the file already has a helper like createOptionsDom(), use it.
  // Otherwise, this test only asserts that the HTML contains the card's
  // key IDs (a smoke test that the card was actually added to the HTML).
  const html = fs.readFileSync('src/options/index.html', 'utf8');
  assert.ok(html.includes('id="memoryEnabled"'), 'HTML should contain the memory-enabled toggle');
  assert.ok(html.includes('id="memoryLongTerm"'), 'HTML should contain the long-term textarea');
  assert.ok(html.includes('id="saveMemory"'), 'HTML should contain the save button');
  assert.ok(html.includes('id="clearDailyLogs"'), 'HTML should contain the clear-logs button');
  assert.ok(html.includes('data-i18n="memory"'), 'card should use the memory i18n key');
}
```

Register in `main()` of `tests/unit/options.test.js`.

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS — new options test plus every existing test.

- [ ] **Step 6: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/options/index.html','src/options/index.mjs','src/utils/i18n.mjs','tests/unit/options.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/options/index.html src/options/index.mjs src/utils/i18n.mjs tests/unit/options.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: options page grows a Memory card

Adds an "Memory" card with:
  * a toggle for the memoryEnabled flag (defaults on),
  * a textarea for user-curated long-term notes (MEMORY.md equivalent),
  * a "Save memory" button that writes to chrome.storage.local,
  * a "Clear recent activity" button that empties the daily logs.

New i18n keys land in src/utils/i18n.mjs; the smoke test locks the
card's IDs into the HTML so a future edit that drops one of them fails
CI instead of silently breaking the wiring.
EOF
)"
```

---

## Task 5: Documentation + final wrap

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-04-adk-restructure.md` (mark phase 2 done in the "later phases" comment)

- [ ] **Step 1: Update the README architecture section**

Read the current `## Architecture` section in `README.md`. After the bullet describing `src/background/agent/`, add:

```markdown
### Memory

The Agent maintains cross-session memory via `src/background/agent/memory.mjs`:

- **Long-term memory** — a user-editable string (like a project's `MEMORY.md`), edited from the extension's options page. Prepended to the system prompt on every chat/action.
- **Daily activity logs** — a rolling 7-day window of one-line entries the Agent appends after each successful turn. Also injected into the system prompt so the model has recent context across restarts.

Both tiers live in `chrome.storage.local`. Users can disable memory or clear the daily logs from the options page.
```

- [ ] **Step 2: Run the full test suite one more time**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 3: Manual smoke check**

Load `dist/` into Chrome as an unpacked extension. In the options page, confirm:
- The Memory card renders.
- Toggle works and persists across a reload.
- Saving a note like "Prefers concise answers." persists.
- After sending a chat message, "Clear recent activity" removes what got logged.

In the side panel, send: `remember I prefer bullet points`. The Agent won't literally curate MEMORY.md (that's a later phase), but you can manually paste `Prefers bullet points.` into the Memory card. Then send: `what do you know about me?` — the model should reference bullet-point preference because it saw the memory block in its system prompt.

- [ ] **Step 4: Commit and push**

```bash
node -e "const fs=require('fs'); fs.writeFileSync('README.md', fs.readFileSync('README.md','utf8').replace(/\r\n/g,'\n'));"

git add README.md
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
docs: describe Memory subsystem in README

Wraps up phase 2 of the ADK-style harness build-out. The Memory
primitive is now integrated into Agent and exposed via the options
page; phase 3 will add priority-based context assembly on top of it.
EOF
)"

git push origin main
```

---

## Self-Review Checklist

Ran through the writing-plans skill's self-review checklist:

1. **Spec coverage.** User asked for the Memory subsystem (phase 2 of the 5 slices agreed after phase 1). ✓ Tier 1 daily logs (`getRecent`, `appendDailyLog`, pruning). ✓ Tier 2 long-term memory (`getLongTerm`, `setLongTerm`). ✓ Startup memory read (inside `createAgent`). ✓ Enable/disable toggle (`memoryEnabled` config + options card). ✓ Options page editing UI. ✓ Auto-curation explicitly deferred with a note. ✓ Concurrency limitation called out.

2. **Placeholder scan.** No "TBD", "later", "similar to task N", or "handle appropriately". Every code block is complete and runnable. Two "read the file first to match existing pattern" instructions in Task 4 for the options mjs and i18n — those are legitimate ("copy the codebase's own pattern") not placeholders.

3. **Type consistency.** `createMemory`, `getLongTerm`, `setLongTerm`, `appendDailyLog`, `getRecent`, `clearDailyLogs`, `summary`, `memoryEnabled`, `MEMORY_LONG_TERM_KEY`, `MEMORY_DAILY_LOGS_KEY`, `MEMORY_RETENTION_DAYS`, `combinedSystemPrompt`, `buildLogEntry` — all names referenced consistently across tasks.

---

## Verification

**During implementation, after every task:**
- `npm run test:unit` must pass (all unit test files).
- `node build.mjs` must produce a `dist/background.js` that grows by roughly the size of the new memory code (~2-3 KB).

**After Task 5 (phase 2 complete):**
- Load `dist/` into Chrome and run the manual smoke check from Task 5 Step 3.
- Confirm `chrome.storage.local` shows `omnipilotMemoryLongTerm` and `omnipilotMemoryDailyLogs` after a few chat interactions (Chrome DevTools → Application → Storage → Extension storage).
- Confirm `chrome.storage.sync` shows `memoryEnabled` after toggling the options page.
- Verify the model actually references the injected memory in a follow-up conversation (qualitative check — the model may or may not use it depending on task, but it should be visible in the system prompt if you log it).

**Regression:** Every phase-1 test still passes. `handleAIChat` (both plain and A2A paths) and `handleAIAction` behave identically except for the additional Memory block prepended to their system prompts.
