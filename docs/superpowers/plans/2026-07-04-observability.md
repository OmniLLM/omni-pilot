# Observability Implementation Plan (Phase 5 — final)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a structured event stream around every Agent run — round starts, tool dispatches, tool results (success + failure), guardrail decisions, memory operations — persisted per-run in a ring buffer, and expose the most recent runs in a new "Debug" panel on the options page. Wraps up phase 5 of 5.

**Architecture:** New `src/background/agent/observability.mjs` primitive: `createTraceRecorder({ maxRuns = 20, maxEventsPerRun = 200 })` returns `{ startRun(label), event(type, data), endRun(status), snapshot() }`. Persists ring-buffered runs to `chrome.storage.local["omnipilotTraces"]`. Wired into `createAgent()` so every `chat()`/`action()` becomes one run, and into `createRunner()`/`createGuardrails()` via optional `onEvent` callbacks. A new Debug card on the options page reads and renders the most recent 20 runs.

**Tech Stack:** Vanilla ES modules, existing concat build. No new deps.

**Reference:** Harness Guide — implicit in the general "observability" theme (traces + telemetry are called out throughout `/guide/`), and `State`/`Runner` primitives from phase 1 already reserved space for it.

**Out of scope:**
- Real-time streaming of events to the UI. The Debug view is snapshot-based (refresh button).
- Cross-device telemetry / remote sinks. Everything local.
- Retention of full assistant/user message text (privacy-first — traces record lengths + tool metadata only).

---

## Design

1. **`createTraceRecorder`** — pure factory, no chrome deps at construction:
   - `startRun(label)` → returns `runId` (string; timestamp-based), initializes an in-memory run object `{ id, label, startedAt, endedAt, status, events: [] }`.
   - `event(type, data)` → pushes `{ ts, type, data }` into the current run's events (drops oldest if `events.length >= maxEventsPerRun`).
   - `endRun(status)` → marks the current run as done, persists all runs (ring-buffered to `maxRuns`) to `chrome.storage.local["omnipilotTraces"]`. Best-effort — failures swallowed with a warn.
   - `snapshot()` → returns a deep-cloned array of runs currently persisted (for the Debug view).
   - Robust to missing `chrome.storage.local` (skip persist, just log a warn).

2. **Event types emitted:**
   - `run.start` — `{ label }`
   - `run.end` — `{ status }`
   - `context.built` — `{ tokens, dropped }` (from ContextAssembler)
   - `provider.request` — `{ requestUrl, apiShape, model, round }`
   - `provider.response` — `{ round, toolCallCount, textLen }`
   - `tool.dispatch` — `{ toolName, serverId, verdict }` (verdict = classify() result)
   - `tool.result` — `{ toolName, ok, textLen, error }`
   - `guardrail.denied` — `{ toolName, reason }`
   - `memory.append` — `{ ok }`

3. **Wiring:**
   - `createAgent()` builds a recorder up-front, calls `startRun(action)` before chat/action, `endRun('ok'|'error')` after.
   - `Runner` accepts an optional `onEvent(type, data)` — called at request start, response, per-call dispatch/result.
   - `Guardrails.wrap(registry, onEvent)` — new optional second arg; when denied, emits `guardrail.denied`.
   - `ContextAssembler.buildMessages` — returns dropped as before; agent emits `context.built` from the assembled result.
   - Memory append surfaces `memory.append`.

4. **Options page Debug card:** New card at the bottom (below Language) showing the most recent 20 runs, each with expandable event list. Refresh button rereads from `chrome.storage.local["omnipilotTraces"]`. Clear button empties them.

5. **Config gate:** New `observabilityEnabled` config (default `true`). When off, recorder is a no-op stub.

6. **Storage bounds:** 20 runs × 200 events × ~200 bytes ≈ 800 KB — well under `chrome.storage.local`'s 10 MB.

---

## Task 1: `observability.mjs` primitive

**Files:**
- Create: `src/background/agent/observability.mjs`
- Modify: `src/background/agent/constants.mjs`
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Failing tests**

Append to `tests/unit/background.test.js`:

```js
async function assertTraceRecorderCapturesEventsAndPersists() {
  const { context, stores } = await createBackgroundContext({ storage: {} });

  const rec = context.createTraceRecorder({ maxRuns: 5, maxEventsPerRun: 10 });
  const runId = rec.startRun('chat');
  assert.ok(runId, 'startRun returns an id');
  rec.event('provider.request', { round: 0 });
  rec.event('provider.response', { round: 0, toolCallCount: 0, textLen: 5 });
  await rec.endRun('ok');

  const snap = await rec.snapshot();
  assert.strictEqual(snap.length, 1);
  assert.strictEqual(snap[0].label, 'chat');
  assert.strictEqual(snap[0].status, 'ok');
  assert.strictEqual(snap[0].events.length, 2);
  assert.strictEqual(snap[0].events[0].type, 'provider.request');
  assert.strictEqual(snap[0].events[1].type, 'provider.response');

  // Persistence hit chrome.storage.local (not sync).
  assert.ok(stores.localStore.omnipilotTraces);
  assert.strictEqual(stores.syncStore.omnipilotTraces, undefined);
}

async function assertTraceRecorderRingBuffersRuns() {
  const { context } = await createBackgroundContext({ storage: {} });

  const rec = context.createTraceRecorder({ maxRuns: 3, maxEventsPerRun: 10 });
  for (let i = 0; i < 5; i += 1) {
    rec.startRun(`r${i}`);
    rec.event('provider.request', { round: 0 });
    await rec.endRun('ok');
  }

  const snap = await rec.snapshot();
  assert.strictEqual(snap.length, 3, 'maxRuns = 3');
  assert.strictEqual(snap[0].label, 'r2');
  assert.strictEqual(snap[2].label, 'r4');
}

async function assertTraceRecorderDropsOldestEventsBeyondCap() {
  const { context } = await createBackgroundContext({ storage: {} });

  const rec = context.createTraceRecorder({ maxRuns: 5, maxEventsPerRun: 3 });
  rec.startRun('bursty');
  for (let i = 0; i < 6; i += 1) rec.event('provider.request', { round: i });
  await rec.endRun('ok');

  const snap = await rec.snapshot();
  assert.strictEqual(snap[0].events.length, 3);
  assert.strictEqual(snap[0].events[0].data.round, 3, 'oldest events dropped');
  assert.strictEqual(snap[0].events[2].data.round, 5);
}

async function assertTraceRecorderSwallowsPersistFailures() {
  const { context } = await createBackgroundContext({ storage: {} });
  context.chrome.storage.local.set = () => { throw new Error('boom'); };

  const rec = context.createTraceRecorder({ maxRuns: 5, maxEventsPerRun: 10 });
  rec.startRun('chat');
  rec.event('provider.request', { round: 0 });
  await rec.endRun('ok'); // must not throw
}
```

Register in `main()`.

- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Add constants to `src/background/agent/constants.mjs`**:

```js
// Observability — trace ring buffer stored in chrome.storage.local.
const TRACES_KEY = 'omnipilotTraces';
const TRACES_MAX_RUNS = 20;
const TRACES_MAX_EVENTS_PER_RUN = 200;
```

- [ ] **Step 4: Create `src/background/agent/observability.mjs`**:

```js
// OmniPilot agent primitives — Observability (trace recorder).
//
// createTraceRecorder({ maxRuns, maxEventsPerRun }) returns a ring-
// buffered per-run event log persisted to chrome.storage.local under
// TRACES_KEY. Each run has { id, label, startedAt, endedAt, status,
// events: [{ ts, type, data }] }.
//
// Persistence is best-effort — failures are warned and swallowed.
//
// Concatenated into dist/background.js; do not add `export`s.

function createTraceRecorder({
  maxRuns = TRACES_MAX_RUNS,
  maxEventsPerRun = TRACES_MAX_EVENTS_PER_RUN
} = {}) {
  let current = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function newRunId() {
    return `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  function startRun(label) {
    current = {
      id: newRunId(),
      label: String(label || 'run'),
      startedAt: nowIso(),
      endedAt: null,
      status: 'in-progress',
      events: []
    };
    return current.id;
  }

  function event(type, data) {
    if (!current) return;
    current.events.push({ ts: nowIso(), type: String(type || 'unknown'), data: data || {} });
    while (current.events.length > maxEventsPerRun) current.events.shift();
  }

  async function persist(run) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return;
    try {
      const stored = await new Promise(resolve =>
        chrome.storage.local.get([TRACES_KEY], resolve));
      const runs = Array.isArray(stored[TRACES_KEY]) ? stored[TRACES_KEY] : [];
      runs.push(run);
      while (runs.length > maxRuns) runs.shift();
      await new Promise(resolve =>
        chrome.storage.local.set({ [TRACES_KEY]: runs }, resolve));
    } catch (error) {
      console.warn('OmniPilot: failed to persist trace', error?.message || error);
    }
  }

  async function endRun(status) {
    if (!current) return;
    current.endedAt = nowIso();
    current.status = String(status || 'ok');
    const finished = current;
    current = null;
    await persist(finished);
  }

  async function snapshot() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return [];
    try {
      const stored = await new Promise(resolve =>
        chrome.storage.local.get([TRACES_KEY], resolve));
      const runs = Array.isArray(stored[TRACES_KEY]) ? stored[TRACES_KEY] : [];
      return JSON.parse(JSON.stringify(runs));
    } catch {
      return [];
    }
  }

  async function clear() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return;
    try {
      await new Promise(resolve =>
        chrome.storage.local.set({ [TRACES_KEY]: [] }, resolve));
    } catch (error) {
      console.warn('OmniPilot: failed to clear traces', error?.message || error);
    }
  }

  return { startRun, event, endRun, snapshot, clear };
}

function createNoopTraceRecorder() {
  return {
    startRun: () => null,
    event: () => {},
    endRun: async () => {},
    snapshot: async () => [],
    clear: async () => {}
  };
}
```

- [ ] **Step 5: Verify PASS.**

- [ ] **Step 6: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/agent/constants.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/agent/observability.mjs src/background/agent/constants.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: add TraceRecorder primitive for per-run event logging

createTraceRecorder({ maxRuns, maxEventsPerRun }) records a
ring-buffered per-run event log persisted to chrome.storage.local
under omnipilotTraces. Each run is { id, label, startedAt, endedAt,
status, events }. Snapshot returns a deep-cloned array of runs for
UI consumption; clear() empties the ring.

Persistence and per-event pushing are best-effort — failures are
warned and swallowed so telemetry can't break a successful chat.
A no-op factory createNoopTraceRecorder() is available for when the
observabilityEnabled flag is off.
EOF
)"
```

---

## Task 2: Wire recorder into Agent + Runner + Guardrails

**Files:**
- Modify: `src/background/index.mjs`
- Modify: `src/background/agent/agent.mjs`
- Modify: `src/background/agent/runner.mjs`
- Modify: `src/background/agent/guardrails.mjs`
- Test: `tests/unit/background.test.js`

Add `observabilityEnabled: true` to `DEFAULT_CONFIG` and `STORAGE_KEYS`.

- [ ] **Step 1: Failing test**

```js
async function assertAgentRecordsEndToEndTraceForChat() {
  const { context, stores } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible',
      a2aAutoRoute: false,
      memoryEnabled: false,
      observabilityEnabled: true
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] })
    })
  });

  const agent = await context.createAgent();
  await agent.chat([{ role: 'user', content: 'hello' }]);

  const runs = stores.localStore.omnipilotTraces;
  assert.ok(Array.isArray(runs) && runs.length === 1);
  const run = runs[0];
  assert.strictEqual(run.label, 'chat');
  assert.strictEqual(run.status, 'ok');
  const types = run.events.map(e => e.type);
  assert.ok(types.includes('provider.request'), 'expected a provider.request event');
  assert.ok(types.includes('provider.response'), 'expected a provider.response event');
}

async function assertObservabilityDisabledLeavesNoTraces() {
  const { context, stores } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible',
      a2aAutoRoute: false,
      memoryEnabled: false,
      observabilityEnabled: false
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hi' } }] })
    })
  });

  const agent = await context.createAgent();
  await agent.chat([{ role: 'user', content: 'hello' }]);
  assert.strictEqual(stores.localStore.omnipilotTraces, undefined);
}
```

Register in `main()`.

- [ ] **Step 2: Verify FAIL.**

- [ ] **Step 3: Add config keys** to `src/background/index.mjs`:

```js
// DEFAULT_CONFIG: append
observabilityEnabled: true

// STORAGE_KEYS: append
'observabilityEnabled'
```

- [ ] **Step 4: Update `src/background/agent/agent.mjs`**

Add near the top of `createAgent`, after the memory setup:

```js
const recorder = config.observabilityEnabled === false ? createNoopTraceRecorder() : createTraceRecorder();
```

Wrap `chat` and `action` bodies with:

```js
async function chat(messages) {
  recorder.startRun('chat');
  try {
    // ... existing body ...
    await recorder.endRun('ok');
    return result;
  } catch (error) {
    recorder.event('error', { message: error?.message || String(error) });
    await recorder.endRun('error');
    throw error;
  }
}
```

Same wrap for `action` with label `action`. Also emit `context.built` after `assembleContext(...)`:

```js
recorder.event('context.built', {
  tokens: built.systemPrompt.length,
  dropped: built.dropped.map(d => d.name)
});
```

Pass `onEvent: (type, data) => recorder.event(type, data)` into `executeApiRequestWithA2aRouting(...)` and threaded through into `createRunner`.

- [ ] **Step 5: Update `executeApiRequestWithA2aRouting`** in `src/background/index.mjs` to accept `onEvent` in its parameter destructuring, forward it into `createRunner({ ..., onEvent })`, and pass into `guardrails.wrap(registry, onEvent)`.

- [ ] **Step 6: Update `src/background/agent/runner.mjs`**

Accept `onEvent = () => {}` in the destructured factory args. Emit:

```js
onEvent('provider.request', { requestUrl: built.requestUrl, apiShape, model: config.model, round });
// after response.json():
onEvent('provider.response', { round, toolCallCount: toolCalls.length, textLen: (built.parseContent(data) || '').length });
// per settled entry:
onEvent('tool.dispatch', { toolName: call.toolName, serverId: tool.meta.serverId });
onEvent('tool.result', { toolName: call.toolName, ok: !error, textLen: (text || '').length, error });
```

Wrap each onEvent call so a thrown observer can't break the loop:

```js
function safeEmit(type, data) { try { onEvent(type, data); } catch {} }
```

- [ ] **Step 7: Update `src/background/agent/guardrails.mjs`**

Change `wrap(registry)` to `wrap(registry, onEvent = () => {})`. On denial, before throwing:

```js
try { onEvent('guardrail.denied', { toolName: name, reason: verdict.reason }); } catch {}
```

Also change the plain path to emit `guardrail.allowed` after dispatch:

```js
try { onEvent('guardrail.allowed', { toolName: name, tier: verdict.tier }); } catch {}
```

- [ ] **Step 8: Verify PASS**

Run: `node build.mjs && npm run test:unit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/index.mjs','src/background/agent/agent.mjs','src/background/agent/runner.mjs','src/background/agent/guardrails.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/index.mjs src/background/agent/agent.mjs src/background/agent/runner.mjs src/background/agent/guardrails.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: end-to-end trace recording across Agent, Runner, and Guardrails

Agent wraps each chat/action call in startRun/endRun via createTraceRecorder
(or createNoopTraceRecorder when observabilityEnabled === false). Runner
emits provider.request/provider.response and per-call tool.dispatch/
tool.result events via an injected onEvent callback. Guardrails emits
guardrail.allowed/guardrail.denied. All emit paths are wrapped so an
observer that throws cannot break the loop.

Adds observabilityEnabled: true to DEFAULT_CONFIG and STORAGE_KEYS.
Traces persist to chrome.storage.local["omnipilotTraces"] (20-run ring,
200-event-per-run ring).
EOF
)"
```

---

## Task 3: Debug card on options page

**Files:**
- Modify: `src/options/index.html`
- Modify: `src/options/index.mjs`
- Modify: `src/utils/i18n.mjs`
- Test: `tests/unit/options.test.js`

- [ ] **Step 1: Add i18n keys** (English + Chinese):

- `debug: 'Debug'` / `'调试'`
- `debugRecentRuns: 'Recent runs'` / `'最近运行'`
- `debugRefresh: 'Refresh'` / `'刷新'`
- `debugClearTraces: 'Clear traces'` / `'清除轨迹'`
- `debugNoRuns: '(no runs recorded yet)'` / `'（尚无记录）'`

- [ ] **Step 2: Add Debug card** to `src/options/index.html`, at the very BOTTOM (after Language card):

```html
<div class="card">
  <div class="card-title" data-i18n="debug">Debug</div>
  <div class="field">
    <label data-i18n="debugRecentRuns">Recent runs</label>
    <pre id="debugTracesView" style="max-height:320px; overflow:auto; background:var(--card-bg, #111); color:var(--ink, #ddd); padding:8px; border-radius:6px; font-size:11px;"></pre>
  </div>
  <div class="field">
    <button id="refreshTraces" data-i18n="debugRefresh">Refresh</button>
    <button id="clearTraces" data-i18n="debugClearTraces">Clear traces</button>
  </div>
</div>
```

- [ ] **Step 3: Wire in `src/options/index.mjs`**:

Add `initDebugCard()`:

```js
async function initDebugCard() {
  const view = document.getElementById('debugTracesView');
  const refreshBtn = document.getElementById('refreshTraces');
  const clearBtn = document.getElementById('clearTraces');
  if (!view || !refreshBtn || !clearBtn) return;

  async function renderTraces() {
    const stored = await new Promise(resolve =>
      (chrome.storage.local || chrome.storage.sync).get(['omnipilotTraces'], resolve));
    const runs = Array.isArray(stored.omnipilotTraces) ? stored.omnipilotTraces : [];
    if (runs.length === 0) {
      view.textContent = t('debugNoRuns', currentLanguage());
      return;
    }
    const summary = runs.slice().reverse().map(run => {
      const events = run.events.map(e => `    ${e.ts.slice(11, 19)} ${e.type} ${JSON.stringify(e.data)}`).join('\n');
      return `[${run.label}] ${run.startedAt} → ${run.endedAt || '(running)'} status=${run.status}\n${events}`;
    }).join('\n\n');
    view.textContent = summary;
  }

  refreshBtn.addEventListener('click', renderTraces);
  clearBtn.addEventListener('click', async () => {
    await new Promise(resolve =>
      (chrome.storage.local || chrome.storage.sync).set({ omnipilotTraces: [] }, resolve));
    renderTraces();
  });

  renderTraces();
}
```

Wherever the options page defines `currentLanguage` (or fetches it from a state variable) — reuse that pattern. If nothing exists, hard-code `'en'` for phase 5.

Call `initDebugCard()` from the `DOMContentLoaded` handler.

- [ ] **Step 4: Options test** — smoke test that the Debug card IDs are present:

```js
async function assertOptionsDebugCardIsPresent() {
  const fs = require('fs');
  const html = fs.readFileSync('src/options/index.html', 'utf8');
  assert.ok(html.includes('id="debugTracesView"'));
  assert.ok(html.includes('id="refreshTraces"'));
  assert.ok(html.includes('id="clearTraces"'));
  assert.ok(html.includes('data-i18n="debug"'));
}
```

Register in the file's `main()`.

- [ ] **Step 5: Verify PASS** with `npm run test:unit`.

- [ ] **Step 6: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/options/index.html','src/options/index.mjs','src/utils/i18n.mjs','tests/unit/options.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/options/index.html src/options/index.mjs src/utils/i18n.mjs tests/unit/options.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: options page grows a Debug card showing recent runs

New card at the bottom renders the last 20 recorded traces from
chrome.storage.local['omnipilotTraces'] with one line per event.
Refresh re-reads storage; Clear empties it. New i18n keys for
English and Chinese; a smoke test locks the card's IDs into the
HTML so the wiring can't silently break.
EOF
)"
```

---

## Task 4: Docs + wrap phase 5 (and the whole 5-phase project)

**Files:**
- Modify: `README.md`

- [ ] Add `### Observability` subsection to the README architecture section (after Guardrails):

```markdown
### Observability

Every Agent chat/action call is wrapped in a run recorded by `src/background/agent/observability.mjs`. Provider requests/responses, tool dispatches and results, guardrail decisions, memory appends, and context-assembler drops all emit structured events into a ring-buffered per-run log persisted at `chrome.storage.local["omnipilotTraces"]` (20-run ring; 200 events per run). The options page has a Debug card that renders the last runs with a Refresh / Clear button pair. Set `observabilityEnabled: false` to disable via `chrome.storage.sync`.

---

Phase 5 completes the 5-phase harness build-out (agent primitives → memory → context assembly → guardrails → observability). The extension is now a proper harness in the sense defined by [harness-guide.com](https://harness-guide.com/guide/what-is-harness/): agentic loop, tool registry, memory/context/session split, guardrails, and per-run observability all present.
```

- [ ] `npm run test:unit` — expect PASS.
- [ ] Commit + push:

```bash
node -e "const fs=require('fs'); fs.writeFileSync('README.md', fs.readFileSync('README.md','utf8').replace(/\r\n/g,'\n'));"

git add README.md
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "docs: describe Observability and mark harness build-out complete"

git push origin main
```

---

## Self-Review

1. **Spec coverage.** ✓ Trace recorder with ring buffer; ✓ end-to-end event emission across Agent/Runner/Guardrails/ContextAssembler; ✓ Debug card; ✓ docs.
2. **Placeholder scan.** All code blocks complete.
3. **Type consistency.** `createTraceRecorder`, `createNoopTraceRecorder`, `startRun`, `event`, `endRun`, `snapshot`, `clear`, `TRACES_KEY`, `TRACES_MAX_RUNS`, `TRACES_MAX_EVENTS_PER_RUN`, `observabilityEnabled`, `onEvent`, `safeEmit` — all cross-consistent.

## Verification

- `npm run test:unit` after every task.
- Manual browser check: load `dist/`, send a chat, open Options → Debug card → click Refresh — should see the run's events. Clear should empty.
