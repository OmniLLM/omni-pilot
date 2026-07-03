/**
 * A2A End-to-End test against a real OmniLauncher backend.
 *
 * Tests the A2A protocol layer: discovery, auth, delegation (sync + with
 * context), error handling.
 *
 * Run:  node a2a-e2e.test.js
 */

const assert = require('assert');
const { loadConfig, createA2aContext, preflight } = require('./a2a-test-harness');

const cfg = loadConfig();

// ─── Tests ──────────────────────────────────────────────────────────

async function testDiscoverAgentCard() {
  const { context } = createA2aContext();
  const card = await context.discoverA2aServer('omnilauncher');

  assert.strictEqual(card.name, 'OmniLauncher');
  assert.ok(card.url, 'agent card should have url');
  assert.ok(Array.isArray(card.skills) && card.skills.length > 0);
  console.info(`  ✓ discovery — "${card.name}" with ${card.skills.length} skills`);
}

async function testDelegateSimpleTask() {
  const { context } = createA2aContext();
  const result = await context.delegateA2aTask({
    serverId: 'omnilauncher', task: 'What is 2 + 2? Reply with just the number.', contextText: ''
  });

  assert.ok(result.includes('4'), `expected "4", got: ${result.slice(0, 200)}`);
  console.info(`  ✓ delegate simple — "${result.slice(0, 80)}"`);
}

async function testDelegateWithContextText() {
  const { context } = createA2aContext();
  const result = await context.delegateA2aTask({
    serverId: 'omnilauncher',
    task: 'Summarize the context in one sentence.',
    contextText: 'OmniPilot is a browser extension that provides AI-powered text actions.'
  });

  assert.ok(result.length > 10, `result too short: "${result}"`);
  console.info(`  ✓ delegate with context — "${result.slice(0, 100)}"`);
}

async function testDelegateCalculator() {
  const { context } = createA2aContext();
  const result = await context.delegateA2aTask({
    serverId: 'omnilauncher', task: 'Calculate: 123 * 456', contextText: ''
  });

  assert.ok(result.includes('56088') || result.includes('56,088'),
    `expected 56088, got: ${result.slice(0, 200)}`);
  console.info(`  ✓ delegate calculator — "${result.slice(0, 100)}"`);
}

async function testDelegateTranslation() {
  const { context } = createA2aContext();
  const result = await context.delegateA2aTask({
    serverId: 'omnilauncher',
    task: 'Translate to Chinese: "Hello, how are you today?"', contextText: ''
  });

  assert.ok(/[\u4e00-\u9fff]/.test(result), `expected Chinese, got: ${result.slice(0, 200)}`);
  console.info(`  ✓ delegate translation — "${result.slice(0, 100)}"`);
}

async function testUnknownServerThrows() {
  const { context } = createA2aContext();
  await assert.rejects(
    () => context.delegateA2aTask({ serverId: 'nonexistent', task: 'hi', contextText: '' }),
    err => err.message.includes('not configured') || err.message.includes('not found')
  );
  console.info('  ✓ unknown server throws');
}

async function testAuthRequired() {
  const resp = await fetch(`${cfg.a2aEndpoint}/.well-known/agent.json`);
  assert.strictEqual(resp.status, 401);
  const authed = await fetch(`${cfg.a2aEndpoint}/.well-known/agent.json`, {
    headers: { Authorization: `Bearer ${cfg.a2aToken}` }
  });
  assert.strictEqual(authed.status, 200);
  console.info('  ✓ auth — 401 without token, 200 with');
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.info('\n── A2A Protocol E2E Tests ──\n');
  await preflight();
  console.info('');

  const tests = [
    testAuthRequired, testDiscoverAgentCard, testUnknownServerThrows,
    testDelegateSimpleTask, testDelegateWithContextText,
    testDelegateCalculator, testDelegateTranslation
  ];

  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t(); passed++; }
    catch (e) { failed++; console.error(`  ✗ ${t.name}: ${e.message}`); }
  }

  console.info(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.error('\n❌ FAILED\n'); process.exit(1); }
  console.info('\n✅ All passed\n');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
