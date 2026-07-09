/**
 * Shared test harness for A2A E2E tests.
 *
 * Provides:
 *   - loadConfig()        — reads OmniLauncher + OmniLLM config from disk
 *   - loadHubConfig()     — reads Omni Agent Hub config (port 8222)
 *   - createContext(opts)  — spins up a background.js VM sandbox with real fetch
 *   - createA2aContext()   — context pre-configured for direct A2A delegation
 *   - createHubContext()   — context pre-configured for hub-based A2A delegation
 *   - preflight()          — checks backend, A2A, OmniLLM, returns agent card
 *   - preflightHub()       — checks hub health and returns composite agent card
 */

const fs = require('fs');
const vm = require('vm');
const os = require('os');
const path = require('path');
const yaml = require === undefined ? null : (() => { try { return require('js-yaml'); } catch { return null; } })();

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

/**
 * Load Omni Agent Hub config from its config.yaml on disk, falling back
 * to env vars if the file is absent. Returns the hub endpoint, api_key,
 * and an OmniLLM config block for wiring the LLM provider.
 */
function loadHubConfig() {
  // Try config.yaml from the hub repo or standard install location
  const candidatePaths = [
    path.join(os.homedir(), '.config/omni-agent-hub/config.yaml'),
    path.join(os.homedir(), 'repos/omni-agent-hub/config.yaml'),
    path.join(os.homedir(), '.omni-agent-hub/config.yaml'),
    '/data/tools/omni-agent-hub/config.local.yaml',
    '/data/tools/omni-agent-hub/config.yaml',
    '/etc/omni-agent-hub/config.yaml'
  ];

  let hubPort = 8222;
  let hubApiKey = '';

  for (const p of candidatePaths) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      // Simple YAML value extraction (avoids js-yaml dependency)
      const portMatch = raw.match(/^\s+port:\s*(\d+)/m);
      const keyMatch = raw.match(/^\s+api_key:\s*"?([^"\n]+)"?/m);
      if (portMatch) hubPort = Number(portMatch[1]);
      if (keyMatch) hubApiKey = keyMatch[1].trim();
      break;
    } catch {
      continue;
    }
  }

  // Fallback: env vars
  if (!hubApiKey && process.env.OMNI_HUB_API_KEY) {
    hubApiKey = process.env.OMNI_HUB_API_KEY;
  }
  if (process.env.OMNI_HUB_PORT) {
    hubPort = Number(process.env.OMNI_HUB_PORT);
  }

  if (!hubApiKey) {
    throw new Error(
      'Omni Agent Hub API key not found. Set OMNI_HUB_API_KEY or ensure '
      + '~/repos/omni-agent-hub/config.yaml exists with server.api_key.'
    );
  }

  // OmniLLM config — prefer env var, then file
  let omnillmKey = process.env.OMNILLM_API_KEY || '';
  if (!omnillmKey) {
    try {
      omnillmKey = fs.readFileSync(path.join(os.homedir(), '.config/omnillm/api-key'), 'utf8').trim();
    } catch {
      // OK if missing — some setups rely on env only
    }
  }

  return {
    hubEndpoint: `http://127.0.0.1:${hubPort}`,
    hubApiKey,
    omnillmEndpoint: 'http://127.0.0.1:5000/v1',
    omnillmKey,
    model: process.env.OMNILLM_MODEL || 'claude-sonnet-4-5'
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
 * Create a context pre-configured for direct A2A delegation tests
 * (bypasses the hub, connects to OmniLauncher's A2A port directly).
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

/**
 * Create a context pre-configured for hub-based A2A delegation tests.
 * The server entry points at the Omni Agent Hub (port 8222) and uses its
 * api_key as the bearer token. The agentCard parameter should be the
 * hub's composite card (from /.well-known/agent-card.json).
 */
function createHubContext({ agentCard = null, captureInfoLogs = false } = {}) {
  const cfg = loadHubConfig();
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
        id: 'omni-hub',
        name: 'Omni A2A Hub',
        endpoint: cfg.hubEndpoint,
        enabled: true,
        agentCard
      }],
      a2aServerTokens: { 'omni-hub': cfg.hubApiKey }
    },
    captureInfoLogs
  });
}

// ─── Preflight checks ───────────────────────────────────────────────

/**
 * Verify all services are up (direct A2A). Returns the agent card on success.
 * Exits with code 1 on failure.
 */
async function preflight() {
  const cfg = loadConfig();

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

/**
 * Verify the Omni Agent Hub is up and return its composite agent card.
 * Checks: hub /health, composite agent-card.json (no auth), OmniLLM proxy.
 */
async function preflightHub() {
  const cfg = loadHubConfig();

  // 1. Hub health
  try {
    const resp = await fetch(`${cfg.hubEndpoint}/health`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(`status: ${data.status}`);
    console.info(`  ✓ Hub /health: UP (${data.upstreams?.healthy}/${data.upstreams?.total} upstreams healthy)`);
  } catch (err) {
    console.error(`  ✗ Hub not responding at ${cfg.hubEndpoint}/health: ${err.message}`);
    process.exit(1);
  }

  // 2. Composite agent card (public — no auth required)
  let agentCard;
  try {
    const resp = await fetch(`${cfg.hubEndpoint}/.well-known/agent-card.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    agentCard = await resp.json();
    const skillCount = agentCard.skills?.length || 0;
    console.info(`  ✓ Hub composite card: ${agentCard.name} (${skillCount} skills)`);
  } catch (err) {
    console.error(`  ✗ Hub composite card unavailable: ${err.message}`);
    process.exit(1);
  }

  // 3. OmniLLM proxy (needed for the LLM provider when auto-routing)
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

module.exports = { loadConfig, loadHubConfig, createContext, createA2aContext, createHubContext, preflight, preflightHub };
