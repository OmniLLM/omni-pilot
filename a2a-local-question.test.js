/**
 * Quick A2A auto-route test: ask a question only the local agent can answer.
 */

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const backgroundSource = fs.readFileSync('background.js', 'utf8');

const A2A_ENDPOINT = 'http://127.0.0.1:1423';
const _settings = JSON.parse(fs.readFileSync(
  require('os').homedir() + '/.config/omnilauncher/settings.json', 'utf8'
));
const A2A_TOKEN = _settings.a2a_token;
const OMNILLM_ENDPOINT = 'http://127.0.0.1:5000/v1';
const OMNILLM_KEY = fs.readFileSync(
  require('os').homedir() + '/.config/omnillm/api-key', 'utf8'
).trim();

let cachedAgentCard = null;

function createCtx() {
  const logs = [];
  const syncStore = {
    endpoint: OMNILLM_ENDPOINT, apiKey: OMNILLM_KEY,
    model: 'gpt-4o', apiShape: 'openai-compatible',
    providerType: 'custom-provider', a2aAutoRoute: true,
    a2aServers: [{
      id: 'omnilauncher', name: 'OmniLauncher',
      endpoint: A2A_ENDPOINT, enabled: true,
      agentCard: cachedAgentCard
    }]
  };
  const localStore = { a2aServerTokens: { omnilauncher: A2A_TOKEN } };
  const makeArea = store => ({
    get(keys, cb) {
      if (Array.isArray(keys)) { cb(Object.fromEntries(keys.map(k => [k, store[k]]))); return; }
      if (keys && typeof keys === 'object') {
        const r = { ...keys }; for (const k of Object.keys(keys)) { if (k in store) r[k] = store[k]; } cb(r); return;
      }
      cb({ ...store });
    },
    set(v, cb = () => {}) { Object.assign(store, v); cb(); },
    remove(k, cb = () => {}) { for (const x of [].concat(k)) delete store[x]; cb(); }
  });
  const ctx = {
    URL, URLSearchParams, setTimeout, clearTimeout,
    console: { info: (...a) => logs.push(a), warn: () => {}, error: (...a) => console.error('[bg]', ...a) },
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { sync: makeArea(syncStore), local: makeArea(localStore) } },
    fetch: globalThis.fetch
  };
  vm.createContext(ctx);
  vm.runInContext(backgroundSource, ctx);
  return { ctx, logs };
}

async function main() {
  // Fetch agent card
  const resp = await fetch(`${A2A_ENDPOINT}/.well-known/agent.json`, {
    headers: { Authorization: `Bearer ${A2A_TOKEN}` }
  });
  cachedAgentCard = await resp.json();
  console.log(`Agent card loaded: ${cachedAgentCard.skills.length} skills\n`);

  // The question — only the local machine can answer this
  const question = 'What is the current system uptime and how much disk space is used on the root filesystem? Give me exact numbers.';

  console.log(`🧑 User asks:\n   "${question}"\n`);

  const { ctx, logs } = createCtx();
  const result = await ctx.handleAIChat([{ role: 'user', content: question }]);

  // Check if tools were injected
  const apiLog = logs.find(l => l[0] === 'OmniPilot API request');
  if (apiLog) {
    const p = JSON.parse(apiLog[1]);
    console.log(`📡 API call: model=${p.model}, tools=${p.toolCount}`);
  }

  console.log(`\n🤖 Response:\n${result}\n`);

  // Verify it has real system data, not a generic answer
  const hasNumbers = /\d+/.test(result);
  const hasUptimeOrDisk = /uptime|day|hour|disk|used|avail|free|GB|GiB|TB|TiB|\%/i.test(result);
  if (hasNumbers && hasUptimeOrDisk) {
    console.log('✅ Contains real system data → auto-routed to OmniLauncher successfully');
  } else {
    console.log('⚠️  Response might be a generic answer (no delegation)');
  }
}

main().catch(err => { console.error('❌', err); process.exit(1); });
