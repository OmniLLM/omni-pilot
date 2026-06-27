/**
 * Quick A2A smoke test — ask a question only the local machine can answer.
 *
 * Run:  node a2a-local-question.test.js
 */

const assert = require('assert');
const { createA2aContext, preflight } = require('./a2a-test-harness');

async function main() {
  console.info('\n── A2A Local Question Smoke Test ──\n');
  const agentCard = await preflight();

  const question = 'What is the current system uptime and how much disk space '
    + 'is used on the root filesystem? Give me exact numbers.';

  console.info(`\n🧑 "${question}"\n`);

  const { context, infoLogs } = createA2aContext({ agentCard, captureInfoLogs: true });
  const result = await context.handleAIChat([{ role: 'user', content: question }]);

  const apiLog = infoLogs.find(l => l[0] === 'OmniPilot API request');
  if (apiLog) {
    const p = JSON.parse(apiLog[1]);
    console.info(`📡 model=${p.model}, tools=${p.toolCount}`);
  }

  console.info(`\n🤖 ${result}\n`);

  const hasRealData = /\d+/.test(result) && /uptime|day|hour|disk|used|free|GB|GiB|%/i.test(result);
  if (hasRealData) {
    console.info('✅ Real system data → auto-routed to OmniLauncher\n');
  } else {
    console.info('⚠️  May not have routed (generic answer)\n');
  }
}

main().catch(err => { console.error('❌', err); process.exit(1); });
