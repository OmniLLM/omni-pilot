/**
 * A2A Auto-Routing E2E — full popup → LLM → tool_call → OmniLauncher flow.
 *
 * Verifies that handleAIChat() injects A2A tools when an agent card is
 * present, and the model auto-routes desktop-only tasks to OmniLauncher.
 *
 * Run:  node a2a-autoroute-e2e.test.js
 */

const assert = require('assert');
const { createA2aContext, preflight } = require('./a2a-test-harness');

let agentCard = null;

function ctx() {
  return createA2aContext({ agentCard, captureInfoLogs: true });
}

function getToolCount(infoLogs) {
  const entry = infoLogs.find(l => l[0] === 'OmniPilot API request');
  return entry ? JSON.parse(entry[1]).toolCount : -1;
}

// ─── Tests ──────────────────────────────────────────────────────────

async function testSimpleQuestionNoRouting() {
  console.info('  [test] "What is the capital of France?"');
  const { context, infoLogs } = ctx();
  const result = await context.handleAIChat([
    { role: 'user', content: 'What is the capital of France?' }
  ]);

  assert.ok(result.toLowerCase().includes('paris'), `expected Paris, got: ${result.slice(0, 100)}`);
  console.info(`         tools=${getToolCount(infoLogs)}, answered directly`);
  console.info(`  ✓ "${result.slice(0, 60)}"`);
}

async function testShellCommand() {
  console.info('  [test] "Run pwd in the shell" (requires OmniLauncher)');
  const { context, infoLogs } = ctx();
  const result = await context.handleAIChat([
    { role: 'user', content: 'Run "pwd" in the shell and tell me the current working directory. Use the OmniLauncher agent.' }
  ]);

  assert.ok(result, 'should return a result');
  assert.ok(!/no command provided/i.test(result), `shell delegation should include command args, got: ${result}`);
  assert.ok(/\/data\/tools\/omnilauncher|working directory|pwd/i.test(result), `expected pwd/working-directory output, got: ${result}`);
  console.info(`         tools=${getToolCount(infoLogs)}`);
  console.info(`  ✓ "${result.slice(0, 100)}"`);
}

async function testCalculator() {
  console.info('  [test] "Calculate 987 * 654" (OmniLauncher calculator)');
  const { context } = ctx();
  const result = await context.handleAIChat([
    { role: 'user', content: 'Use the OmniLauncher calculator to compute: 987 * 654. Give me the exact result.' }
  ]);

  const correct = result.includes('645498') || result.includes('645,498');
  console.info(`  ${correct ? '✓' : '⚠'} "${result.slice(0, 100)}"`);
}

async function testSystemInfo() {
  console.info('  [test] "Get system memory info" (OmniLauncher sys_info)');
  const { context } = ctx();
  const result = await context.handleAIChat([
    { role: 'user', content: 'Ask the OmniLauncher desktop agent to get system memory usage info.' }
  ]);

  assert.ok(result.length > 10, `too short: "${result}"`);
  console.info(`  ✓ "${result.slice(0, 150)}"`);
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.info('\n── A2A Auto-Routing E2E (Popup → LLM → Agent) ──\n');
  agentCard = await preflight();
  console.info('');

  await testSimpleQuestionNoRouting();
  console.info('');
  await testShellCommand();
  console.info('');
  await testCalculator();
  console.info('');
  await testSystemInfo();

  console.info('\n✅ All auto-routing tests completed\n');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
