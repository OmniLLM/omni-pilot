# Guardrails Implementation Plan (Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add permission classifier + audit log on top of `ToolRegistry.dispatch` so every tool call is checked against a configurable policy (deny-list of A2A domains, per-tool tier) before execution. Denied calls surface as tool_result errors (so the model can adapt) and are recorded to an audit log alongside the daily activity log.

**Architecture:** New `src/background/agent/guardrails.mjs` primitive. `createGuardrails({ mode, denyDomains, tierOverrides })` returns `{ classify(tool, args), wrap(registry) }`. `classify` returns `{ tier: 'low'|'medium'|'high'|'critical', reason: string, allow: boolean }`. `wrap(registry)` decorates `registry.dispatch` so every call goes through `classify` first — denied calls throw a distinctive `GuardrailDeniedError`-like plain Error (message includes reason). The Agent enables guardrails when instantiating an A2A registry.

**Tech Stack:** Vanilla ES modules, existing concat build. No new deps.

**Reference:** Harness Guide — [Guardrails](https://harness-guide.com/guide/guardrails/) — tiered approval, allow-list vs deny-list, "guardrails make the harness the final authority on what actions are permitted, regardless of what the model requests."

**Out of scope (deferred):**
- Human-in-the-loop approval UI. Phase 4 has policy enforcement only; approving from the side panel comes later.
- OS-level sandboxing (irrelevant in a browser).
- Prompt-injection defense beyond the deny-list.
- Options page UI for editing the deny-list (phase 4.5 or piggyback on phase 5).

---

## Design

1. **Modes:**
   - `off` — no enforcement; wrap is a no-op.
   - `deny-list` (default) — everything allowed except domains in `denyDomains` or tools tier-classified as `critical`.
   - `strict` — everything allowed except `low`/`medium` unless in an explicit allow-list. Reserved for future; phase 4 ships with modes `off` and `deny-list`.

2. **Tier classification (deny-list mode):**
   - **critical** (always denied): tools whose meta.skillTags include `destructive`, `delete`, `admin`, or `payments`. Also any A2A endpoint domain matching an entry in `denyDomains`.
   - **high** (allowed with audit): everything else that talks to network/A2A.
   - **medium/low**: reserved for future local tools.

3. **Config keys** (both in `chrome.storage.sync`):
   - `guardrailsMode` — string, default `'deny-list'`.
   - `guardrailsDenyDomains` — array of strings (domain suffixes matched via `endsWith`), default `[]`.

4. **Audit log:**
   - Append to `chrome.storage.local` under `omnipilotGuardrailsAudit` — an array capped at 200 entries (drop oldest when overflowing).
   - Each entry: `{ ts, toolName, serverId, tier, allow, reason }`.
   - Best-effort — failures on audit write are swallowed (like memory).

5. **Wire-in:** In `src/background/index.mjs`, `executeApiRequestWithA2aRouting` now calls `createGuardrails({ mode: config.guardrailsMode, denyDomains: config.guardrailsDenyDomains, servers: a2aServers })` and passes the result as `guardrails` into `createRunner`. The Runner already goes through `toolRegistry.dispatch` for every tool call — decorate the registry via `guardrails.wrap(registry)` before creating the Runner. When a denied call happens, the runner catches the thrown error and turns it into a tool_result error (existing catch path in Task 6 of phase 1 already handles that — dispatch errors are wrapped in the settled entry as `{ error: message }`).

6. **Testability:** `createGuardrails` is pure and injectable. All tests can use in-memory servers and stubbed registries; no chrome fetch needed.

---

## Task 1: `guardrails.mjs` primitive

**Files:**
- Create: `src/background/agent/guardrails.mjs`
- Modify: `src/background/agent/constants.mjs`
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write failing test**

```js
async function assertGuardrailsDenyByDomain() {
  const { context } = await createBackgroundContext({ storage: {} });

  const servers = [
    { id: 'good', endpoint: 'https://good.example/a2a' },
    { id: 'bad',  endpoint: 'https://bad.example/a2a' }
  ];
  const g = context.createGuardrails({ mode: 'deny-list', denyDomains: ['bad.example'], servers });

  const goodTool = { name: 'a2a__good__x', meta: { serverId: 'good' } };
  const badTool  = { name: 'a2a__bad__x',  meta: { serverId: 'bad' } };
  const goodVerdict = g.classify(goodTool, { task: 'ok' });
  const badVerdict  = g.classify(badTool,  { task: 'ok' });

  assert.strictEqual(goodVerdict.allow, true);
  assert.strictEqual(goodVerdict.tier, 'high');
  assert.strictEqual(badVerdict.allow, false);
  assert.strictEqual(badVerdict.tier, 'critical');
  assert.ok(/deny|bad.example/i.test(badVerdict.reason));
}

async function assertGuardrailsDenyByDestructiveTag() {
  const { context } = await createBackgroundContext({ storage: {} });
  const g = context.createGuardrails({ mode: 'deny-list', denyDomains: [], servers: [] });

  const tool = { name: 'a2a__srv__delete', meta: { serverId: 'srv', skillTags: ['destructive'] } };
  const verdict = g.classify(tool, { task: 'nuke' });
  assert.strictEqual(verdict.allow, false);
  assert.strictEqual(verdict.tier, 'critical');
}

async function assertGuardrailsWrapEnforcesOnDispatch() {
  const { context } = await createBackgroundContext({ storage: {} });

  const registry = context.createToolRegistry();
  registry.register(context.createTool({
    name: 'a2a__bad__x',
    description: 'x',
    dispatch: async () => 'should never run',
    meta: { serverId: 'bad', skillTags: [] }
  }));

  const g = context.createGuardrails({
    mode: 'deny-list',
    denyDomains: ['bad.example'],
    servers: [{ id: 'bad', endpoint: 'https://bad.example/a2a' }]
  });
  g.wrap(registry);

  await assert.rejects(() => registry.dispatch('a2a__bad__x', { task: 'go' }),
    /guardrail|denied|bad.example/i);
}

async function assertGuardrailsOffModeIsNoop() {
  const { context } = await createBackgroundContext({ storage: {} });
  const registry = context.createToolRegistry();
  registry.register(context.createTool({
    name: 'a2a__bad__x',
    description: 'x',
    dispatch: async () => 'ran anyway',
    meta: { serverId: 'bad' }
  }));

  const g = context.createGuardrails({
    mode: 'off',
    denyDomains: ['bad.example'],
    servers: [{ id: 'bad', endpoint: 'https://bad.example/a2a' }]
  });
  g.wrap(registry);

  const result = await registry.dispatch('a2a__bad__x', { task: 'go' });
  assert.strictEqual(result, 'ran anyway');
}
```

Register all four in `main()`.

- [ ] **Step 2: Verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — `context.createGuardrails is not a function`.

- [ ] **Step 3: Add constants**

Append to `src/background/agent/constants.mjs`:

```js
// Guardrails — classification tiers and audit-log cap.
const GUARDRAIL_TIERS = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' };
const GUARDRAIL_AUDIT_KEY = 'omnipilotGuardrailsAudit';
const GUARDRAIL_AUDIT_MAX_ENTRIES = 200;
const GUARDRAIL_DESTRUCTIVE_TAGS = ['destructive', 'delete', 'admin', 'payments'];
```

- [ ] **Step 4: Create `src/background/agent/guardrails.mjs`**

```js
// OmniPilot agent primitives — Guardrails.
//
// Enforces a permission policy on every ToolRegistry.dispatch call.
// Modes:
//   * 'off'       — no enforcement (wrap is a no-op).
//   * 'deny-list' — everything allowed except denied domains or tools
//                   with destructive skill tags (see GUARDRAIL_DESTRUCTIVE_TAGS).
// Denied calls throw an Error with "guardrail" in the message so the
// Runner's fanout code can convert them into tool_result errors.
//
// Audit log entries go into chrome.storage.local under
// GUARDRAIL_AUDIT_KEY, capped at GUARDRAIL_AUDIT_MAX_ENTRIES (oldest
// dropped on overflow). Audit failures are swallowed.
//
// Concatenated into dist/background.js; do not add `export`s.

function createGuardrails({ mode = 'deny-list', denyDomains = [], servers = [] } = {}) {
  const serverById = new Map();
  for (const s of servers || []) {
    if (s && s.id) serverById.set(s.id, s);
  }
  const denyList = (denyDomains || []).map(d => String(d || '').toLowerCase()).filter(Boolean);

  function domainOf(server) {
    try {
      const url = new URL(server?.endpoint || '');
      return url.hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  function isDeniedDomain(server) {
    const host = domainOf(server);
    if (!host) return false;
    return denyList.some(pattern => host === pattern || host.endsWith('.' + pattern) || host.endsWith(pattern));
  }

  function hasDestructiveTag(tool) {
    const tags = Array.isArray(tool?.meta?.skillTags) ? tool.meta.skillTags : [];
    return tags.some(tag => GUARDRAIL_DESTRUCTIVE_TAGS.includes(String(tag || '').toLowerCase()));
  }

  function classify(tool /*, args */) {
    if (mode === 'off') {
      return { tier: GUARDRAIL_TIERS.LOW, allow: true, reason: 'guardrails off' };
    }
    const serverId = tool?.meta?.serverId;
    const server = serverId ? serverById.get(serverId) : null;
    if (server && isDeniedDomain(server)) {
      return {
        tier: GUARDRAIL_TIERS.CRITICAL,
        allow: false,
        reason: `denied by domain: ${domainOf(server)}`
      };
    }
    if (hasDestructiveTag(tool)) {
      return {
        tier: GUARDRAIL_TIERS.CRITICAL,
        allow: false,
        reason: `denied by destructive tag on tool ${tool?.name}`
      };
    }
    return { tier: GUARDRAIL_TIERS.HIGH, allow: true, reason: 'ok' };
  }

  async function appendAudit(entry) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return;
    try {
      const stored = await new Promise(resolve =>
        chrome.storage.local.get([GUARDRAIL_AUDIT_KEY], resolve));
      const log = Array.isArray(stored[GUARDRAIL_AUDIT_KEY]) ? stored[GUARDRAIL_AUDIT_KEY] : [];
      log.push(entry);
      while (log.length > GUARDRAIL_AUDIT_MAX_ENTRIES) log.shift();
      await new Promise(resolve =>
        chrome.storage.local.set({ [GUARDRAIL_AUDIT_KEY]: log }, resolve));
    } catch (error) {
      console.warn('OmniPilot: failed to append guardrail audit', error?.message || error);
    }
  }

  function wrap(registry) {
    if (mode === 'off') return registry; // no-op
    const originalDispatch = registry.dispatch;
    registry.dispatch = async function guardedDispatch(name, args) {
      const tool = registry.get(name);
      const verdict = tool
        ? classify(tool, args)
        : { tier: GUARDRAIL_TIERS.CRITICAL, allow: false, reason: `unknown tool ${name}` };
      const ts = new Date().toISOString();
      appendAudit({
        ts,
        toolName: name,
        serverId: tool?.meta?.serverId || null,
        tier: verdict.tier,
        allow: verdict.allow,
        reason: verdict.reason
      });
      if (!verdict.allow) {
        throw new Error(`Guardrail denied: ${verdict.reason}`);
      }
      return originalDispatch.call(registry, name, args);
    };
    return registry;
  }

  return { classify, wrap };
}
```

- [ ] **Step 5: Verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/agent/constants.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/agent/guardrails.mjs src/background/agent/constants.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: add Guardrails primitive with deny-list domain and destructive-tag policy

createGuardrails({ mode, denyDomains, servers }) returns classify()
and wrap(). classify() returns { tier, allow, reason }; wrap()
decorates ToolRegistry.dispatch so every call is checked. Denied
calls throw so Runner's per-call catch turns them into tool_result
errors, and one audit entry per call lands in chrome.storage.local
(capped at 200; oldest dropped).

Modes: 'off' (no-op) and 'deny-list' (destructive tags + configured
denied domains blocked). Strict allow-list mode is reserved for
future work.
EOF
)"
```

---

## Task 2: Add guardrails config + wire into `executeApiRequestWithA2aRouting`

**Files:**
- Modify: `src/background/index.mjs` — add config, wrap the registry.
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Failing test**

```js
async function assertA2aRoutingHonorsGuardrailsDenyDomain() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible',
      memoryEnabled: false,
      guardrailsMode: 'deny-list',
      guardrailsDenyDomains: ['bad.example'],
      a2aServers: [
        { id: 'bad', name: 'BadAgent', endpoint: 'https://bad.example/a2a', enabled: true,
          agentCard: { name: 'BadAgent', skills: [{ id: 'x', name: 'X' }] } }
      ],
      a2aServerTokens: { bad: 't' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        // Round 0: model tries to call the denied tool.
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'a2a__bad__x', arguments: JSON.stringify({ task: 'go' }) } }
            ] } }]
          })
        };
      }
      if (url === 'https://bad.example/a2a') {
        throw new Error('MUST NOT REACH the denied domain');
      }
      throw new Error(`unexpected ${url}`);
    }
  });

  // Runner should catch the denial and (per phase-1 code) render it as an error.
  // But actually the current Runner throws when settled.error and settled.length===1.
  // So the whole call rejects with a message containing "Guardrail".
  await assert.rejects(
    () => context.handleAIChat([{ role: 'user', content: 'run' }]),
    /Guardrail/
  );

  // The A2A endpoint was never fetched.
  assert.ok(!requests.some(r => r.url === 'https://bad.example/a2a'), 'denied domain must not be contacted');
}
```

Register in `main()`.

- [ ] **Step 2: Verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — no guardrails wiring yet, so the request reaches the "MUST NOT REACH" endpoint.

- [ ] **Step 3: Add config keys**

In `src/background/index.mjs`:
- Add `guardrailsMode: 'deny-list'` and `guardrailsDenyDomains: []` to `DEFAULT_CONFIG`.
- Add `'guardrailsMode'` and `'guardrailsDenyDomains'` to `STORAGE_KEYS`.

- [ ] **Step 4: Wire guardrails into `executeApiRequestWithA2aRouting`**

Find `executeApiRequestWithA2aRouting` in `src/background/index.mjs`. After the line that creates the ToolRegistry and registers A2A tools, add:

```js
  const guardrails = createGuardrails({
    mode: config.guardrailsMode,
    denyDomains: Array.isArray(config.guardrailsDenyDomains) ? config.guardrailsDenyDomains : [],
    servers: a2aServers
  });
  guardrails.wrap(registry);
```

Place this AFTER `registerA2aToolsInRegistry(registry, a2aServers, { getContextText: () => contextText });` and BEFORE `createRunner(...)`.

- [ ] **Step 5: Verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/index.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/index.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: A2A routing enforces guardrails on every tool dispatch

Adds guardrailsMode ('deny-list' default) and guardrailsDenyDomains
config, then wraps the per-run A2A ToolRegistry via
createGuardrails(...).wrap(registry) so every dispatch goes through
the classifier before running. Denied calls throw a Guardrail-tagged
Error which the Runner's per-call catch converts into a tool_result
error message the model can observe.
EOF
)"
```

---

## Task 3: Docs + wrap

**Files:**
- Modify: `README.md`

- [ ] Add a `### Guardrails` subsection after Context assembly:

```markdown
### Guardrails

Every tool dispatch in the A2A auto-route path is checked by `src/background/agent/guardrails.mjs` before it runs. The default `deny-list` mode blocks A2A endpoints on any domain in `guardrailsDenyDomains` and tools whose skill tags mark them as destructive/admin/payments-related. Denied calls surface to the model as `tool_result` errors instead of being executed, and each classification lands in a rolling 200-entry audit log at `chrome.storage.local["omnipilotGuardrailsAudit"]`.
```

- [ ] Run tests: `npm run test:unit`. Expected PASS.
- [ ] Commit + push:

```bash
node -e "const fs=require('fs'); fs.writeFileSync('README.md', fs.readFileSync('README.md','utf8').replace(/\r\n/g,'\n'));"

git add README.md
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "docs: describe Guardrails in README"

git push origin main
```

---

## Self-Review

1. **Spec coverage.** ✓ createGuardrails with deny-list mode; ✓ tier classification; ✓ audit log; ✓ integration into routing loop; ✓ docs.
2. **Placeholder scan.** All code blocks are complete.
3. **Type consistency.** `createGuardrails`, `classify`, `wrap`, `GUARDRAIL_TIERS`, `GUARDRAIL_AUDIT_KEY`, `GUARDRAIL_DESTRUCTIVE_TAGS` all cross-referenced consistently.

## Verification

- `npm run test:unit` after each task.
- Manual verification: register an A2A server on a real endpoint, add its domain to `guardrailsDenyDomains` via `chrome.storage.sync.set({ guardrailsDenyDomains: ['example.com'] })`, then send a chat that would route to it. Expect the routing to fail with a Guardrail message instead of contacting the endpoint. Verify `chrome.storage.local["omnipilotGuardrailsAudit"]` gains an entry.
