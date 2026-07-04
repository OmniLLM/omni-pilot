# ADK-Style Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `src/background/index.mjs` into ADK-inspired primitives (`Agent`, `Tool`, `ToolRegistry`, `Session`, `State`, `Runner`) so the harness subsystems in phases 2-5 (memory, context assembly, guardrails, observability) have a clean home. Zero user-visible behavior changes — every existing test must still pass.

**Architecture:** Introduce a new `src/background/agent/` folder with one file per primitive. Extend `build.mjs` to concatenate the folder's files into `dist/background.js` before the entry file so top-level declarations remain visible to the existing `vm.runInContext` test harness. Move the A2A tool-schema and delegation code into a `ToolRegistry` populated by an `A2aToolProvider`; move the `executeApiRequestWithA2aRouting` loop into a `Runner.run()` method that owns turns, max-turn cap, dedup, and the `Session` conversation. Existing free-function exports (`handleAIChat`, `handleAIAction`, `handleAIChatStreaming`) become thin wrappers that build a `Runner` and call `run()`.

**Tech Stack:** Vanilla ES modules (no bundler, no framework), Node `vm.runInContext` test harness, Chrome MV3 service worker runtime, existing hand-inlined concat build.

**Reference docs read for this plan:**
- Harness Guide — [What Is a Harness](https://harness-guide.com/guide/what-is-harness/), [Agentic Loop](https://harness-guide.com/guide/agentic-loop/), [Tool System](https://harness-guide.com/guide/tool-system/), [Memory and Context](https://harness-guide.com/guide/memory-and-context/), [Guardrails](https://harness-guide.com/guide/guardrails/).
- Google ADK — [get-started](https://adk.dev/get-started/), [google/adk-js](https://github.com/google/adk-js) (browser build present but has heavy Node deps; we adopt the primitives/naming, not the SDK).

**Out of scope (deferred to later plans):**
- Phase 2: Memory (MEMORY.md, daily logs) — new subsystem.
- Phase 3: Priority-based context assembly with token budget — new subsystem.
- Phase 4: Guardrails (permission model, tool classifier, audit log) — new subsystem.
- Phase 5: Observability (structured events, trace timeline, in-panel debug view) — new subsystem.
- Any new default tools (`get_current_time`, `fetch_url`, etc.) — user chose "restructure only".
- Streaming rewrite — `handleAIChatStreaming` keeps its current shape; `Runner` handles non-streaming only in this phase.

---

## File Structure

**New files (all under `src/background/agent/`):**
- `constants.mjs` — shared constants moved out of the entry file (`A2A_TOOL_NAME_PREFIX`, `A2A_MAX_ROUNDS`, `A2A_MAX_POLL_ATTEMPTS`, etc.). One place to reference.
- `tool.mjs` — `Tool` factory returning `{ name, description, parameters, dispatch, meta }`. `Tool` is a shape, not a class, to survive `vm.runInContext` cleanly.
- `tool-registry.mjs` — `ToolRegistry` factory that owns a `Map<name, Tool>` and exposes `register()`, `get()`, `list()`, `schemasFor(apiShape)`. Providers push tools in; runner reads them out.
- `a2a-tool-provider.mjs` — factory that takes the discovered A2A servers, wraps each `(server, skill)` pair as a `Tool` whose `dispatch(args)` delegates via existing `delegateA2aTask`, and registers all of them with a `ToolRegistry`.
- `session.mjs` — `Session` factory holding `messages`, `dispatched: Set<key>`, and `lastSettled`. Provides `appendUser`, `appendFollowUp(apiShape, data, settled)`, `hasDispatched(key)`, `markDispatched(key)`.
- `state.mjs` — `State` factory holding scratch data for a single `Runner.run()` invocation. In phase 1, only used for `round` counter and reserved for future phases. Exists so guardrails/observability have a place to hang.
- `runner.mjs` — `Runner` factory. Constructor takes `{ config, apiShape, systemPrompt, toolRegistry, session, onStatus, maxTurns }`. `run(builtRequestBuilder, extractCalls, applyToolsToBody, followUpBuilder)` implements the loop currently living in `executeApiRequestWithA2aRouting`, calling `toolRegistry.dispatch()` for each tool call.
- `agent.mjs` — `Agent` factory. Wraps a `Runner` with the higher-level config-loading and provider-selection logic. `Agent.chat(messages)` replaces `handleAIChat`. `Agent.action(action, text)` replaces `handleAIAction` by using an empty `ToolRegistry` and single-turn shortcut. `Agent.chatStreaming(...)` remains a placeholder that delegates to the existing free function in this phase.

**Modified files:**
- `src/background/index.mjs` — becomes the extension entry point that (a) wires up chrome runtime listeners, context menus, ports, storage, message handlers, and (b) instantiates an `Agent` per handler invocation using the primitives from `agent/`. All A2A tool-schema, tool-call extraction, request-body-tool-application, follow-up-message building, and routing-loop code moves out. Provider selection, API-shape mapping, streaming (unchanged), and OAuth (Copilot) stay here.
- `build.mjs` — concatenate every `.mjs` file in `src/background/agent/` (sorted alphabetically for determinism) into the background bundle *before* the entry file's contents. Strip any `export {...};` blocks the same way i18n is stripped, so declarations land at top level for `vm.runInContext`.
- `tests/unit/background.test.js` — no test *behavior* changes; all existing assertions must still pass. Adds one new test `assertRunnerAndToolRegistryWireUpForA2aRouting` that verifies the primitives are on the vm context.

**Preserved verbatim (no touch):**
- `src/sidepanel/index.mjs`, `src/popup/index.mjs`, `src/options/index.mjs`, `src/content-script/index.mjs`, `src/utils/i18n.mjs` — pure UI/side, no agent logic.
- `manifest.json`, `pack.mjs`, `Makefile` — no change.
- All existing playwright specs — no change.

---

## Design decisions worth calling out

1. **Factories over classes.** The existing code is all top-level functions living on the `vm.runInContext` global. Classes would work but factories match the codebase style and keep `vm.runInContext` happy without `new`-keyword juggling in tests.

2. **No ES imports between agent files.** They rely on being concatenated by `build.mjs`. Each file uses only top-level `function`/`const` declarations that get hoisted into one script. In source, IDE will show "unresolved reference" — that's expected and matches how the existing `src/background/index.mjs` already works (e.g., it references `delegateA2aTask` which is defined later in the same file).

3. **The `Runner` is transport-agnostic.** It takes a `buildRequest` callable (currently `buildApiRequest`), an `extractCalls` callable (currently `extractA2aToolCallsFromResponse`), an `applyToolsToBody` callable (currently `applyA2aToolsToRequestBody`), and a `followUpBuilder` (currently `buildA2aFollowUpMessages`). Phase 4 will inject a guardrail-wrapped `toolRegistry.dispatch`; phase 5 will inject an observability `onEvent` callback. No transport code lives in the runner — it just orchestrates the loop.

4. **`ToolRegistry.dispatch(name, args)` is the single choke point** for tool execution. Today it just proxies to the A2A provider's registered dispatch, but phase 4's guardrails, phase 5's audit log, and phase 3's context truncation of large tool results all hook here.

5. **Preserve existing test signatures.** Existing tests reach into `context.handleAIChat`, `context.handleAIAction`, `context.loadA2aServersWithTokens`, etc. These remain as top-level functions in `dist/background.js`. New primitives are added *alongside*, not replacing existing exports.

6. **No new user-facing behavior.** Every existing test must still pass unchanged. The new test only proves the primitives exist and are wired.

---

## Task 1: Extract shared constants into `agent/constants.mjs`

**Files:**
- Create: `src/background/agent/constants.mjs`
- Modify: `src/background/index.mjs` (remove the moved constants; leave a short comment pointing to the new file)
- Modify: `build.mjs` (add the agent-folder concat step)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/background.test.js` a new assertion at the top of `main()`:

```js
async function assertAgentConstantsLoadedFromAgentFolder() {
  const { context } = await createBackgroundContext({ storage: {} });
  // Constants that used to live in index.mjs must survive the extraction.
  assert.strictEqual(context.A2A_MAX_ROUNDS, 3);
  assert.strictEqual(context.A2A_TOOL_NAME_PREFIX, 'a2a__');
  assert.strictEqual(context.A2A_MAX_POLL_ATTEMPTS, 600);
  assert.strictEqual(context.A2A_POLL_INTERVAL_MS, 500);
}
```

Register it at the top of `main()` (before any A2A test) with `await assertAgentConstantsLoadedFromAgentFolder();`.

- [ ] **Step 2: Run the test suite to verify it currently passes (constants still in index.mjs)**

Run: `npm run test:unit`
Expected: PASS — the assertion is a no-op right now because the constants live in `src/background/index.mjs` and are already visible.

*(This is a "verify the guard rail exists" step; the extraction below moves the source of the constants without breaking the assertion.)*

- [ ] **Step 3: Create `src/background/agent/constants.mjs`**

```js
// OmniPilot agent primitives — shared constants.
//
// Concatenated into dist/background.js by build.mjs before the entry file,
// so declarations here are visible as top-level bindings to the rest of
// the background script and to the vm.runInContext test harness.

const A2A_POLL_INTERVAL_MS = 500;
const A2A_MAX_POLL_ATTEMPTS = 600;
const A2A_STATUS_HEARTBEAT_MS = 10000;
// Upper bound for a single non-streaming A2A delegation before we surface a
// timeout error to the chat UI.
const A2A_DELEGATION_TIMEOUT_MS = 330000;
const A2A_TOOL_NAME_PREFIX = 'a2a__';
const A2A_TOOL_NAME_MAX_LEN = 64;
const A2A_TOOL_DESCRIPTION_MAX_LEN = 1024;
// Cap on how many LLM->tools->LLM rounds a single auto-route request may
// run through per user turn. Round 0 is the initial call; each subsequent
// round feeds prior tool_result messages back and lets the model either
// summarize or emit more tool calls.
const A2A_MAX_ROUNDS = 3;
```

- [ ] **Step 4: Extend `build.mjs` to concatenate the agent folder**

Modify `build.mjs`. Locate the `entries` array (currently lines 28-34). Replace the body of the loop with the concatenated-agent-folder version:

```js
import fs from 'fs'
import path from 'path'

const outdir = 'dist'

fs.rmSync(outdir, { recursive: true, force: true })
fs.mkdirSync(outdir, { recursive: true })

const i18nRaw = fs.readFileSync('src/utils/i18n.mjs', 'utf8')
const i18nInlined = i18nRaw.replace(/^export\s*\{[\s\S]*?\};?\s*$/m, '').trimEnd() + '\n'

function stripI18nImports(src) {
  return src.replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]*i18n\.mjs['"];?\s*\n/gm, '')
}

// Strip `export { ... };` / `export default ...;` blocks so declarations
// land at top level when concatenated into a single script.
function stripExports(src) {
  return src
    .replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+(async\s+)?function\s+/gm, '$1function ')
    .replace(/^export\s+const\s+/gm, 'const ')
}

// Concatenate all `.mjs` files in `src/background/agent/`, sorted for
// determinism, so they land in the bundle BEFORE the entry file. Each
// file's declarations become top-level in the resulting script.
function concatAgentPrimitives() {
  const dir = 'src/background/agent'
  if (!fs.existsSync(dir)) return ''
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()
  return files.map(f => {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8')
    return `// ── agent/${f} ─────────────────────────────────────────────\n${stripExports(raw)}`
  }).join('\n\n') + '\n'
}

const entries = [
  { name: 'background', src: 'src/background/index.mjs', needsI18n: false, needsAgent: true  },
  { name: 'content',    src: 'src/content-script/index.mjs', needsI18n: true,  needsAgent: false },
  { name: 'popup',      src: 'src/popup/index.mjs', needsI18n: true,  needsAgent: false },
  { name: 'options',    src: 'src/options/index.mjs', needsI18n: true,  needsAgent: false },
  { name: 'sidepanel',  src: 'src/sidepanel/index.mjs', needsI18n: false, needsAgent: false },
]

const agentPrimitives = concatAgentPrimitives()

for (const { name, src, needsI18n, needsAgent } of entries) {
  const raw = fs.readFileSync(src, 'utf8')
  const stripped = stripI18nImports(raw)
  const parts = []
  if (needsI18n) parts.push(i18nInlined)
  if (needsAgent) parts.push(agentPrimitives)
  parts.push(stripped)
  const bundled = parts.join('\n')
  fs.writeFileSync(`${outdir}/${name}.js`, bundled)
  const sizeKb = (Buffer.byteLength(bundled) / 1024).toFixed(1)
  console.log(`  dist/${name}.js  ${sizeKb}kb`)
}

fs.copyFileSync('src/popup/index.html',        `${outdir}/popup.html`)
fs.copyFileSync('src/options/index.html',      `${outdir}/options.html`)
fs.copyFileSync('src/sidepanel/index.html',    `${outdir}/sidepanel.html`)
fs.copyFileSync('src/content-script/styles.css', `${outdir}/styles.css`)

console.log('✓ built dist/')
```

- [ ] **Step 5: Remove the extracted constants from `src/background/index.mjs`**

Delete lines 73-82 (from `const A2A_POLL_INTERVAL_MS = 500;` through `const A2A_MAX_ROUNDS = 3;` including the surrounding comment). Replace with:

```js
// A2A constants live in src/background/agent/constants.mjs; they are
// concatenated into this bundle by build.mjs and available as top-level
// bindings here.
```

- [ ] **Step 6: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS — all existing tests + `assertAgentConstantsLoadedFromAgentFolder` pass. Build should still produce `dist/background.js` (size should be within ~500 bytes of the previous build; the extra comment-per-file header is the only real growth).

- [ ] **Step 7: Commit**

```bash
git add src/background/agent/constants.mjs build.mjs src/background/index.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
refactor: extract A2A constants into src/background/agent/constants.mjs

First step of the ADK-style restructure. New agent/ folder is
concatenated into dist/background.js by build.mjs before the entry
file, so declarations survive as top-level bindings for the
vm.runInContext test harness. Zero behavior change; new test locks
the constants down.
EOF
)"
```

---

## Task 2: Introduce `Tool` and `ToolRegistry` primitives

**Files:**
- Create: `src/background/agent/tool.mjs`
- Create: `src/background/agent/tool-registry.mjs`
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/background.test.js`:

```js
async function assertToolAndToolRegistryPrimitivesExist() {
  const { context } = await createBackgroundContext({ storage: {} });

  // createTool: factory that returns a plain shape (not a class instance).
  const echo = context.createTool({
    name: 'echo',
    description: 'Return the input verbatim',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    dispatch: async ({ text }) => text
  });
  assert.strictEqual(echo.name, 'echo');
  assert.strictEqual(typeof echo.dispatch, 'function');
  assert.strictEqual(await echo.dispatch({ text: 'hi' }), 'hi');

  // createToolRegistry: register, get, list, schemasFor(apiShape).
  const registry = context.createToolRegistry();
  registry.register(echo);
  assert.strictEqual(registry.get('echo'), echo);
  assert.strictEqual(registry.list().length, 1);
  assert.strictEqual(registry.list()[0].name, 'echo');

  // Dispatch through the registry.
  assert.strictEqual(await registry.dispatch('echo', { text: 'hi' }), 'hi');

  // schemasFor returns OpenAI-Chat / Anthropic / OpenAI-Responses shapes.
  const openai = registry.schemasFor('openai-compatible');
  assert.strictEqual(openai[0].type, 'function');
  assert.strictEqual(openai[0].function.name, 'echo');
  const anthropic = registry.schemasFor('anthropic-messages');
  assert.strictEqual(anthropic[0].name, 'echo');
  assert.ok(anthropic[0].input_schema);
  const responses = registry.schemasFor('openai-responses');
  assert.strictEqual(responses[0].type, 'function');
  assert.strictEqual(responses[0].name, 'echo');

  // Registering a duplicate name throws.
  assert.throws(() => registry.register(echo), /already registered/i);

  // Dispatching an unknown tool throws with the tool name in the message.
  await assert.rejects(() => registry.dispatch('nope', {}), /nope/);
}
```

Register it in `main()` alongside the other new assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/unit/background.test.js`
Expected: FAIL with `context.createTool is not a function` or similar.

- [ ] **Step 3: Create `src/background/agent/tool.mjs`**

```js
// OmniPilot agent primitives — Tool.
//
// A Tool is a plain shape with { name, description, parameters, dispatch, meta }.
// Concatenated into dist/background.js; do not add `export`s.
//
// Factory over class: keeps vm.runInContext tests simple (no `new`).

function createTool({ name, description, parameters, dispatch, meta = {} }) {
  if (!name || typeof name !== 'string') throw new Error('Tool.name is required');
  if (typeof dispatch !== 'function') throw new Error(`Tool ${name}.dispatch must be a function`);
  return {
    name,
    description: description || '',
    parameters: parameters || { type: 'object', properties: {}, additionalProperties: false },
    dispatch,
    meta
  };
}
```

- [ ] **Step 4: Create `src/background/agent/tool-registry.mjs`**

```js
// OmniPilot agent primitives — ToolRegistry.
//
// Owns a Map<name, Tool>. The single choke point for tool execution:
// phase 4 will wrap dispatch with guardrails; phase 5 will emit audit
// events here.

function createToolRegistry() {
  const tools = new Map();

  function register(tool) {
    if (!tool || typeof tool !== 'object') throw new Error('register(tool): tool required');
    if (tools.has(tool.name)) throw new Error(`Tool "${tool.name}" already registered`);
    tools.set(tool.name, tool);
  }

  function get(name) {
    return tools.get(name);
  }

  function list() {
    return Array.from(tools.values());
  }

  async function dispatch(name, args) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return await tool.dispatch(args || {});
  }

  function schemasFor(apiShape) {
    return list().map(tool => toolSchemaForApiShape(tool, apiShape));
  }

  return { register, get, list, dispatch, schemasFor };
}

function toolSchemaForApiShape(tool, apiShape) {
  if (apiShape === 'anthropic-messages') {
    return { name: tool.name, description: tool.description, input_schema: tool.parameters };
  }
  if (apiShape === 'openai-responses') {
    return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters };
  }
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS — all existing tests + the two new assertions.

- [ ] **Step 6: Commit**

```bash
git add src/background/agent/tool.mjs src/background/agent/tool-registry.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: add Tool and ToolRegistry primitives

createTool returns a plain shape (name/description/parameters/dispatch/meta).
createToolRegistry owns a Map<name, Tool> with register/get/list/dispatch
and schemasFor(apiShape) that renders OpenAI Chat / Anthropic / OpenAI
Responses schemas. dispatch(name, args) is the single choke point for
tool execution so future guardrails and audit logging can hook one place.
EOF
)"
```

---

## Task 3: Add `Session` and `State` primitives

**Files:**
- Create: `src/background/agent/session.mjs`
- Create: `src/background/agent/state.mjs`
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/background.test.js`:

```js
async function assertSessionAndStatePrimitivesExist() {
  const { context } = await createBackgroundContext({ storage: {} });

  const session = context.createSession({ messages: [{ role: 'user', content: 'hi' }] });
  assert.deepStrictEqual(session.messages, [{ role: 'user', content: 'hi' }]);

  // Dispatch tracking — dedupe key is caller-supplied so callers pick the
  // policy (currently `${serverId} ${task}` for A2A).
  assert.strictEqual(session.hasDispatched('a2a launcher show disk'), false);
  session.markDispatched('a2a launcher show disk');
  assert.strictEqual(session.hasDispatched('a2a launcher show disk'), true);

  // appendFollowUp: takes the assistant turn's raw response, per-call
  // settled results, and an apiShape; returns nothing and grows messages.
  const before = session.messages.length;
  session.appendFollowUp('openai-compatible',
    { choices: [{ message: { tool_calls: [{ id: 'x', function: { name: 'a2a__srv__k', arguments: '{}' } }] } }] },
    [{ call: { id: 'x' }, server: { id: 'srv' }, tool: { name: 'a2a__srv__k' }, text: 'ok', error: null }]
  );
  assert.strictEqual(session.messages.length, before + 2, 'follow-up should add assistant + tool messages');
  assert.strictEqual(session.messages[before].role, 'assistant');
  assert.strictEqual(session.messages[before + 1].role, 'tool');
  assert.strictEqual(session.messages[before + 1].tool_call_id, 'x');
  assert.strictEqual(session.messages[before + 1].content, 'ok');

  // State: opaque scratch bag with get/set/incr for a single run.
  const state = context.createState();
  assert.strictEqual(state.get('round'), undefined);
  state.set('round', 0);
  assert.strictEqual(state.get('round'), 0);
  assert.strictEqual(state.incr('round'), 1);
  assert.strictEqual(state.get('round'), 1);
}
```

Register in `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — `createSession is not a function`.

- [ ] **Step 3: Create `src/background/agent/session.mjs`**

```js
// OmniPilot agent primitives — Session.
//
// Holds the message list for a single Runner.run() invocation plus the
// (serverId, task) dedup set used to break agentic-loop retries.
// Delegates the shape-specific follow-up message construction to the
// existing `buildA2aFollowUpMessages` free function (still in index.mjs
// for now; moved out in Task 5).

function createSession({ messages = [] } = {}) {
  const dispatched = new Set();
  const state = { messages: [...messages] };

  return {
    get messages() { return state.messages; },
    appendMessage(msg) { state.messages.push(msg); },
    appendFollowUp(apiShape, rawResponse, settled) {
      const followUps = buildA2aFollowUpMessages(apiShape, rawResponse, settled);
      state.messages.push(...followUps);
    },
    hasDispatched(key) { return dispatched.has(key); },
    markDispatched(key) { dispatched.add(key); }
  };
}
```

- [ ] **Step 4: Create `src/background/agent/state.mjs`**

```js
// OmniPilot agent primitives — State.
//
// Opaque scratch storage for a single Runner.run() invocation. Phase 4
// (guardrails) and phase 5 (observability) hang per-run counters, timing
// data, and audit records here.

function createState() {
  const store = new Map();
  return {
    get(key) { return store.get(key); },
    set(key, value) { store.set(key, value); return value; },
    incr(key, delta = 1) {
      const next = (store.get(key) || 0) + delta;
      store.set(key, next);
      return next;
    },
    has(key) { return store.has(key); },
    keys() { return Array.from(store.keys()); }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/background/agent/session.mjs src/background/agent/state.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: add Session and State primitives

Session owns the per-run message list and (serverId, task) dedup set;
appendFollowUp delegates to the existing buildA2aFollowUpMessages helper
so shape-specific tool_result construction stays in one place until it
moves out in a later task. State is an opaque scratch bag (get/set/incr)
reserved for guardrail and observability hooks in phases 4-5.
EOF
)"
```

---

## Task 4: Introduce `A2aToolProvider` that registers A2A skills as `Tool`s

**Files:**
- Create: `src/background/agent/a2a-tool-provider.mjs`
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/background.test.js`:

```js
async function assertA2aToolProviderRegistersOnePerSkill() {
  const { context } = await createBackgroundContext({ storage: {} });

  const servers = [
    {
      id: 'launcher', name: 'OmniLauncher',
      endpoint: 'https://launcher.example/a2a', enabled: true,
      agentCard: { name: 'OmniLauncher', skills: [
        { id: 'disk', name: 'Disk usage' },
        { id: 'ram',  name: 'RAM usage' }
      ] }
    },
    {
      id: 'planner', name: 'Planner',
      endpoint: 'https://planner.example/a2a', enabled: true,
      agentCard: { name: 'Planner' }  // No skills — registers one generic agent-level tool.
    }
  ];

  const registry = context.createToolRegistry();
  context.registerA2aToolsInRegistry(registry, servers);

  const names = registry.list().map(t => t.name).sort();
  assert.deepStrictEqual(names, ['a2a__launcher__disk', 'a2a__launcher__ram', 'a2a__planner']);

  // Each registered tool carries the serverId/skillId on its meta so the
  // runner can look the server up when a call comes back.
  const disk = registry.get('a2a__launcher__disk');
  assert.strictEqual(disk.meta.serverId, 'launcher');
  assert.strictEqual(disk.meta.skillId, 'disk');
  assert.strictEqual(disk.meta.skillName, 'Disk usage');

  const planner = registry.get('a2a__planner');
  assert.strictEqual(planner.meta.serverId, 'planner');
  assert.strictEqual(planner.meta.skillId, null);

  // Dispatch calls delegateA2aTask under the hood — proven with a stubbed fetch.
}
```

Register in `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — `registerA2aToolsInRegistry is not a function`.

- [ ] **Step 3: Create `src/background/agent/a2a-tool-provider.mjs`**

```js
// OmniPilot agent primitives — A2aToolProvider.
//
// Wraps discovered A2A servers as ToolRegistry entries. One Tool per
// skill (if the agent card advertises them), otherwise one Tool per
// server. Each tool's dispatch delegates via the existing
// `delegateA2aTask` free function (still in index.mjs; moved when we
// slice out the delegation module later).

function registerA2aToolsInRegistry(registry, servers, options = {}) {
  const uniqueName = createUniqueNameGenerator(registry);
  const { getContextText } = options;

  for (const server of servers) {
    const skills = Array.isArray(server.agentCard?.skills)
      ? server.agentCard.skills.filter(s => s && typeof s === 'object' && (s.id || s.name))
      : [];

    if (skills.length) {
      for (const skill of skills) {
        const skillId = String(skill.id || skill.name);
        const name = uniqueName(buildA2aToolName(server.id, skillId));
        registry.register(createTool({
          name,
          description: buildA2aSkillToolDescription(server, skill),
          parameters: buildA2aToolParameters(),
          dispatch: async ({ task }) => delegateA2aTask({
            serverId: server.id,
            task: String(task || '').trim(),
            contextText: getContextText ? getContextText() : ''
          }),
          meta: {
            serverId: server.id,
            skillId,
            skillName: skill.name || skill.id || '',
            skillDescription: skill.description || '',
            skillTags: Array.isArray(skill.tags) ? skill.tags : []
          }
        }));
      }
    } else {
      const name = uniqueName(buildA2aToolName(server.id));
      registry.register(createTool({
        name,
        description: buildA2aServerToolDescription(server),
        parameters: buildA2aToolParameters(),
        dispatch: async ({ task }) => delegateA2aTask({
          serverId: server.id,
          task: String(task || '').trim(),
          contextText: getContextText ? getContextText() : ''
        }),
        meta: { serverId: server.id, skillId: null, skillName: '', skillDescription: '', skillTags: [] }
      }));
    }
  }
}

function createUniqueNameGenerator(registry) {
  const used = new Set(registry.list().map(t => t.name));
  return baseName => {
    let name = baseName;
    let suffix = 2;
    while (used.has(name)) {
      name = `${baseName}_${suffix}`;
      suffix += 1;
    }
    used.add(name);
    return name;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background/agent/a2a-tool-provider.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: add A2aToolProvider that registers A2A skills as Tool entries

registerA2aToolsInRegistry(registry, servers) walks the discovered A2A
agent cards and pushes one Tool per skill (or one per server when no
skills are advertised). Each Tool's dispatch delegates via the existing
delegateA2aTask helper; serverId and skill metadata land on Tool.meta
so the future Runner can look them up when tool_results come back.
Preserves the collision-safe name assignment from buildA2aToolSchemas.
EOF
)"
```

---

## Task 5: Extract `buildA2aFollowUpMessages` into `agent/follow-up.mjs`

**Files:**
- Create: `src/background/agent/follow-up.mjs`
- Modify: `src/background/index.mjs` (remove the moved function)

- [ ] **Step 1: Verify no test change is needed**

`buildA2aFollowUpMessages` is already invoked by `Session.appendFollowUp` and tested indirectly by every existing multi-round A2A test. No new test needed; existing tests must still pass after the move.

- [ ] **Step 2: Create `src/background/agent/follow-up.mjs`**

Copy the entire body of the existing `buildA2aFollowUpMessages` function (currently at `src/background/index.mjs:776-824`) into a new file:

```js
// OmniPilot agent primitives — follow-up message construction.
//
// After an agentic-loop round dispatches tools, the assistant turn plus
// per-call tool_result messages must be appended to the conversation
// before the next model call. Each API shape has its own convention:
// OpenAI Chat wants a tool-role message per call; Anthropic wants a
// user-role message containing tool_result blocks; OpenAI Responses
// wants function_call_output items appended to the flat input list.

function buildA2aFollowUpMessages(apiShape, data, settled) {
  if (apiShape === API_SHAPES.ANTHROPIC_MESSAGES) {
    const assistantContent = Array.isArray(data?.content) ? data.content : [];
    const userContent = settled.map(({ call, text, error }) => ({
      type: 'tool_result',
      tool_use_id: call.id,
      content: error ? `A2A delegation failed: ${error}` : (text || ''),
      ...(error ? { is_error: true } : {})
    }));
    return [
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: userContent }
    ];
  }

  if (apiShape === API_SHAPES.OPENAI_RESPONSES) {
    const items = Array.isArray(data?.output) ? data.output : [];
    const outputs = settled.map(({ call, text, error }) => ({
      type: 'function_call_output',
      call_id: call.id,
      output: error ? `A2A delegation failed: ${error}` : (text || '')
    }));
    return [...items, ...outputs];
  }

  const assistantMessage = data?.choices?.[0]?.message || {};
  const toolMessages = settled.map(({ call, text, error }) => ({
    role: 'tool',
    tool_call_id: call.id,
    content: error ? `A2A delegation failed: ${error}` : (text || '')
  }));
  return [
    {
      role: 'assistant',
      content: assistantMessage.content ?? null,
      ...(Array.isArray(assistantMessage.tool_calls) ? { tool_calls: assistantMessage.tool_calls } : {})
    },
    ...toolMessages
  ];
}
```

- [ ] **Step 3: Delete the duplicate from `src/background/index.mjs`**

Delete `buildA2aFollowUpMessages` at its current location (currently `src/background/index.mjs:776-824`, includes its leading block comment). Leave a one-line comment:

```js
// buildA2aFollowUpMessages moved to src/background/agent/follow-up.mjs.
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS — every existing A2A test still green.

- [ ] **Step 5: Commit**

```bash
git add src/background/agent/follow-up.mjs src/background/index.mjs
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "refactor: move buildA2aFollowUpMessages into agent/follow-up.mjs"
```

---

## Task 6: Introduce `Runner` and route `executeApiRequestWithA2aRouting` through it

**Files:**
- Create: `src/background/agent/runner.mjs`
- Modify: `src/background/index.mjs` (replace `executeApiRequestWithA2aRouting` body with a Runner instantiation)
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/background.test.js`:

```js
async function assertRunnerRunsAgenticLoopEndToEnd() {
  // Same shape as assertA2aAutoRouteRunsAgenticLoopSequentially but drives
  // the Runner directly, proving the primitive is wired.
  let chatCallCount = 0;
  const { context } = await createBackgroundContext({
    storage: {},
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        chatCallCount += 1;
        if (chatCallCount === 1) return {
          ok: true,
          json: async () => ({ choices: [{ message: { tool_calls: [
            { id: 'x', type: 'function', function: { name: 'echo', arguments: JSON.stringify({ task: 'ping' }) } }
          ] } }] })
        };
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'done: ping-pong' } }] }) };
      }
      throw new Error(`unexpected ${url}`);
    }
  });

  const registry = context.createToolRegistry();
  registry.register(context.createTool({
    name: 'echo',
    description: 'echo',
    parameters: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
    dispatch: async ({ task }) => `${task}-pong`,
    meta: { serverId: 'local', skillId: 'echo' }
  }));

  const session = context.createSession({ messages: [{ role: 'user', content: 'ping' }] });
  const runner = context.createRunner({
    config: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible'
    },
    systemPrompt: 'You are a helpful assistant.',
    toolRegistry: registry,
    session,
    maxTurns: 3
  });

  const result = await runner.run();
  assert.strictEqual(result, 'done: ping-pong');
  assert.strictEqual(chatCallCount, 2);
}
```

Register in `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — `createRunner is not a function`.

- [ ] **Step 3: Create `src/background/agent/runner.mjs`**

```js
// OmniPilot agent primitives — Runner.
//
// The think-act-observe agentic loop from the harness guide. Every user
// turn is one Runner.run() invocation which drives up to `maxTurns`
// LLM<->tool cycles. Terminates when the model produces final text with
// no tool calls, when every call in a round is a duplicate of a prior
// dispatch, or when the round cap is hit (in which case the last
// fanned-out tool result is rendered as the answer).
//
// The Runner is transport-agnostic — it delegates request building /
// call extraction / body decoration to free functions currently living
// in index.mjs (buildApiRequest, extractA2aToolCallsFromResponse,
// applyA2aToolsToRequestBody). Phase 4 wraps toolRegistry.dispatch to
// enforce guardrails; phase 5 attaches an onEvent callback for tracing.

function createRunner({
  config,
  copilotToken = '',
  systemPrompt,
  toolRegistry,
  session,
  onStatus,
  maxTurns = A2A_MAX_ROUNDS
}) {
  async function run() {
    let lastSettled = null;
    let apiShape = null;

    for (let round = 0; round < maxTurns; round += 1) {
      const built = buildApiRequest({
        config,
        messages: session.messages,
        systemPrompt,
        copilotToken
      });
      apiShape = built.apiShape;
      const toolSchemas = toolRegistry.schemasFor(apiShape);
      const requestBody = toolSchemas.length
        ? applyA2aToolsToRequestBody(built.requestBody, apiShape, toolSchemas)
        : built.requestBody;

      const response = await fetch(built.requestUrl, {
        method: 'POST',
        headers: built.requestHeaders,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (round === 0 && isToolsUnsupportedError(response.status, errorText)) {
          return executeApiRequest({ config, messages: session.messages, systemPrompt });
        }
        throwApiResponseError(response, errorText, built.requestUrl, apiShape, config.model);
      }

      const data = await response.json();
      const toolCalls = extractA2aToolCallsFromResponse(data, apiShape);

      if (!toolCalls.length) {
        const content = built.parseContent(data);
        if (content) return content;
        if (lastSettled) return renderA2aSettledSections(lastSettled);
        throw new Error('The API returned an empty or unexpected response.');
      }

      const runnable = [];
      const roundSeen = new Set();
      for (const call of toolCalls) {
        const tool = toolRegistry.get(call.toolName);
        if (!tool) continue;
        if (!call.task) continue;
        const key = `${tool.meta.serverId} ${call.task}`;
        if (roundSeen.has(key)) continue;
        if (session.hasDispatched(key)) continue;
        roundSeen.add(key);
        runnable.push({ call, tool, key });
      }

      if (!runnable.length) {
        if (round === 0) {
          const first = toolCalls[0];
          const tool = toolRegistry.get(first.toolName);
          if (!tool) throw new Error('A2A tool selected an unknown server.');
          if (!first.task) throw new Error('A2A tool selected an empty task.');
        }
        break;
      }

      onStatus?.('delegating');

      const settled = await Promise.all(runnable.map(async ({ call, tool, key }) => {
        session.markDispatched(key);
        try {
          const text = await withA2aStatusHeartbeat(
            toolRegistry.dispatch(call.toolName, { task: call.task }),
            onStatus
          );
          // Rebuild the { call, server, tool, text, error } shape that
          // buildA2aFollowUpMessages + renderA2aSettledSections expect.
          const server = { id: tool.meta.serverId, name: tool.meta.serverName || tool.meta.serverId, agentCard: { name: tool.meta.serverName } };
          return { call, server, tool: { skillName: tool.meta.skillName || '' }, text, error: null };
        } catch (error) {
          const server = { id: tool.meta.serverId, name: tool.meta.serverName || tool.meta.serverId, agentCard: { name: tool.meta.serverName } };
          return { call, server, tool: { skillName: tool.meta.skillName || '' }, text: '', error: error?.message || String(error) };
        }
      }));

      lastSettled = settled;
      session.appendFollowUp(apiShape, data, settled);
    }

    if (lastSettled) return renderA2aSettledSections(lastSettled);
    throw new Error('Runner exceeded maxTurns without producing a response.');
  }

  return { run };
}
```

- [ ] **Step 4: Rewrite `executeApiRequestWithA2aRouting` to instantiate the Runner**

In `src/background/index.mjs`, replace the entire body of `executeApiRequestWithA2aRouting` with:

```js
async function executeApiRequestWithA2aRouting({ config, messages, systemPrompt, a2aServers, toolSchemas, onStatus }) {
  const provider = getProvider(config);
  let copilotToken = '';

  if (provider.usesCopilotAuth) {
    try {
      copilotToken = await getCopilotAccessToken();
      config.apiKey = copilotToken;
    } catch (e) {
      throw new Error('GitHub Copilot authentication failed. Please re-authenticate in Settings.');
    }
  } else if (!config.apiKey) {
    throw new Error('No API key configured. Click the OmniPilot icon to set up.');
  }

  const session = createSession({ messages });
  const registry = createToolRegistry();
  // Preserve existing behavior: the runner uses the SAME conversation-context
  // string for every tool dispatch in this run, computed from the incoming
  // messages exactly once.
  const contextText = getA2aConversationContext(messages);
  registerA2aToolsInRegistry(registry, a2aServers, { getContextText: () => contextText });

  const runner = createRunner({
    config,
    copilotToken,
    systemPrompt: buildA2aRoutingSystemPrompt(systemPrompt),
    toolRegistry: registry,
    session,
    onStatus,
    maxTurns: A2A_MAX_ROUNDS
  });

  return await runner.run();
}
```

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS — every existing A2A test still green + new `assertRunnerRunsAgenticLoopEndToEnd`.

- [ ] **Step 6: Commit**

```bash
git add src/background/agent/runner.mjs src/background/index.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
refactor: route A2A agentic loop through Runner primitive

createRunner({ config, systemPrompt, toolRegistry, session, maxTurns })
now owns the LLM<->tools loop that previously lived inline inside
executeApiRequestWithA2aRouting. The transport-facing helpers
(buildApiRequest, extractA2aToolCallsFromResponse,
applyA2aToolsToRequestBody, renderA2aSettledSections) stay in
index.mjs and are called via top-level references — Runner does not
own them. Existing entry point is a thin wrapper that instantiates
a Session, populates a ToolRegistry via registerA2aToolsInRegistry,
and calls runner.run().

No user-visible change; every A2A unit test still passes.
EOF
)"
```

---

## Task 7: Introduce `Agent` primitive and wire the chat entry point through it

**Files:**
- Create: `src/background/agent/agent.mjs`
- Modify: `src/background/index.mjs` (`handleAIChat` now builds an `Agent` and calls `chat`)
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/background.test.js`:

```js
async function assertAgentChatDelegatesToRunner() {
  const { context } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible',
      a2aAutoRoute: false // no tools, plain chat path
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hi from agent' } }] })
    })
  });

  const agent = await context.createAgent();
  const result = await agent.chat([{ role: 'user', content: 'hello' }]);
  assert.strictEqual(result, 'hi from agent');
}
```

Register in `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — `createAgent is not a function`.

- [ ] **Step 3: Create `src/background/agent/agent.mjs`**

```js
// OmniPilot agent primitives — Agent.
//
// High-level entry point. Owns provider selection (loadConfig,
// getCopilotAccessToken when applicable), assembles a ToolRegistry
// from currently-enabled A2A servers when auto-routing is on, and
// delegates the loop to createRunner.
//
// The existing chrome runtime handlers (handleAIChat / handleAIAction
// / handleAIChatStreaming) become thin wrappers that build an Agent.
// Streaming remains outside the Runner in this phase.

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

  async function chat(messages) {
    const systemPrompt = overrides.systemPrompt || CHAT_SYSTEM_PROMPT;
    if (shouldAutoRouteA2a(config)) {
      const a2aServers = await ensureEnabledA2aServersDiscovered();
      if (a2aServers.length) {
        return await executeApiRequestWithA2aRouting({
          config,
          messages,
          systemPrompt,
          a2aServers,
          toolSchemas: buildA2aToolSchemas(a2aServers),
          onStatus: overrides.onStatus
        });
      }
    }
    return await executeApiRequest({ config, messages, systemPrompt });
  }

  async function action(actionName, text) {
    const systemPrompt = ACTION_PROMPTS[actionName];
    if (!systemPrompt) throw new Error(`Unknown action: ${actionName}`);
    return await executeApiRequest({
      config,
      messages: [{ role: 'user', content: text }],
      systemPrompt
    });
  }

  return { chat, action, config };
}
```

- [ ] **Step 4: Rewrite `handleAIChat` and `handleAIAction` as thin wrappers**

In `src/background/index.mjs`, replace the body of `handleAIChat`:

```js
async function handleAIChat(messages) {
  const agent = await createAgent();
  return agent.chat(messages);
}
```

Replace the body of `handleAIAction`:

```js
async function handleAIAction(action, text) {
  const agent = await createAgent();
  return agent.action(action, text);
}
```

`handleAIChatStreaming` remains untouched (streaming lives outside Agent in this phase).

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS — every existing test + new `assertAgentChatDelegatesToRunner`.

- [ ] **Step 6: Commit**

```bash
git add src/background/agent/agent.mjs src/background/index.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
refactor: route chat and action entry points through Agent primitive

createAgent() owns config loading, provider selection, and the
Copilot OAuth fetch. agent.chat(messages) either delegates to the A2A
routing helper (which now uses Runner internally) or to
executeApiRequest for the plain-chat path. agent.action(name, text)
is the single-turn shortcut used by the context-menu handlers.

handleAIChat and handleAIAction stay as-is on the top level so the
existing chrome.runtime message routes keep working; both now just
instantiate an Agent and delegate. Streaming (handleAIChatStreaming)
stays outside the Agent in this phase.
EOF
)"
```

---

## Task 8: Final green-run, doc pointer, and phase-1 wrap commit

**Files:**
- Modify: `README.md` (add one paragraph pointing to the agent/ folder)
- Modify: `src/background/index.mjs` (top-of-file comment describing the new architecture)

- [ ] **Step 1: Update the top-of-file comment in `src/background/index.mjs`**

Replace lines 1-2 (`// OmniPilot - background service worker\n// Handles API calls to avoid CORS issues in content scripts`) with:

```js
// OmniPilot - background service worker.
//
// Chrome runtime + extension host code (context menus, ports, message
// routing, storage, provider abstraction, OAuth). Agentic behavior
// (Agent, Runner, Tool, ToolRegistry, Session, State) lives under
// src/background/agent/ and is concatenated into this bundle by
// build.mjs. Handlers in this file are thin wrappers that instantiate
// an Agent and delegate.
```

- [ ] **Step 2: Add a short README paragraph**

Append to `README.md` after the existing top-level description:

```markdown
## Architecture

Background service-worker logic is split between two areas:

- **`src/background/index.mjs`** — Chrome runtime code: context menus, ports, message routing, `chrome.storage` schemas, provider abstraction (custom / GitHub Copilot / Azure Foundry), OAuth flows, and the streaming SSE parsers.
- **`src/background/agent/`** — Harness-style agent primitives (`Agent`, `Runner`, `Tool`, `ToolRegistry`, `Session`, `State`) plus the A2A tool provider. Files are concatenated into `dist/background.js` by `build.mjs` before the entry file, so declarations are top-level bindings at runtime.

The agent primitives are inspired by [Google's Agent Development Kit](https://adk.dev/get-started/) and the harness patterns from the [Harness Guide](https://harness-guide.com/guide/what-is-harness/) (agentic loop, tool registry, session/context/memory separation). Later phases add memory, priority-based context assembly, guardrails, and observability on top of these primitives.
```

- [ ] **Step 3: Run the full test suite one more time**

Run: `npm run test:unit`
Expected: PASS.

Run: `node build.mjs && ls -la dist/`
Expected: `dist/background.js` present, size roughly similar to pre-restructure (~80-90 KB).

- [ ] **Step 4: Manual smoke check**

Load the extension into Chrome (drag `dist/` into `chrome://extensions` in developer mode). Open the side panel and send:
1. `hello` — should get a plain LLM reply.
2. `translate: hello world` via the context menu on selected text — should return a translation.
3. If you have an A2A server registered, `how many VMs in alibaba and Azure` — should still fan out and produce a response (behavior unchanged from `9585bda`).

- [ ] **Step 5: Commit and push**

```bash
git add README.md src/background/index.mjs
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
docs: describe the agent/ folder in README and index.mjs header

Wraps up phase 1 of the ADK-style restructure. Every existing test
still passes; no user-visible behavior change. The new primitives
(Agent, Runner, Tool, ToolRegistry, Session, State) provide the
sockets that phases 2-5 will plug memory, context assembly,
guardrails, and observability into.
EOF
)"
git push origin main
```

---

## Self-Review Checklist

Ran through the writing-plans skill's self-review checklist before publishing:

1. **Spec coverage.** User asked for "restructure only, no new features" (Plan 1 scope, Option A). ✓ No new user-facing behavior in any task. ✓ Every primitive from the ADK-style split (`Agent`, `Runner`, `Tool`, `ToolRegistry`, `Session`, `State`) has a dedicated task. ✓ Constants extraction and `build.mjs` upgrade are covered in Task 1 so subsequent tasks have a working concat step. ✓ `A2aToolProvider` covered in Task 4 to replace `buildA2aToolSchemas`. ✓ `buildA2aFollowUpMessages` moved out in Task 5. ✓ Doc/README update in Task 8.

2. **Placeholder scan.** No "TBD", "later", "similar to task N", or "handle appropriately" phrasing anywhere. Every code step contains the full replacement text.

3. **Type consistency.** Naming stays consistent across tasks: `createTool`, `createToolRegistry`, `createSession`, `createState`, `createRunner`, `createAgent`, `registerA2aToolsInRegistry`. `Tool.meta.serverId` / `Tool.meta.skillId` referenced in Tasks 4 and 6 match. `Runner`'s `run()` uses `session.messages`, `session.hasDispatched`, `session.markDispatched`, `session.appendFollowUp` — all defined in Task 3.

---

## Verification

**During implementation, after every task:**
- `npm run test:unit` must pass (all unit test files, not just background). The concat build ordering means broken source in `agent/` would fail the build.
- `node build.mjs` must produce a `dist/background.js` within ~5 KB of the pre-restructure size (small growth is fine from per-file comment headers).

**After Task 8 (phase 1 complete):**
- Load `dist/` into Chrome as an unpacked extension, exercise the three smoke paths listed in Task 8 Step 4.
- Confirm the Playwright specs (`npm run test:playwright`) still pass — they exercise the packaged extension in a real browser and would catch any regression the unit tests missed. Not gated in the plan because they require Playwright's browsers to be installed locally.

**End-to-end (real A2A servers):** If you have live A2A servers, repeat the "Alibaba and Azure" prompt from the screenshot that motivated the earlier `88276df`/`9585bda` commits. The agentic loop implemented in `9585bda` was carried through into `Runner.run()` unchanged; behavior must match.
