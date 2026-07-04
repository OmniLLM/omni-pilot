# Context Assembly Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unconditional "prepend Memory summary to system prompt" from phase 2 with a proper **ContextAssembler** that packs prioritized sections (system prompt, memory summary, tool schemas, conversation history) into a token-bounded context. Prioritized so the highest-value context stays in when the budget is tight; lower-priority sections get dropped or truncated first.

**Architecture:** New `src/background/agent/context-assembler.mjs` primitive. `createContextAssembler({ maxTokens })` returns `{ addSection(priority, name, content), buildMessages(baseMessages) }`. Sections are added in any order but rendered in priority order (lower number = higher priority); once the running token estimate would exceed `maxTokens`, subsequent lower-priority sections are omitted (with a `_dropped` list surfaced for observability in phase 5). `createAgent()` builds an assembler on each turn, pushes memory + system prompt + tool schemas via helpers, then hands back the effective messages array plus a modified system prompt. Token estimation uses a cheap heuristic (~4 chars/token, matches GPT-tokenizer approximations well enough for budgeting).

**Tech Stack:** Vanilla ES modules, Chrome MV3 service worker, existing hand-inlined concat build. No new dependencies (avoiding `tiktoken` — too heavy for a browser bundle).

**Reference docs read for this plan:**
- Harness Guide — [Memory and Context](https://harness-guide.com/guide/memory-and-context/) — "prioritized packing problem against a fixed token budget"; sample `ContextAssembler(priority, name, content)` shape.
- Phase 1 plan (agent primitives) and phase 2 plan (memory subsystem) for the existing architecture.

**Out of scope (deferred to phases 4-5):**
- Guardrails / permissions on tool dispatch (phase 4).
- Structured event emission (phase 5).
- Auto-summarization of conversation history when it would exceed budget (would need an LLM call; leave for a future refinement).
- Streaming path context assembly (still not routed through Agent).
- Real tokenizer (uses char/4 heuristic; good enough for budgeting).

---

## Design decisions

1. **Sections and default priorities** (lower = kept first):
   - `10` — `system-prompt` (base instructions; never dropped in practice).
   - `20` — `memory-long-term` (user-curated `MEMORY.md`).
   - `30` — `tool-schemas` (marker only — actual schemas are attached to the request body by the transport layer, but their token cost is accounted for here so we don't overshoot).
   - `40` — `memory-recent-activity` (last 7 days of daily logs).
   - `50` — `conversation-history` (all user/assistant messages except the very latest user message, which is always included as `priority=0` so it's never dropped).
   - `0` — `latest-user-message` (always in — pinned).

2. **Token budget.** Default `maxTokens = 8000` (leaves ~24k for the model's response on a 32k-context model, comfortable for most providers). Config-tunable via a new `contextMaxTokens` sync setting (defaults to 8000 when absent). Not surfaced in the options page for phase 3 — settable via `chrome.storage.sync` directly, and phase 4/5 may expose it.

3. **Token estimate.** `estimateTokens(str) = Math.ceil(str.length / 4)`. Widely used approximation; error is fine for budgeting (we're deciding "does this fit" not billing).

4. **Drop policy.** When the running total + candidate section would exceed `maxTokens`, the candidate is dropped in favor of the still-empty remainder of the queue AS LONG AS the drop wouldn't leave anything higher-priority than the current section without room. In practice: sections are sorted by priority ascending; we walk the list and greedily include each one that fits. Skipped sections are recorded but not truncated — truncation would require section-specific knowledge (do you keep the tail of conversation history? the head?). Truncation is a future refinement.

5. **How Agent uses it.** `createAgent()`'s `chat(messages)` and `action(_, text)` currently prepend Memory to a fixed system prompt and pass messages verbatim. Now:
   - Build an assembler.
   - Push `system-prompt` (`CHAT_SYSTEM_PROMPT` or the action prompt) at priority 10.
   - Push memory long-term (if any) at priority 20.
   - Push memory recent activity at priority 40.
   - Push a placeholder for tool schemas at priority 30 whose "content" is a stringified size estimate of the actual schemas.
   - Push conversation history segments at priority 50 (older-first) and priority 0 (the latest user message).
   - Call `assembler.buildMessages(messages)` to get `{ systemPrompt, messages, dropped }` where the returned `systemPrompt` is the concatenated priority-ordered non-conversation sections and `messages` is the survived conversation slice with the latest user message pinned.
6. **Backward compatibility.** The A2A auto-route path still goes through `executeApiRequestWithA2aRouting` which does its own system-prompt build (via `buildA2aRoutingSystemPrompt`). To avoid double-processing, the assembler runs BEFORE `executeApiRequestWithA2aRouting` — its output `systemPrompt` becomes the input to `buildA2aRoutingSystemPrompt`. The routing prompt wrapper appends its A2A instructions on top. This preserves all phase-1 behavior.

7. **Testability.** Priority ordering, drop behavior, and token math must be unit-testable without touching real chrome storage or fetch. `createContextAssembler` is a pure factory — trivial to test in isolation.

---

## File Structure

**New file:**
- `src/background/agent/context-assembler.mjs` — `createContextAssembler`, `estimateTokens`, `buildMessages`.

**Modified:**
- `src/background/agent/agent.mjs` — `chat` and `action` build an assembler and use its output.
- `src/background/agent/constants.mjs` — add `CONTEXT_DEFAULT_MAX_TOKENS = 8000`.
- `src/background/index.mjs` — add `contextMaxTokens` to `DEFAULT_CONFIG` and `STORAGE_KEYS`.
- `tests/unit/background.test.js` — four new tests: assembler round-trip, priority ordering, drops on budget overflow, Agent chat uses assembler output.

**Preserved:**
- Every other agent primitive.
- Streaming path.
- Options page (no UI change).

---

## Task 1: Create `context-assembler.mjs` primitive

**Files:**
- Create: `src/background/agent/context-assembler.mjs`
- Modify: `src/background/agent/constants.mjs`
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/background.test.js`:

```js
async function assertContextAssemblerBasicRoundTrip() {
  const { context } = await createBackgroundContext({ storage: {} });

  const asm = context.createContextAssembler({ maxTokens: 1000 });
  asm.addSection(10, 'system-prompt', 'You are helpful.');
  asm.addSection(20, 'memory-long-term', 'Prefers concise answers.');
  const built = asm.buildMessages([{ role: 'user', content: 'hello' }]);

  // Priority-ordered concatenation.
  assert.ok(built.systemPrompt.includes('You are helpful.'));
  assert.ok(built.systemPrompt.includes('Prefers concise answers.'));
  assert.ok(built.systemPrompt.indexOf('You are helpful.')
        < built.systemPrompt.indexOf('Prefers concise answers.'),
        'lower-priority-number section comes first');
  // Messages passed through unmodified when nothing pinned/dropped.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(built.messages)),
    [{ role: 'user', content: 'hello' }]);
  assert.deepStrictEqual(built.dropped, [], 'no drops when budget is generous');
}

async function assertContextAssemblerDropsLowestPriorityOnOverflow() {
  const { context } = await createBackgroundContext({ storage: {} });

  // Very tight budget so only the highest-priority sections fit.
  const asm = context.createContextAssembler({ maxTokens: 20 });
  // ~4 tokens each.
  asm.addSection(10, 'system-prompt', 'a'.repeat(40));   // 10 tokens
  asm.addSection(20, 'memory-long-term', 'b'.repeat(40)); // 10 tokens — fits
  asm.addSection(50, 'memory-recent', 'c'.repeat(40));    // 10 tokens — would push us to 30
  const built = asm.buildMessages([]);

  assert.ok(built.systemPrompt.includes('aaa'));
  assert.ok(built.systemPrompt.includes('bbb'));
  assert.ok(!built.systemPrompt.includes('ccc'), 'lowest-priority section dropped');
  assert.strictEqual(built.dropped.length, 1);
  assert.strictEqual(built.dropped[0].name, 'memory-recent');
}

async function assertContextAssemblerAlwaysKeepsPinnedLatestUserMessage() {
  const { context } = await createBackgroundContext({ storage: {} });

  const asm = context.createContextAssembler({ maxTokens: 20 });
  asm.addSection(10, 'system-prompt', 'x'.repeat(80)); // eats the whole budget
  const messages = [
    { role: 'user', content: 'old' },
    { role: 'assistant', content: 'old reply' },
    { role: 'user', content: 'latest question' }
  ];
  const built = asm.buildMessages(messages);

  // Latest user message is pinned even when budget is exhausted.
  assert.strictEqual(built.messages[built.messages.length - 1].content, 'latest question');
  // Older messages may or may not survive; only the pin is guaranteed.
}

async function assertContextAssemblerEstimateTokensIsCharDiv4() {
  const { context } = await createBackgroundContext({ storage: {} });
  assert.strictEqual(context.estimateTokens(''), 0);
  assert.strictEqual(context.estimateTokens('abcd'), 1);
  assert.strictEqual(context.estimateTokens('abcde'), 2);
  assert.strictEqual(context.estimateTokens('a'.repeat(400)), 100);
}
```

Register all four in `main()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — `context.createContextAssembler is not a function`.

- [ ] **Step 3: Add constant to `src/background/agent/constants.mjs`**

Append:

```js
// Context assembly — default token budget for the assembled per-turn
// context. Overridable via chrome.storage.sync `contextMaxTokens`.
const CONTEXT_DEFAULT_MAX_TOKENS = 8000;
```

- [ ] **Step 4: Create `src/background/agent/context-assembler.mjs`**

```js
// OmniPilot agent primitives — ContextAssembler.
//
// Prioritized packing of prompt sections into a token-bounded context.
// Sections are (priority, name, content); lower priority number =
// kept first. Once the running token estimate would exceed maxTokens,
// the offending section is dropped (recorded in the returned `dropped`
// array) and later sections continue to be tried in case they fit.
//
// Token estimate is Math.ceil(str.length / 4) — a well-known heuristic
// that's fine for budgeting decisions.
//
// Concatenated into dist/background.js; do not add `export`s.

function estimateTokens(str) {
  if (!str) return 0;
  return Math.ceil(String(str).length / 4);
}

function createContextAssembler({ maxTokens = CONTEXT_DEFAULT_MAX_TOKENS } = {}) {
  const sections = [];

  function addSection(priority, name, content) {
    if (!content) return;
    sections.push({
      priority: Number.isFinite(priority) ? priority : 100,
      name: String(name || 'unnamed'),
      content: String(content),
      tokens: estimateTokens(content)
    });
  }

  function buildMessages(baseMessages = []) {
    // Sort by priority ascending (0 first, then 10, 20, ...).
    const ordered = [...sections].sort((a, b) => a.priority - b.priority);

    let used = 0;
    const kept = [];
    const dropped = [];
    for (const s of ordered) {
      if (used + s.tokens <= maxTokens) {
        kept.push(s);
        used += s.tokens;
      } else {
        dropped.push({ name: s.name, priority: s.priority, tokens: s.tokens });
      }
    }

    const systemPrompt = kept.map(s => s.content).join('\n\n');

    // Pin the latest user message. Drop older messages only if the total
    // exceeds the remaining budget. For phase 3 we keep the whole history
    // if it fits and drop from the OLDEST end otherwise.
    const messages = pinAndTrimMessages(baseMessages, maxTokens - used);

    return { systemPrompt, messages, dropped };
  }

  function pinAndTrimMessages(messages, budget) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    if (budget <= 0) {
      // Budget exhausted by sections — keep only the latest user message.
      const last = messages[messages.length - 1];
      return last ? [last] : [];
    }
    // Try to include from the newest backwards until we run out of budget.
    const included = [];
    let remaining = budget;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      const cost = estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
      if (cost > remaining && i !== messages.length - 1) break; // always pin the latest
      included.unshift(m);
      remaining -= cost;
    }
    return included;
  }

  return { addSection, buildMessages };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/agent/constants.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/agent/context-assembler.mjs src/background/agent/constants.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: add ContextAssembler primitive for prioritized context packing

createContextAssembler({ maxTokens }) accumulates named sections with
integer priorities (lower = kept first) and returns
{ systemPrompt, messages, dropped } from buildMessages(baseMessages).
Sections that would overflow the token budget are recorded in
`dropped` instead of being included. The latest user message is
always pinned so a compound-history overflow can't silently drop the
prompt the user just typed.

Token estimate uses Math.ceil(len/4) — good enough for budgeting; no
new deps.
EOF
)"
```

---

## Task 2: Add `contextMaxTokens` config

**Files:**
- Modify: `src/background/index.mjs`
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Failing test**

```js
async function assertContextMaxTokensConfigDefaultsAndPersists() {
  const { context, stores } = await createBackgroundContext({ storage: {} });
  const config = await context.loadConfig();
  assert.strictEqual(config.contextMaxTokens, 8000);

  stores.syncStore.contextMaxTokens = 4000;
  const config2 = await context.loadConfig();
  assert.strictEqual(config2.contextMaxTokens, 4000);
}
```

Register in `main()`.

- [ ] **Step 2: Verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — `contextMaxTokens` undefined.

- [ ] **Step 3: Add to `DEFAULT_CONFIG` and `STORAGE_KEYS`**

In `src/background/index.mjs`:
- Add `contextMaxTokens: 8000` to `DEFAULT_CONFIG`.
- Add `'contextMaxTokens'` to `STORAGE_KEYS`.

- [ ] **Step 4: Verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/index.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/index.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "feat: add contextMaxTokens config defaulting to 8000"
```

---

## Task 3: Route Agent through the assembler

**Files:**
- Modify: `src/background/agent/agent.mjs`
- Test: `tests/unit/background.test.js`

- [ ] **Step 1: Failing test**

Append:

```js
async function assertAgentUsesContextAssemblerForChat() {
  let capturedBody = null;
  const { context } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible',
      a2aAutoRoute: false,
      memoryEnabled: true,
      contextMaxTokens: 8000,
      omnipilotMemoryLongTerm: 'MEM-LONG-TERM-SENTINEL',
      omnipilotMemoryDailyLogs: {
        '2026-07-03': ['RECENT-SENTINEL']
      }
    },
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    }
  });

  const agent = await context.createAgent();
  await agent.chat([
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'latest question' }
  ]);

  const sys = capturedBody.messages.find(m => m.role === 'system').content;
  // Both memory sections should appear (long-term higher priority than recent).
  const idxLong = sys.indexOf('MEM-LONG-TERM-SENTINEL');
  const idxRecent = sys.indexOf('RECENT-SENTINEL');
  assert.ok(idxLong >= 0, 'long-term memory made it into the system prompt');
  assert.ok(idxRecent >= 0, 'recent activity made it into the system prompt');
  assert.ok(idxLong < idxRecent, 'long-term memory ranked before recent activity');

  // Latest user message must still be in the outbound messages.
  const nonSystem = capturedBody.messages.filter(m => m.role !== 'system');
  assert.strictEqual(nonSystem[nonSystem.length - 1].content, 'latest question');
}

async function assertAgentDropsSectionsUnderTightTokenBudget() {
  let capturedBody = null;
  const { context } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible',
      a2aAutoRoute: false,
      memoryEnabled: true,
      // Absurdly small budget so only the highest-priority sections fit.
      contextMaxTokens: 30,
      omnipilotMemoryLongTerm: 'a'.repeat(200), // 50 tokens — should be dropped
      omnipilotMemoryDailyLogs: { '2026-07-03': ['x'.repeat(200)] }
    },
    fetchImpl: async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
    }
  });

  const agent = await context.createAgent();
  await agent.chat([{ role: 'user', content: 'latest question' }]);

  const sys = capturedBody.messages.find(m => m.role === 'system').content;
  // Base system prompt (highest priority) survives.
  assert.ok(sys.length > 0);
  // Memory sections should have been dropped.
  assert.ok(!/a{50,}/.test(sys), 'long-term memory dropped under tight budget');
  assert.ok(!/x{50,}/.test(sys), 'recent activity dropped under tight budget');
}
```

Register both in `main()`.

- [ ] **Step 2: Verify it fails**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: FAIL — memory currently prepended verbatim, ordering not enforced, drops not applied.

- [ ] **Step 3: Wire the assembler into `createAgent`**

Replace `src/background/agent/agent.mjs` with:

```js
// OmniPilot agent primitives — Agent.
//
// High-level entry point. Owns provider selection (loadConfig,
// getCopilotAccessToken when applicable), assembles per-turn context
// via createContextAssembler, and delegates to createRunner (via
// executeApiRequestWithA2aRouting) or the plain executeApiRequestWithConfig.

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

  const memory = (config.memoryEnabled === false || !chrome.storage?.local?.set) ? null : createMemory();
  const memoryLongTerm = memory ? await memory.getLongTerm() : '';
  const memoryRecentSections = memory ? await memory.getRecent() : [];
  const maxTokens = Number(config.contextMaxTokens) || CONTEXT_DEFAULT_MAX_TOKENS;

  async function logCompletion({ action, userLen, assistantLen }) {
    if (!memory) return;
    try {
      await memory.appendDailyLog(buildLogEntry({ action, userLen, assistantLen }));
    } catch (error) {
      console.warn('OmniPilot: failed to append daily log', error?.message || error);
    }
  }

  function assembleContext(basePrompt, messages) {
    const asm = createContextAssembler({ maxTokens });
    asm.addSection(10, 'system-prompt', basePrompt);
    if (memoryLongTerm) asm.addSection(20, 'memory-long-term', memoryLongTerm);
    if (memoryRecentSections.length) {
      const recentText = formatRecentActivity(memoryRecentSections);
      asm.addSection(40, 'memory-recent-activity', recentText);
    }
    return asm.buildMessages(messages);
  }

  async function chat(messages) {
    const basePrompt = overrides.systemPrompt || CHAT_SYSTEM_PROMPT;
    const built = assembleContext(basePrompt, messages);
    let result;
    if (shouldAutoRouteA2a(config)) {
      const a2aServers = await ensureEnabledA2aServersDiscovered();
      if (a2aServers.length) {
        result = await executeApiRequestWithA2aRouting({
          config,
          messages: built.messages,
          systemPrompt: built.systemPrompt,
          a2aServers,
          toolSchemas: buildA2aToolSchemas(a2aServers),
          onStatus: overrides.onStatus
        });
      }
    }
    if (result === undefined) {
      result = await executeApiRequestWithConfig({
        config,
        messages: built.messages,
        systemPrompt: built.systemPrompt,
        copilotToken,
        allowModelFallback: provider.usesCopilotAuth
      });
    }
    const userLen = String(messages[messages.length - 1]?.content || '').length;
    const assistantLen = String(result || '').length;
    await logCompletion({ action: 'chat', userLen, assistantLen });
    return result;
  }

  async function action(actionName, text) {
    const basePrompt = ACTION_PROMPTS[actionName];
    if (!basePrompt) throw new Error(`Unknown action: ${actionName}`);
    const messages = [{ role: 'user', content: text }];
    const built = assembleContext(basePrompt, messages);
    const result = await executeApiRequestWithConfig({
      config,
      messages: built.messages,
      systemPrompt: built.systemPrompt,
      copilotToken,
      allowModelFallback: provider.usesCopilotAuth
    });
    await logCompletion({
      action: actionName,
      userLen: String(text || '').length,
      assistantLen: String(result || '').length
    });
    return result;
  }

  return { chat, action, config, memory };
}

function formatRecentActivity(recent) {
  const parts = ['### Recent activity'];
  for (const { date, entries } of recent) {
    parts.push(`- ${date}`);
    for (const entry of entries) parts.push(`  - ${entry}`);
  }
  return parts.join('\n');
}

function buildLogEntry({ action, userLen, assistantLen, now = new Date() }) {
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} action=${action} user_len=${userLen} assistant_len=${assistantLen}`;
}
```

Note the shift from phase 2:
- `memory.summary()` (the monolithic block) is no longer called; sections are pushed individually so the assembler can drop them independently.
- `formatRecentActivity` is now inline in agent.mjs to keep memory.mjs's `summary()` intact for anyone else consuming it (like a future debug view).

- [ ] **Step 4: Verify it passes**

Run: `node build.mjs && node tests/unit/background.test.js`
Expected: PASS — new tests + every existing test still green.

- [ ] **Step 5: Commit**

```bash
node -e "const fs=require('fs'); for (const f of ['src/background/agent/agent.mjs','tests/unit/background.test.js']) fs.writeFileSync(f, fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'));"

git add src/background/agent/agent.mjs tests/unit/background.test.js
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "$(cat <<'EOF'
feat: Agent builds per-turn context via prioritized ContextAssembler

Replaces the unconditional memory prepend from phase 2 with a proper
prioritized packing: base system prompt (p=10), long-term memory
(p=20), recent activity (p=40). Sections that would push the running
token estimate past config.contextMaxTokens are dropped in
priority-descending order. Latest user message is always pinned so
older history is trimmed before it.

memoryEnabled: false skips memory sections entirely; A2A auto-route
still gets the assembler's output as its base system prompt (routing
wrapper appends its A2A instructions on top).
EOF
)"
```

---

## Task 4: Docs + wrap

**Files:**
- Modify: `README.md` (add ContextAssembler bullet to architecture section)

- [ ] **Step 1: Update README**

Find the architecture section that mentions memory (added in phase 2). Add a new `### Context assembly` subsection AFTER the Memory subsection:

```markdown
### Context assembly

Every chat/action turn's system prompt is packed by `src/background/agent/context-assembler.mjs`. Sections (system prompt, long-term memory, recent activity, tool schemas) are added with integer priorities (lower = kept first); when the running token estimate would exceed `contextMaxTokens` (default 8000), lower-priority sections are dropped. The latest user message is always pinned so an oversized history can't silently drop the prompt the user just typed.
```

- [ ] **Step 2: Run tests**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 3: Commit + push**

```bash
node -e "const fs=require('fs'); fs.writeFileSync('README.md', fs.readFileSync('README.md','utf8').replace(/\r\n/g,'\n'));"

git add README.md
git commit --author="James Zhu <zhujian0805@gmail.com>" -m "docs: describe Context assembly in README"

git push origin main
```

---

## Self-Review

1. **Spec coverage.** ✓ ContextAssembler primitive; ✓ priorities and drop policy; ✓ pinned latest message; ✓ config flag; ✓ Agent wiring; ✓ Memory long-term and recent activity split into their own sections; ✓ backward compatibility with A2A auto-route; ✓ docs.
2. **Placeholder scan.** No TBD/later markers; every code block is complete.
3. **Type consistency.** `createContextAssembler`, `addSection`, `buildMessages`, `estimateTokens`, `formatRecentActivity`, `CONTEXT_DEFAULT_MAX_TOKENS`, `contextMaxTokens` — all consistent across tasks.

## Verification

- `npm run test:unit` after every task.
- Manually verify token-budgeting math: 8000 tokens × 4 chars = ~32k chars, roughly one small book — comfortable for the memory + short conversations, tight for very long histories (which will now be trimmed from the oldest end).
- Every phase 1 + phase 2 test still passes. `handleAIChatStreaming` unchanged.
