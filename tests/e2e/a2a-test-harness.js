/**
 * Shared test harness for A2A E2E tests.
 *
 * Provides:
 *   - loadConfig()       — reads OmniLauncher + OmniLLM config from disk
 *   - createContext(opts) — spins up a background.js VM sandbox with real fetch
 *   - preflight()         — checks backend, A2A, OmniLLM, returns agent card
 */

const fs = require('fs');
const vm = require('vm');
const os = require('os');
const path = require('path');

const backgroundSource = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'background.js'), 'utf8');

// ─── Config from disk ───────────────────────────────────────────────

function loadConfig() {
  const settingsPath = path.join(os.homedir(), '.config/omnilauncher/settings.json');
  const omnillmKeyPath = path.join(os.homedir(), '.config/omnillm/api-key');

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  return {
    a2aEndpoint: `http://127.0.0.1:${settings.a2a_port || 1423}`,
    a2aToken: settings.a2a_token,
    omnillmEndpoint: 'http://127.0.0.1:5000/v1',
    omnillmKey: fs.readFileSync(omnillmKeyPath, 'utf8').trim(),
    model: settings.ai_model || 'gpt-4o'
  };
}

// ─── Chrome storage mock ────────────────────────────────────────────

function makeStorageArea(store) {
  return {
    get(keys, cb) {
      if (Array.isArray(keys)) {
        cb(Object.fromEntries(keys.map(key => [key, store[key]])));
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
  };
}

// ─── Sandbox factory ────────────────────────────────────────────────

/**
 * Create a background.js VM context with real fetch.
 *
 * @param {object} opts
 * @param {object} opts.syncStore  — initial chrome.storage.sync contents
 * @param {object} opts.localStore — initial chrome.storage.local contents
 * @param {boolean} opts.captureInfoLogs — if true, capture console.info calls
 * @returns {{ context, syncStore, localStore, infoLogs }}
 */
function createContext({ syncStore = {}, localStore = {}, captureInfoLogs = false } = {}) {
  const infoLogs = [];

  const context = {
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console: {
      info: captureInfoLogs ? (...args) => infoLogs.push(args) : () => {},
      warn: () => {},
      error: (...args) => console.error('[bg]', ...args)
    },
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        sync: makeStorageArea(syncStore),
        local: makeStorageArea(localStore)
      }
    },
    fetch: globalThis.fetch
  };

  vm.createContext(context);
  vm.runInContext(backgroundSource, context);

  return { context, syncStore, localStore, infoLogs };
}

/**
 * Create a context pre-configured for A2A delegation tests.
 * Includes the OmniLauncher server in storage with optional agentCard.
 */
function createA2aContext({ agentCard = null, captureInfoLogs = false } = {}) {
  const cfg = loadConfig();
  return createContext({
    syncStore: {
      endpoint: cfg.omnillmEndpoint,
      apiKey: cfg.omnillmKey,
      model: cfg.model,
      apiShape: 'openai-compatible',
      providerType: 'custom-provider',
      a2aAutoRoute: true
    },
    localStore: {
      a2aServers: [{
        id: 'omnilauncher',
        name: 'OmniLauncher',
        endpoint: cfg.a2aEndpoint,
        enabled: true,
        agentCard
      }],
      a2aServerTokens: { omnilauncher: cfg.a2aToken }
    },
    captureInfoLogs
  });
}

// ─── Preflight checks ───────────────────────────────────────────────

/**
 * Verify all services are up. Returns the agent card on success.
 * Exits with code 1 on failure.
 */
async function preflight() {
  const cfg = loadConfig();

  try {
    const health = await fetch('http://127.0.0.1:1422/health');
    const data = await health.json();
    if (!data.ok) throw new Error('not ok');
    console.info('  ✓ OmniLauncher backend: UP');
  } catch {
    console.error('  ✗ OmniLauncher backend not running');
    console.error('    Start: cd /data/tools/omnilauncher && ./src-tauri/target/release/omnilauncher --server');
    process.exit(1);
  }

  let agentCard;
  try {
    // Try hub-style agent-card.json first, fall back to agent.json
    let resp = await fetch(`${cfg.a2aEndpoint}/.well-known/agent-card.json`, {
      headers: { Authorization: `Bearer ${cfg.a2aToken}` }
    });
    if (!resp.ok) {
      resp = await fetch(`${cfg.a2aEndpoint}/.well-known/agent.json`, {
        headers: { Authorization: `Bearer ${cfg.a2aToken}` }
      });
    }
    agentCard = await resp.json();
    console.info(`  ✓ A2A server: UP (${agentCard.skills?.length || 0} skills)`);
  } catch {
    console.error('  ✗ A2A server not responding');
    process.exit(1);
  }

  try {
    const resp = await fetch(`${cfg.omnillmEndpoint}/models`, {
      headers: { Authorization: `Bearer ${cfg.omnillmKey}` }
    });
    const data = await resp.json();
    if (!data.data) throw new Error('no models');
    console.info('  ✓ OmniLLM proxy: UP');
  } catch {
    console.error('  ✗ OmniLLM proxy not responding');
    process.exit(1);
  }

  return agentCard;
}

module.exports = { loadConfig, createContext, createA2aContext, preflight };
