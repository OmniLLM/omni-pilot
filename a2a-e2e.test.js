/**
 * A2A End-to-End test against a real OmniLauncher backend.
 *
 * Prerequisites:
 *   - OmniLauncher backend running: ./omnilauncher --server
 *   - A2A enabled in ~/.config/omnilauncher/settings.json (a2a_enabled: true)
 *   - OmniLLM proxy at localhost:5000 with a working model
 *
 * Run:  node a2a-e2e.test.js
 */

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const backgroundSource = fs.readFileSync('background.js', 'utf8');

// ─── Config ─────────────────────────────────────────────────────────

const A2A_ENDPOINT = 'http://127.0.0.1:1423';
const A2A_TOKEN = 'c1f08def479a15dfcf968d22f850f8089b31f2b669f658a9610c96c4de33ff9e';
const SERVER_ID = 'omnilauncher';

// ─── Background.js sandbox ──────────────────────────────────────────

function createE2eBackgroundContext() {
  const syncStore = {
    a2aServers: [
      { id: SERVER_ID, name: 'OmniLauncher', endpoint: A2A_ENDPOINT, enabled: true }
    ]
  };
  const localStore = {
    a2aServerTokens: { [SERVER_ID]: A2A_TOKEN }
  };

  const makeArea = store => ({
    get(keys, cb) {
      if (Array.isArray(keys)) {
        const result = Object.fromEntries(keys.map(key => [key, store[key]]));
        cb(result);
        return;
      }
      if (keys && typeof keys === 'object') {
        const result = { ...keys };
        for (const key of Object.keys(keys)) {
          if (Object.prototype.hasOwnProperty.call(store, key)) {
            result[key] = store[key];
          }
        }
        cb(result);
        return;
      }
      cb({ ...store });
    },
    set(values, cb = () => {}) {
      Object.assign(store, values);
      cb();
    },
    remove(keys, cb = () => {}) {
      for (const key of [].concat(keys)) delete store[key];
      cb();
    }
  });

  const context = {
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console: {
      info: (...args) => {},
      warn: (...args) => { /* silent */ },
      error: (...args) => console.error('[bg]', ...args)
    },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        sync: makeArea(syncStore),
        local: makeArea(localStore)
      }
    },
    fetch: globalThis.fetch
  };

  vm.createContext(context);
  vm.runInContext(backgroundSource, context);

  return { context, syncStore, localStore };
}

// ─── Tests ──────────────────────────────────────────────────────────

async function testDiscoverAgentCard() {
  const { context } = createE2eBackgroundContext();
  const card = await context.discoverA2aServer(SERVER_ID);

  assert.strictEqual(card.name, 'OmniLauncher');
  assert.ok(card.url, 'agent card should have url');
  assert.ok(Array.isArray(card.skills), 'agent card should have skills');
  assert.ok(card.skills.length > 0, 'agent card should have at least one skill');
  console.info(`  ✓ discovery — agent card: "${card.name}" with ${card.skills.length} skills`);
}

async function testDelegateSimpleTask() {
  const { context } = createE2eBackgroundContext();

  const result = await context.delegateA2aTask({
    serverId: SERVER_ID,
    task: 'What is 2 + 2? Reply with just the number.',
    contextText: ''
  });

  assert.ok(result, 'delegation should return a result');
  assert.ok(result.length > 0, 'result should have content');
  assert.ok(result.includes('4'), `expected "4" in result, got: ${result.slice(0, 200)}`);
  console.info(`  ✓ delegate simple task — result: "${result.slice(0, 80)}..."`);
}

async function testDelegateWithContextText() {
  const { context } = createE2eBackgroundContext();

  const result = await context.delegateA2aTask({
    serverId: SERVER_ID,
    task: 'Summarize the context in one sentence.',
    contextText: 'OmniPilot is a browser extension that provides AI-powered text actions. It supports multiple providers including GitHub Copilot and custom OpenAI-compatible endpoints.'
  });

  assert.ok(result, 'delegation should return a result');
  assert.ok(result.length > 10, `result too short: "${result}"`);
  console.info(`  ✓ delegate with context — result: "${result.slice(0, 100)}..."`);
}

async function testDelegateCalculatorSkill() {
  const { context } = createE2eBackgroundContext();

  // The OmniLauncher agent has a calculator tool — delegate a math task
  const result = await context.delegateA2aTask({
    serverId: SERVER_ID,
    task: 'Calculate: 123 * 456',
    contextText: ''
  });

  assert.ok(result, 'delegation should return a result');
  // 123 * 456 = 56088
  assert.ok(
    result.includes('56088') || result.includes('56,088'),
    `expected 56088 in result, got: ${result.slice(0, 200)}`
  );
  console.info(`  ✓ delegate calculator — result: "${result.slice(0, 100)}..."`);
}

async function testDelegateUnknownServerThrows() {
  const { context } = createE2eBackgroundContext();

  await assert.rejects(
    () => context.delegateA2aTask({
      serverId: 'nonexistent-server',
      task: 'hello',
      contextText: ''
    }),
    err => err.message.includes('not configured') || err.message.includes('not found')
  );
  console.info('  ✓ unknown server throws');
}

async function testDiscoveryUsesAuthToken() {
  // Verify that without token, the server rejects us (401)
  const response = await fetch(`${A2A_ENDPOINT}/.well-known/agent.json`);
  assert.strictEqual(response.status, 401, 'A2A server should require auth');

  // With token it should work (already tested in testDiscoverAgentCard)
  const authResponse = await fetch(`${A2A_ENDPOINT}/.well-known/agent.json`, {
    headers: { Authorization: `Bearer ${A2A_TOKEN}` }
  });
  assert.strictEqual(authResponse.status, 200, 'A2A server should accept valid token');
  console.info('  ✓ auth token required — 401 without, 200 with');
}

async function testDelegateTranslationTask() {
  const { context } = createE2eBackgroundContext();

  const result = await context.delegateA2aTask({
    serverId: SERVER_ID,
    task: 'Translate the following text to Chinese: "Hello, how are you today?"',
    contextText: ''
  });

  assert.ok(result, 'delegation should return a result');
  assert.ok(result.length > 0, 'result should have content');
  // Check for common Chinese characters that would appear in a translation
  const hasChinese = /[\u4e00-\u9fff]/.test(result);
  assert.ok(hasChinese, `expected Chinese characters in result, got: ${result.slice(0, 200)}`);
  console.info(`  ✓ delegate translation — result: "${result.slice(0, 100)}..."`);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.info('\n╔══════════════════════════════════════════════════╗');
  console.info('║  OmniPilot × OmniLauncher A2A End-to-End Tests  ║');
  console.info('╚══════════════════════════════════════════════════╝\n');
  console.info(`  A2A endpoint: ${A2A_ENDPOINT}`);
  console.info(`  Token: ${A2A_TOKEN.slice(0, 8)}...${A2A_TOKEN.slice(-8)}`);
  console.info('');

  // Pre-flight: check backend is up
  try {
    const health = await fetch('http://127.0.0.1:1422/health');
    const data = await health.json();
    assert.ok(data.ok, 'Backend health check should return ok');
    console.info('  ✓ backend health check passed\n');
  } catch (err) {
    console.error('  ✗ Backend not reachable at http://127.0.0.1:1422/health');
    console.error('    Start it: cd /data/tools/omnilauncher && ./src-tauri/target/release/omnilauncher --server');
    process.exit(1);
  }

  const tests = [
    testDiscoveryUsesAuthToken,
    testDiscoverAgentCard,
    testDelegateUnknownServerThrows,
    testDelegateSimpleTask,
    testDelegateWithContextText,
    testDelegateCalculatorSkill,
    testDelegateTranslationTask,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${test.name}: ${err.message}`);
      if (process.env.VERBOSE) console.error(err);
    }
  }

  console.info(`\n─────────────────────────────────────`);
  console.info(`  Results: ${passed} passed, ${failed} failed, ${tests.length} total`);

  if (failed > 0) {
    console.error('\n❌ Some A2A E2E tests failed\n');
    process.exit(1);
  } else {
    console.info('\n✅ All A2A E2E tests passed\n');
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:\n', err);
  process.exit(1);
});
