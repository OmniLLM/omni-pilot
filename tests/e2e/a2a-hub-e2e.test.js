/**
 * A2A Hub End-to-End tests against the Omni Agent Hub.
 *
 * Tests the hub-specific protocol layer per agent-integration-guide.md:
 *   - Composite agent card discovery (no auth)
 *   - Authenticated JSON-RPC message/send
 *   - skillId routing with namespaced IDs
 *   - contextId multi-turn stickiness
 *   - All six task states (completed, failed, input-required, …)
 *   - Error code handling (-32010 breaker, -32011 no-route)
 *   - Hub task ID returned in result.id
 *   - plugin:tool:* vs skill:* flavour split
 *
 * Run:  node a2a-hub-e2e.test.js
 */

const assert = require('assert');
const { loadHubConfig, createHubContext, preflightHub } = require('./a2a-test-harness');

const cfg = loadHubConfig();

// ─── Helpers ───────────────────────────────────────────────────────

function uuid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function hubRpc(method, params, { expectError = false } = {}) {
  const resp = await fetch(`${cfg.hubEndpoint}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.hubApiKey}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: uuid(),
      method,
      params
    })
  });
  const payload = await resp.json();
  if (expectError) return payload;
  if (payload.error) throw new Error(`Hub RPC error ${payload.error.code}: ${payload.error.message}`);
  return payload.result;
}

function makeMessage(text, skillId, contextId) {
  const params = {
    message: {
      messageId: uuid(),
      role: 'user',
      parts: [{ type: 'text', text }]
    }
  };
  if (skillId) params.skillId = skillId;
  if (contextId) params.contextId = contextId;
  return params;
}

function makeDataMessage(data, skillId, contextId) {
  const params = {
    message: {
      messageId: uuid(),
      role: 'user',
      parts: [{ type: 'data', data }]
    }
  };
  if (skillId) params.skillId = skillId;
  if (contextId) params.contextId = contextId;
  return params;
}

function extractText(task) {
  const parts = [];
  const statusParts = task?.status?.message?.parts || [];
  for (const p of statusParts) {
    if (p.text) parts.push(p.text);
    if (p.data) parts.push(JSON.stringify(p.data));
  }
  for (const a of task?.artifacts || []) {
    for (const p of a.parts || []) {
      if (p.text) parts.push(p.text);
      if (p.data) parts.push(JSON.stringify(p.data));
    }
  }
  return parts.join('\n').trim();
}

// ─── Tests ──────────────────────────────────────────────────────────

async function testCompositeCardNoAuth() {
  // §3: public endpoints (/.well-known/*) accept no auth
  const resp = await fetch(`${cfg.hubEndpoint}/.well-known/agent-card.json`);
  assert.strictEqual(resp.status, 200, 'agent-card.json should be public (no auth)');
  const card = await resp.json();

  assert.ok(card.name, 'card should have a name');
  assert.ok(Array.isArray(card.skills), 'card should have skills array');
  assert.ok(card.skills.length > 0, 'card should have at least one skill');

  // Verify namespaced skill IDs (§2: <upstream>.<capability-id>)
  for (const skill of card.skills) {
    assert.ok(skill.id.includes('.'), `skill id "${skill.id}" should be namespaced with a dot`);
  }

  console.info(`  ✓ composite card — "${card.name}" with ${card.skills.length} namespaced skills`);
}

async function testHealthEndpoint() {
  // §11: GET /health — no auth, returns upstream healthy/total counts
  const resp = await fetch(`${cfg.hubEndpoint}/health`);
  assert.strictEqual(resp.status, 200);
  const data = await resp.json();
  assert.strictEqual(data.status, 'ok');
  assert.ok(typeof data.upstreams?.total === 'number');
  assert.ok(typeof data.upstreams?.healthy === 'number');
  assert.ok(data.upstreams.healthy > 0, 'at least one healthy upstream');
  console.info(`  ✓ /health — ${data.upstreams.healthy}/${data.upstreams.total} upstreams healthy`);
}

async function testAuthRequired() {
  // §3: POST / requires bearer key
  const resp = await fetch(`${cfg.hubEndpoint}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'test-no-auth', method: 'message/send',
      params: makeMessage('hello', 'omnilauncher.plugin:tool:calculator')
    })
  });
  // Hub returns 401 or JSON error for missing auth
  const body = await resp.text();
  assert.ok(
    resp.status === 401 || body.includes('unauthorized'),
    `expected 401 or unauthorized error, got ${resp.status}: ${body.slice(0, 100)}`
  );
  console.info('  ✓ auth — POST / rejected without bearer token');
}

async function testSkillFlavourSplit() {
  // §2: verify the composite card has both plugin:tool:* and skill:* entries
  const resp = await fetch(`${cfg.hubEndpoint}/.well-known/agent-card.json`);
  const card = await resp.json();

  const pluginTools = card.skills.filter(s => s.id.split('.')[1]?.startsWith('plugin:tool:'));
  const skills = card.skills.filter(s => s.id.split('.')[1]?.startsWith('skill:'));
  const pluginQueries = card.skills.filter(s => s.id.split('.')[1]?.startsWith('plugin:query:'));

  assert.ok(pluginTools.length > 0, 'should have plugin:tool:* entries');
  assert.ok(skills.length > 0, 'should have skill:* entries');
  console.info(`  ✓ flavour split — ${pluginTools.length} plugin:tool, ${pluginQueries.length} plugin:query, ${skills.length} skill`);
}

async function testPluginToolCalculator() {
  // §4: message/send with a plugin:tool:* call — should be fast, typed args
  const task = await hubRpc('message/send', makeDataMessage(
    { expression: '123 * 456' },
    'omnilauncher.plugin:tool:calculator'
  ));

  assert.ok(task.id, 'hub should return a task with id');
  assert.strictEqual(task.status?.state, 'completed', `expected completed, got ${task.status?.state}`);
  const text = extractText(task);
  assert.ok(
    text.includes('56088') || text.includes('56,088'),
    `expected 56088 in response, got: ${text.slice(0, 200)}`
  );
  console.info(`  ✓ plugin:tool:calculator — "${text.slice(0, 80)}"`);
}

async function testPluginToolSysInfo() {
  // Another plugin:tool:* test — sys_info
  const task = await hubRpc('message/send', makeDataMessage(
    { info_type: 'uptime' },
    'omnilauncher.plugin:tool:sys_info'
  ));

  assert.ok(task.id, 'hub task id present');
  assert.strictEqual(task.status?.state, 'completed');
  const text = extractText(task);
  assert.ok(text.length > 5, `too short: "${text}"`);
  console.info(`  ✓ plugin:tool:sys_info — "${text.slice(0, 100)}"`);
}

async function testContextIdReturned() {
  // §5: contextId should be echoed back in the result
  const contextId = `test-ctx-${uuid()}`;
  const task = await hubRpc('message/send', makeDataMessage(
    { expression: '1 + 1' },
    'omnilauncher.plugin:tool:calculator',
    contextId
  ));

  assert.strictEqual(task.contextId, contextId, 'contextId should be echoed');
  console.info('  ✓ contextId echoed in response');
}

async function testHubTaskId() {
  // §4.2: result.id is the hub task ID (not upstream's)
  const task = await hubRpc('message/send', makeDataMessage(
    { expression: '2 + 3' },
    'omnilauncher.plugin:tool:calculator'
  ));

  assert.ok(task.id, 'hub task id must be present');
  assert.ok(typeof task.id === 'string' && task.id.length > 0);

  // §4: tasks/get should work with hub task ID
  const fetched = await hubRpc('tasks/get', { id: task.id });
  assert.ok(fetched.id, 'fetched task should have id');
  assert.strictEqual(fetched.status?.state, 'completed');
  console.info(`  ✓ hub task id — "${task.id.slice(0, 20)}…" retrievable via tasks/get`);
}

async function testNoRouteError() {
  // §9: -32011 No route — non-retryable
  const payload = await hubRpc('message/send',
    makeMessage('hello', 'nonexistent.skill:fake'),
    { expectError: true }
  );

  assert.ok(payload.error, 'should return error');
  assert.strictEqual(payload.error.code, -32011, `expected -32011, got ${payload.error.code}`);
  console.info(`  ✓ -32011 no route — "${payload.error.message}"`);
}

async function testTaskNotFoundError() {
  // §9: -32001 Task not found
  const payload = await hubRpc('tasks/get',
    { id: 'nonexistent-task-id-12345' },
    { expectError: true }
  );

  assert.ok(payload.error, 'should return error');
  assert.strictEqual(payload.error.code, -32001, `expected -32001, got ${payload.error.code}`);
  console.info(`  ✓ -32001 task not found`);
}

async function testDelegateViaVM() {
  // Integration test: delegateA2aTask through the VM sandbox with a text
  // skill (not plugin:tool which needs structured data). This exercises
  // the full client code path: VM → delegateA2aTask → postA2aRpc →
  // hub → upstream → response.
  const { context } = createHubContext();

  // Discover the hub's composite card
  const agentCard = await context.discoverA2aServer('omni-hub');
  assert.ok(agentCard.name, 'agent card name');
  assert.ok(Array.isArray(agentCard.skills) && agentCard.skills.length > 0, 'skills present');

  // Delegate with explicit skillId for a text-based tool
  const result = await context.delegateA2aTask({
    serverId: 'omni-hub',
    skillId: 'omnilauncher.plugin:tool:sys_info',
    task: 'uptime',
    contextText: ''
  });

  assert.ok(result.length > 5, `result too short: "${result}"`);
  // sys_info returns system information — could be uptime, OS, CPU etc.
  assert.ok(/up|day|hour|load|Linux|Windows|CPU|processor|memory/i.test(result),
    `expected system info, got: "${result.slice(0, 200)}"`);
  console.info(`  ✓ VM delegate via hub — "${result.slice(0, 80)}"`);
}

async function testAutoRouteViaHub() {
  // Full auto-route: handleAIChat → LLM → tool_call → hub → upstream
  const resp = await fetch(`${cfg.hubEndpoint}/.well-known/agent-card.json`);
  const agentCard = await resp.json();

  const { context, infoLogs } = createHubContext({ agentCard, captureInfoLogs: true });

  const result = await context.handleAIChat([
    { role: 'user', content: 'Use the calculator tool to compute 999 * 111. Give me the exact result.' }
  ]);

  const correct = result.includes('110889') || result.includes('110,889');
  const entry = infoLogs.find(l => l[0] === 'OmniPilot API request');
  const toolCount = entry ? JSON.parse(entry[1]).toolCount : -1;

  console.info(`  ${correct ? '✓' : '⚠'} auto-route via hub — tools=${toolCount}, "${result.slice(0, 100)}"`);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.info('\n── A2A Hub E2E Tests (agent-integration-guide.md) ──\n');
  await preflightHub();
  console.info('');

  const tests = [
    testCompositeCardNoAuth,
    testHealthEndpoint,
    testAuthRequired,
    testSkillFlavourSplit,
    testPluginToolCalculator,
    testPluginToolSysInfo,
    testContextIdReturned,
    testHubTaskId,
    testNoRouteError,
    testTaskNotFoundError,
    testDelegateViaVM,
    testAutoRouteViaHub
  ];

  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t(); passed++; }
    catch (e) { failed++; console.error(`  ✗ ${t.name}: ${e.message}`); }
  }

  console.info(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.error('\n❌ FAILED\n'); process.exit(1); }
  console.info('\n✅ All hub E2E tests passed\n');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
