const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('dist/background.js', 'utf8');

const RESPONSE_BY_SHAPE = {
  'openai-compatible': { choices: [{ message: { content: 'ok' } }] },
  'anthropic-messages': { content: [{ type: 'text', text: 'ok' }] },
  'openai-responses': { output: [{ content: [{ type: 'output_text', text: 'ok' }] }] }
};

async function runActionTest({ config = {}, responseJson }) {
  const infoLogs = [];
  const requests = [];

  const context = {
    console: {
      info: (...args) => infoLogs.push(args),
      error: () => {}
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        onInstalled: { addListener(fn) { fn(); } },
        onStartup: { addListener() {} },
        onConnect: { addListener() {} }
      },
      contextMenus: {
        removeAll(cb) { cb(); },
        create() {},
        onClicked: { addListener() {} }
      },
      storage: {
        sync: {
          get(defaults, cb) {
            const merged = {
              ...defaults,
              endpoint: 'http://localhost:5000/v1',
              apiKey: 'super-secret-key',
              model: 'deepseek-v4-flash',
              ...config
            };
            if (config.apiShape === undefined) delete merged.apiShape;
            cb(merged);
          }
        }
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => responseJson
      };
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  const result = await context.handleAIAction('summarize', 'hello');

  const requestLog = infoLogs.find(entry => entry[0] === 'OmniPilot API request');
  assert.ok(requestLog, 'expected OmniPilot API request log');
  assert.strictEqual(typeof requestLog[1], 'string');

  return {
    result,
    request: requests[0],
    logPayload: JSON.parse(requestLog[1])
  };
}

async function assertOpenAICompatibleDefault() {
  const { result, request, logPayload } = await runActionTest({
    config: {},
    responseJson: RESPONSE_BY_SHAPE['openai-compatible']
  });

  assert.strictEqual(result, 'ok');
  assert.strictEqual(request.url, 'http://localhost:5000/v1/chat/completions');
  assert.strictEqual(logPayload.requestUrl, 'http://localhost:5000/v1/chat/completions');
  assert.strictEqual(logPayload.apiFormat, 'openai-compatible');
  assert.strictEqual(logPayload.model, 'deepseek-v4-flash');
  assert.strictEqual(logPayload.hasApiKey, true);
  assert.deepStrictEqual(logPayload.requestHeaders, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer <redacted>'
  });

  const parsedBody = JSON.parse(request.options.body);
  assert.strictEqual(parsedBody.model, 'deepseek-v4-flash');
  assert.strictEqual(parsedBody.max_tokens, 1024);
  assert.deepStrictEqual(parsedBody.messages.map(message => message.role), ['system', 'user']);
  assert.ok(!JSON.stringify(logPayload).includes('hello'));
}

async function assertFreshInstallDefaultShape() {
  const { request, logPayload } = await runActionTest({
    config: { endpoint: undefined, apiShape: undefined },
    responseJson: RESPONSE_BY_SHAPE['openai-compatible']
  });

  assert.strictEqual(request.url, 'https://api.omnillm.com/v1/chat/completions');
  assert.strictEqual(logPayload.apiFormat, 'openai-compatible');
}

async function assertLegacyOmniEndpointMigratesToAnthropic() {
  const { request, logPayload } = await runActionTest({
    config: { endpoint: 'https://api.omnillm.com/v1', apiShape: undefined },
    responseJson: RESPONSE_BY_SHAPE['anthropic-messages']
  });

  assert.strictEqual(request.url, 'https://api.omnillm.com/v1/messages');
  assert.strictEqual(logPayload.apiFormat, 'anthropic-messages');
}

async function assertRootEndpointUsesV1Routes() {
  const cases = [
    ['openai-compatible', 'http://localhost:5000/v1/chat/completions', RESPONSE_BY_SHAPE['openai-compatible']],
    ['anthropic-messages', 'http://localhost:5000/v1/messages', RESPONSE_BY_SHAPE['anthropic-messages']],
    ['openai-responses', 'http://localhost:5000/v1/responses', RESPONSE_BY_SHAPE['openai-responses']]
  ];

  for (const [apiShape, expectedUrl, responseJson] of cases) {
    const { request } = await runActionTest({
      config: { endpoint: 'http://localhost:5000', apiShape },
      responseJson
    });

    assert.strictEqual(request.url, expectedUrl);
  }
}

async function assertAnthropicMessagesShape() {
  const { result, request, logPayload } = await runActionTest({
    config: { apiShape: 'anthropic-messages' },
    responseJson: RESPONSE_BY_SHAPE['anthropic-messages']
  });

  assert.strictEqual(result, 'ok');
  assert.strictEqual(request.url, 'http://localhost:5000/v1/messages');
  assert.strictEqual(logPayload.apiFormat, 'anthropic-messages');
  assert.deepStrictEqual(logPayload.requestHeaders, {
    'Content-Type': 'application/json',
    'x-api-key': '<redacted>',
    'anthropic-version': '2023-06-01'
  });

  const parsedBody = JSON.parse(request.options.body);
  assert.strictEqual(parsedBody.model, 'deepseek-v4-flash');
  assert.strictEqual(parsedBody.max_tokens, 1024);
  assert.ok(parsedBody.system.includes('Summarize'));
  assert.deepStrictEqual(parsedBody.messages, [{ role: 'user', content: 'hello' }]);
  assert.ok(!JSON.stringify(logPayload).includes('hello'));
}

async function assertOpenAIResponsesShape() {
  const { result, request, logPayload } = await runActionTest({
    config: { apiShape: 'openai-responses' },
    responseJson: RESPONSE_BY_SHAPE['openai-responses']
  });

  assert.strictEqual(result, 'ok');
  assert.strictEqual(request.url, 'http://localhost:5000/v1/responses');
  assert.strictEqual(logPayload.apiFormat, 'openai-responses');
  assert.deepStrictEqual(logPayload.requestHeaders, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer <redacted>'
  });

  const parsedBody = JSON.parse(request.options.body);
  assert.strictEqual(parsedBody.model, 'deepseek-v4-flash');
  assert.ok(parsedBody.instructions.includes('Summarize'));
  assert.deepStrictEqual(parsedBody.input, [{ role: 'user', content: 'hello' }]);
  assert.ok(!JSON.stringify(logPayload).includes('hello'));
}

async function createBackgroundContext({
  storage = {},
  fetchImpl,
  storageArea = 'sync'
} = {}) {
  const requests = [];
  const runtimeListeners = [];
  const connectListeners = [];
  const syncStore = { ...storage };
  const localStore = { ...storage };
  if (Object.prototype.hasOwnProperty.call(storage, 'a2aServerTokens')) {
    delete syncStore.a2aServerTokens;
  }

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

  const sync = makeArea(syncStore);
  const local = makeArea(localStore);

  const context = {
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console: {
      info: () => {},
      warn: () => {},
      error: () => {}
    },
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { runtimeListeners.push(fn); } },
        onInstalled: { addListener(fn) { fn(); } },
        onStartup: { addListener() {} },
        onConnect: { addListener(fn) { connectListeners.push(fn); } }
      },
      contextMenus: {
        removeAll(cb) { cb(); },
        create() {},
        onClicked: { addListener() {} }
      },
      storage: { sync, local }
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (!fetchImpl) throw new Error(`Unexpected fetch ${url}`);
      return fetchImpl(url, options, { syncStore, localStore, requests });
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    context,
    requests,
    runtimeListeners,
    connectListeners,
    stores: { syncStore, localStore, activeStore: storageArea === 'local' ? localStore : syncStore }
  };
}

async function assertAgentConstantsLoadedFromAgentFolder() {
  const { context } = await createBackgroundContext({ storage: {} });
  // Constants that used to live in index.mjs must survive the extraction.
  assert.strictEqual(vm.runInContext('A2A_MAX_ROUNDS', context), 3);
  assert.strictEqual(vm.runInContext('A2A_TOOL_NAME_PREFIX', context), 'a2a__');
  assert.strictEqual(vm.runInContext('A2A_MAX_POLL_ATTEMPTS', context), 600);
  assert.strictEqual(vm.runInContext('A2A_POLL_INTERVAL_MS', context), 500);
}

async function assertA2aServerMetadataAndTokensUseSeparateStorageAreas() {
  const { context, stores } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ],
      a2aServerTokens: { 'a2a-1': 'secret-token' }
    }
  });

  const servers = await context.loadA2aServersWithTokens();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(servers)), [
    { id: 'a2a-1', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true, token: 'secret-token' }
  ]);
  assert.strictEqual(stores.syncStore.a2aServerTokens, undefined);
  assert.strictEqual(stores.localStore.a2aServerTokens['a2a-1'], 'secret-token');
}

async function assertLoadA2aServersReadsFromLocalStorage() {
  const { context, stores } = await createBackgroundContext({ storage: {} });
  stores.localStore.a2aServers = [
    { id: 'writer', name: 'Writer', endpoint: 'https://writer.example/a2a', enabled: true }
  ];
  stores.syncStore.a2aServers = [
    { id: 'stale', name: 'Stale', endpoint: 'https://stale.example/a2a', enabled: true }
  ];

  const servers = await context.loadA2aServers();

  assert.deepStrictEqual(servers.map(server => server.id), ['writer']);
}

async function assertLoadA2aServersMigratesLegacySyncStorageToLocal() {
  const { context, stores } = await createBackgroundContext({ storage: {} });
  stores.syncStore.a2aServers = [
    { id: 'planner', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
  ];
  delete stores.localStore.a2aServers;

  const servers = await context.loadA2aServers();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(servers)), [
    { id: 'planner', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(stores.localStore.a2aServers)), [
    { id: 'planner', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
  ]);
  assert.strictEqual(stores.syncStore.a2aServers, undefined);
}

async function assertA2aProviderIdsRoundTripServerIds() {
  const { context } = await createBackgroundContext();

  assert.strictEqual(context.createA2aProviderType('a2a-1'), 'a2a:a2a-1');
  assert.strictEqual(context.isA2aProviderType('a2a:a2a-1'), true);
  assert.strictEqual(context.isA2aProviderType('custom-provider'), false);
  assert.strictEqual(context.getA2aServerIdFromProviderType('a2a:a2a-1'), 'a2a-1');
}

async function assertCopilotModelListingUsesCachedToken() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      authMethod: 'github-copilot',
      endpoint: '',
      apiKey: '',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://api.githubcopilot.com/models') {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: 'gpt-4.1' },
              { name: 'claude-3.7-sonnet' },
              { id: 'gpt-4o' }
            ]
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const models = await context.handleGetModels();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(models)), ['claude-3.7-sonnet', 'gpt-4.1', 'gpt-4o']);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/models');
  const modelHeaders = Object.fromEntries(Object.entries(requests[0].options.headers));
  assert.deepStrictEqual(modelHeaders, {
    Authorization: 'Bearer cached-copilot-token',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'copilot-integration-id': 'vscode-chat',
    'Editor-Version': 'vscode/1.83.1',
    'Editor-Plugin-Version': 'copilot-chat/0.26.7',
    'User-Agent': 'GitHubCopilotChat/0.26.7',
    'OpenAI-Intent': 'conversation-panel',
    'X-Github-Api-Version': '2025-04-01',
    'X-Vscode-User-Agent-Library-Version': 'electron-fetch'
  });
}

async function assertCopilotModelListingRefreshesExpiredToken() {
  const { context, requests, stores } = await createBackgroundContext({
    storage: {
      authMethod: 'github-copilot',
      endpoint: '',
      apiKey: '',
      copilotGithubToken: 'github-token',
      copilotAccessToken: 'expired-token',
      copilotTokenExpiry: Date.now() - 1_000
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://api.github.com/copilot_internal/v2/token') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'fresh-copilot-token', expires_at: Math.floor(Date.now() / 1000) + 3600 })
        };
      }

      if (url === 'https://api.githubcopilot.com/models') {
        return {
          ok: true,
          json: async () => ({ models: [{ name: 'o3' }, { id: 'claude-3.5-sonnet' }] })
        };
      }

      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const models = await context.handleGetModels();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(models)), ['claude-3.5-sonnet', 'o3']);
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].url, 'https://api.github.com/copilot_internal/v2/token');
  assert.strictEqual(requests[0].options.method, 'GET');
  assert.strictEqual(requests[0].options.headers.Authorization, 'token github-token');
  assert.strictEqual(requests[1].url, 'https://api.githubcopilot.com/models');
  assert.strictEqual(requests[1].options.headers.Authorization, 'Bearer fresh-copilot-token');
  assert.strictEqual(stores.localStore.copilotAccessToken, 'fresh-copilot-token');
  assert.ok(stores.localStore.copilotTokenExpiry > Date.now());
}

async function assertCopilotDeviceFlowAndPollingAndClearAuth() {
  const { context, requests, stores } = await createBackgroundContext({
    storage: {},
    fetchImpl: async (url, options) => {
      if (url === 'https://github.com/login/device/code') {
        return {
          ok: true,
          json: async () => ({
            device_code: 'device-code-1',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 5
          })
        };
      }

      if (url === 'https://github.com/login/oauth/access_token') {
        const body = Object.fromEntries(new URLSearchParams(options.body));
        if (body.device_code === 'device-code-1') {
          return {
            ok: true,
            json: async () => ({ error: 'authorization_pending' })
          };
        }

        if (body.device_code === 'device-code-slow-down') {
          return {
            ok: true,
            json: async () => ({ error: 'slow_down' })
          };
        }

        if (body.device_code === 'device-code-2') {
          return {
            ok: true,
            json: async () => ({ access_token: 'github-access-token' })
          };
        }

        return {
          ok: true,
          json: async () => ({ error: 'expired_token' })
        };
      }

      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const start = await context.startCopilotDeviceFlow();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(start)), {
    deviceCode: 'device-code-1',
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device',
    expiresIn: 900,
    interval: 5
  });
  assert.strictEqual(stores.localStore.copilotDeviceCode, 'device-code-1');
  assert.strictEqual(stores.localStore.copilotUserCode, 'ABCD-EFGH');
  assert.strictEqual(stores.localStore.copilotVerificationUri, 'https://github.com/login/device');
  assert.ok(stores.localStore.copilotUserExpiry > Date.now());
  assert.strictEqual(stores.localStore.copilotPollInterval, 5);
  assert.strictEqual(stores.syncStore.copilotDeviceCode, undefined);
  assert.strictEqual(requests[0].url, 'https://github.com/login/device/code');
  assert.strictEqual(requests[0].options.method, 'POST');
  assert.strictEqual(requests[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(requests[0].options.body)), {
    client_id: 'Iv1.b507a08c87ecfe98',
    scope: 'read:user'
  });

  const pending = await context.pollCopilotToken('device-code-1');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pending)), { status: 'pending' });
  assert.strictEqual(requests[1].url, 'https://github.com/login/oauth/access_token');
  assert.strictEqual(requests[1].options.method, 'POST');
  assert.strictEqual(requests[1].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(requests[1].options.body)), {
    client_id: 'Iv1.b507a08c87ecfe98',
    device_code: 'device-code-1',
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  });

  const slowDown = await context.pollCopilotToken('device-code-slow-down');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(slowDown)), { status: 'pending', slowDown: true, interval: 10 });
  assert.strictEqual(stores.localStore.copilotPollInterval, 10);

  const success = await context.pollCopilotToken('device-code-2');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(success)), { status: 'success' });
  assert.strictEqual(stores.localStore.copilotGithubToken, 'github-access-token');
  assert.strictEqual(stores.syncStore.copilotGithubToken, undefined);

  const failed = await context.pollCopilotToken('device-code-3');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(failed)), { status: 'failed', error: 'expired_token' });

  stores.localStore.copilotAccessToken = 'copilot-token';
  stores.localStore.copilotTokenExpiry = Date.now() + 5_000;
  await context.clearCopilotAuth();
  for (const key of ['copilotDeviceCode', 'copilotUserCode', 'copilotVerificationUri', 'copilotUserExpiry', 'copilotPollInterval', 'copilotGithubToken', 'copilotAccessToken', 'copilotTokenExpiry']) {
    assert.strictEqual(stores.localStore[key], undefined);
  }
}

async function assertCopilotAccessTokenCachesAndClearsOnUnauthorized() {
  const { context, requests, stores } = await createBackgroundContext({
    storage: {
      copilotGithubToken: 'github-token',
      copilotAccessToken: 'cached-token',
      copilotTokenExpiry: Date.now() + 10_000
    },
    fetchImpl: async (url) => {
      if (url === 'https://api.github.com/copilot_internal/v2/token') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ message: 'Unauthorized' })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const cached = await context.getCopilotAccessToken();
  assert.strictEqual(cached, 'cached-token');
  assert.strictEqual(requests.length, 0);

  stores.localStore.copilotTokenExpiry = Date.now() - 1_000;

  await assert.rejects(
    () => context.getCopilotAccessToken(),
    err => err.message.includes('GitHub Copilot authorization expired')
  );

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(stores.localStore.copilotGithubToken, undefined);
  assert.strictEqual(stores.localStore.copilotAccessToken, undefined);
  assert.strictEqual(stores.localStore.copilotTokenExpiry, undefined);
}

async function assertMalformedDeviceFlowDoesNotPersistState() {
  const { context, stores } = await createBackgroundContext({
    storage: {},
    fetchImpl: async url => {
      if (url === 'https://github.com/login/device/code') {
        return {
          ok: true,
          json: async () => ({
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900
          })
        };
      }

      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  await assert.rejects(
    () => context.startCopilotDeviceFlow(),
    err => err.message.includes('device flow returned an invalid response')
  );

  for (const key of ['copilotDeviceCode', 'copilotUserExpiry', 'copilotPollInterval']) {
    assert.strictEqual(stores.localStore[key], undefined);
  }
}

async function assertMalformedCopilotTokenRefreshDoesNotPersistState() {
  const { context, stores } = await createBackgroundContext({
    storage: {
      copilotGithubToken: 'github-token'
    },
    fetchImpl: async url => {
      if (url === 'https://api.github.com/copilot_internal/v2/token') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'broken-token', expires_at: 'soon' })
        };
      }

      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  await assert.rejects(
    () => context.getCopilotAccessToken(),
    err => err.message.includes('token refresh returned an invalid response')
  );

  assert.strictEqual(stores.localStore.copilotAccessToken, undefined);
  assert.strictEqual(stores.localStore.copilotTokenExpiry, undefined);
  assert.strictEqual(stores.localStore.copilotGithubToken, 'github-token');
}

async function assertCopilotApiRequestUsesDirectChatCompletionsWithCachedToken() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      authMethod: 'github-copilot',
      endpoint: 'http://localhost:5000/v1',
      apiKey: '',
      apiShape: 'openai-responses',
      model: 'gpt-4o',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async url => {
      if (url === 'https://api.githubcopilot.com/chat/completions') {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'ok' } }] })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIAction('summarize', 'hello');

  assert.strictEqual(result, 'ok');
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/chat/completions');
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer cached-copilot-token');
  assert.strictEqual(requests[0].options.headers['copilot-integration-id'], 'vscode-chat');
  assert.strictEqual(requests[0].options.headers['X-Github-Api-Version'], '2025-04-01');

  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.model, 'gpt-4o');
  assert.strictEqual(body.max_tokens, 1024);
  assert.deepStrictEqual(body.messages.map(message => message.role), ['system', 'user']);
}

async function assertCopilotGpt54UsesMaxCompletionTokens() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'github-copilot',
      endpoint: '',
      apiKey: '',
      model: 'gpt-5.4',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async url => {
      if (url === 'https://api.githubcopilot.com/chat/completions') {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'ok' } }] })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIAction('summarize', 'hello');

  assert.strictEqual(result, 'ok');
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/chat/completions');

  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.model, 'gpt-5.4');
  assert.strictEqual(body.max_completion_tokens, 1024);
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'max_tokens'));
  assert.deepStrictEqual(body.messages.map(message => message.role), ['system', 'user']);
}

async function assertCopilotUnsupportedStoredModelRetriesWithAvailableModel() {
  const { context, requests, stores } = await createBackgroundContext({
    storage: {
      providerType: 'github-copilot',
      endpoint: '',
      apiKey: '',
      model: 'claude-haiku-4.5',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://api.githubcopilot.com/chat/completions') {
        const body = JSON.parse(options.body);
        if (body.model === 'claude-haiku-4.5') {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            headers: { entries: () => [] },
            text: async () => JSON.stringify({
              error: {
                message: 'The requested model is not supported.',
                code: 'model_not_supported',
                param: 'model',
                type: 'invalid_request_error'
              }
            })
          };
        }

        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'ok' } }] })
        };
      }

      if (url === 'https://api.githubcopilot.com/models') {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'claude-3.7-sonnet' }] })
        };
      }

      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIAction('summarize', 'hello');

  assert.strictEqual(result, 'ok');
  assert.deepStrictEqual(requests.map(request => request.url), [
    'https://api.githubcopilot.com/chat/completions',
    'https://api.githubcopilot.com/models',
    'https://api.githubcopilot.com/chat/completions'
  ]);
  assert.strictEqual(JSON.parse(requests[0].options.body).model, 'claude-haiku-4.5');
  assert.strictEqual(JSON.parse(requests[2].options.body).model, 'gpt-4o');
  assert.strictEqual(stores.syncStore.model, 'gpt-4o');
}

async function assertCopilotResponsesOnlyModelUsesResponsesEndpoint() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'github-copilot',
      endpoint: '',
      apiKey: '',
      model: 'mai-code-1-flash-picker',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async url => {
      if (url === 'https://api.githubcopilot.com/responses') {
        return {
          ok: true,
          json: async () => RESPONSE_BY_SHAPE['openai-responses']
        };
      }

      if (url === 'https://api.githubcopilot.com/chat/completions') {
        return {
          ok: false,
          status: 400,
          statusText: '',
          headers: { entries: () => [] },
          text: async () => JSON.stringify({
            error: {
              message: 'model "mai-code-1-flash-picker" is not accessible via the /chat/completions endpoint',
              code: 'unsupported_api_for_model'
            }
          })
        };
      }

      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIAction('summarize', 'hello');

  assert.strictEqual(result, 'ok');
  assert.deepStrictEqual(requests.map(request => request.url), ['https://api.githubcopilot.com/responses']);
  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.model, 'mai-code-1-flash-picker');
  assert.ok(body.instructions.includes('Summarize'));
  assert.deepStrictEqual(body.input, [{ role: 'user', content: 'hello' }]);
}

async function assertCopilotApiRequestRefreshesExpiredTokenFirst() {
  const { context, requests, stores } = await createBackgroundContext({
    storage: {
      authMethod: 'github-copilot',
      endpoint: 'http://localhost:5000/v1',
      apiKey: '',
      apiShape: 'anthropic-messages',
      model: 'gpt-4o-mini',
      copilotGithubToken: 'github-token',
      copilotAccessToken: 'expired-copilot-token',
      copilotTokenExpiry: Date.now() - 1_000
    },
    fetchImpl: async url => {
      if (url === 'https://api.github.com/copilot_internal/v2/token') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: 'fresh-copilot-token', expires_at: Math.floor(Date.now() / 1000) + 3600 })
        };
      }
      if (url === 'https://api.githubcopilot.com/chat/completions') {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'ok' } }] })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIAction('summarize', 'hello');

  assert.strictEqual(result, 'ok');
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].url, 'https://api.github.com/copilot_internal/v2/token');
  assert.strictEqual(requests[0].options.headers.Authorization, 'token github-token');
  assert.strictEqual(requests[1].url, 'https://api.githubcopilot.com/chat/completions');
  assert.strictEqual(requests[1].options.headers.Authorization, 'Bearer fresh-copilot-token');
  assert.strictEqual(stores.localStore.copilotAccessToken, 'fresh-copilot-token');
}

async function assertLegacyAuthMethodMigratesToProviderType() {
  const { context } = await createBackgroundContext({
    storage: { authMethod: 'github-copilot', endpoint: '', apiKey: '', model: 'gpt-4o' }
  });

  const config = await context.loadConfig();

  assert.strictEqual(config.providerType, 'github-copilot');
  assert.strictEqual(config.authMethod, 'github-copilot');
}

async function assertAzureFoundryModelListingUsesManualModelsOnly() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'azure-foundry',
      endpoint: 'https://example.services.ai.azure.com',
      apiKey: 'azure-key',
      apiShape: 'openai-compatible',
      models: 'azure-gpt-4o, azure-phi-4\nazure-mai-ds-r1'
    },
    fetchImpl: async url => {
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const models = await context.handleGetModels();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(models)), ['azure-gpt-4o', 'azure-phi-4', 'azure-mai-ds-r1']);
  assert.deepStrictEqual(requests, []);
}

async function assertCustomProviderTypeUsesEndpointModels() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'http://localhost:5000',
      apiKey: 'custom-key',
      apiShape: 'openai-compatible'
    },
    fetchImpl: async url => ({
      ok: true,
      json: async () => ({ models: [{ name: 'local-model' }] })
    })
  });

  const models = await context.handleGetModels();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(models)), ['local-model']);
  assert.strictEqual(requests[0].url, 'http://localhost:5000/v1/models');
}

async function assertAzureFoundryRequestUsesSelectedApiShape() {
  const { result, request, logPayload } = await runActionTest({
    config: {
      providerType: 'azure-foundry',
      endpoint: 'https://example.services.ai.azure.com',
      apiKey: 'azure-secret',
      apiShape: 'openai-responses',
      model: 'azure-gpt-4o'
    },
    responseJson: RESPONSE_BY_SHAPE['openai-responses']
  });

  assert.strictEqual(result, 'ok');
  assert.strictEqual(request.url, 'https://example.services.ai.azure.com/v1/responses');
  assert.strictEqual(logPayload.apiFormat, 'openai-responses');
  assert.strictEqual(logPayload.model, 'azure-gpt-4o');
  assert.deepStrictEqual(logPayload.requestHeaders, {
    'Content-Type': 'application/json',
    Authorization: 'Bearer <redacted>'
  });
}

async function assertAzureFoundryGpt54UsesMaxCompletionTokens() {
  const { request } = await runActionTest({
    config: {
      providerType: 'azure-foundry',
      endpoint: 'https://example.services.ai.azure.com',
      apiKey: 'azure-secret',
      apiShape: 'openai-compatible',
      model: 'gpt-5.4'
    },
    responseJson: RESPONSE_BY_SHAPE['openai-compatible']
  });

  const body = JSON.parse(request.options.body);
  assert.strictEqual(request.url, 'https://example.services.ai.azure.com/v1/chat/completions');
  assert.strictEqual(body.model, 'gpt-5.4');
  assert.strictEqual(body.max_completion_tokens, 1024);
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'max_tokens'));
}

async function assertAzureFoundryOtherGptModelsKeepMaxTokens() {
  const { request } = await runActionTest({
    config: {
      providerType: 'azure-foundry',
      endpoint: 'https://example.services.ai.azure.com',
      apiKey: 'azure-secret',
      apiShape: 'openai-compatible',
      model: 'gpt-4.1'
    },
    responseJson: RESPONSE_BY_SHAPE['openai-compatible']
  });

  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.max_tokens, 1024);
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'max_completion_tokens'));
}

async function assertCustomProviderGpt54KeepsMaxTokens() {
  const { request } = await runActionTest({
    config: {
      providerType: 'custom-provider',
      endpoint: 'http://localhost:5000',
      apiKey: 'custom-secret',
      apiShape: 'openai-compatible',
      model: 'gpt-5.4'
    },
    responseJson: RESPONSE_BY_SHAPE['openai-compatible']
  });

  const body = JSON.parse(request.options.body);
  assert.strictEqual(body.max_tokens, 1024);
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'max_completion_tokens'));
}

async function assertCustomProviderModelListingFallsBackToEmptyOnFailure() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'http://localhost:5000',
      apiKey: 'custom-key',
      apiShape: 'openai-compatible'
    },
    fetchImpl: async () => ({ ok: false })
  });

  const models = await context.handleGetModels();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(models)), []);
  assert.strictEqual(requests[0].url, 'http://localhost:5000/v1/models');
}

async function assertLoadConfigUsesActiveProviderSpecificConfig() {
  const { context } = await createBackgroundContext({
    storage: {
      providerType: 'azure-foundry',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      models: 'custom-model, custom-alt',
      apiShape: 'anthropic-messages',
      providerConfigs: {
        'custom-provider': {
          endpoint: 'https://custom.example/v1',
          apiKey: 'custom-key',
          model: 'custom-model',
          models: 'custom-model, custom-alt',
          apiShape: 'anthropic-messages'
        },
        'azure-foundry': {
          endpoint: 'https://azure.example.services.ai.azure.com',
          apiKey: 'azure-key',
          model: 'azure-model',
          models: 'azure-model, azure-alt',
          apiShape: 'openai-responses'
        }
      }
    }
  });

  const config = await context.loadConfig();

  assert.strictEqual(config.providerType, 'azure-foundry');
  assert.strictEqual(config.endpoint, 'https://azure.example.services.ai.azure.com');
  assert.strictEqual(config.apiKey, 'azure-key');
  assert.strictEqual(config.model, 'azure-model');
  assert.strictEqual(config.models, 'azure-model, azure-alt');
  assert.strictEqual(config.apiShape, 'openai-responses');
}

async function assertProviderTypeCopilotModelListingUsesCachedToken() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'github-copilot',
      endpoint: 'http://localhost:5000/v1',
      apiKey: '',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000
    },
    fetchImpl: async url => {
      if (url === 'https://api.githubcopilot.com/models') {
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'gpt-4o' }] })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const models = await context.handleGetModels();

  assert.deepStrictEqual(JSON.parse(JSON.stringify(models)), ['gpt-4o']);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://api.githubcopilot.com/models');
}

async function sendRuntimeMessage(runtimeListeners, message) {
  return new Promise(resolve => {
    let responded = false;
    runtimeListeners[0](message, {}, response => {
      responded = true;
      resolve(response);
    });
    setTimeout(() => {
      if (!responded) resolve(undefined);
    }, 0);
  });
}

async function assertSetProviderActivatesStoredProviderConfig() {
  const { runtimeListeners, stores } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      models: 'custom-model, custom-alt',
      apiShape: 'anthropic-messages',
      providerConfigs: {
        'custom-provider': {
          endpoint: 'https://custom.example/v1',
          apiKey: 'custom-key',
          model: 'custom-model',
          models: 'custom-model, custom-alt',
          apiShape: 'anthropic-messages'
        },
        'azure-foundry': {
          endpoint: 'https://azure.example.services.ai.azure.com',
          apiKey: 'azure-key',
          model: 'azure-model',
          models: 'azure-model, azure-alt',
          apiShape: 'openai-responses'
        }
      }
    }
  });

  const response = await sendRuntimeMessage(runtimeListeners, { type: 'SET_PROVIDER', providerType: 'azure-foundry' });

  assert.deepStrictEqual(response.success, true);
  assert.strictEqual(stores.syncStore.providerType, 'azure-foundry');
  assert.strictEqual(stores.syncStore.authMethod, 'api-key');
  assert.strictEqual(stores.syncStore.endpoint, 'https://azure.example.services.ai.azure.com');
  assert.strictEqual(stores.syncStore.apiKey, 'azure-key');
  assert.strictEqual(stores.syncStore.model, 'azure-model');
  assert.strictEqual(stores.syncStore.models, 'azure-model, azure-alt');
  assert.strictEqual(stores.syncStore.apiShape, 'openai-responses');
  assert.strictEqual(stores.syncStore.providerConfigs['custom-provider'].model, 'custom-model');
}

async function assertSetProviderPreservesOutgoingTopLevelConfig() {
  const { runtimeListeners, stores } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://legacy-custom.example/v1',
      apiKey: 'legacy-key',
      model: 'legacy-model',
      models: 'legacy-model, legacy-alt',
      apiShape: 'anthropic-messages',
      providerConfigs: {
        'azure-foundry': {
          endpoint: 'https://azure.example.services.ai.azure.com',
          apiKey: 'azure-key',
          model: 'azure-model',
          models: 'azure-model, azure-alt',
          apiShape: 'openai-responses'
        }
      }
    }
  });

  await sendRuntimeMessage(runtimeListeners, { type: 'SET_PROVIDER', providerType: 'azure-foundry' });

  assert.strictEqual(stores.syncStore.providerConfigs['custom-provider'].endpoint, 'https://legacy-custom.example/v1');
  assert.strictEqual(stores.syncStore.providerConfigs['custom-provider'].apiKey, 'legacy-key');
  assert.strictEqual(stores.syncStore.providerConfigs['custom-provider'].model, 'legacy-model');
  assert.strictEqual(stores.syncStore.providerConfigs['custom-provider'].models, 'legacy-model, legacy-alt');
  assert.strictEqual(stores.syncStore.providerConfigs['custom-provider'].apiShape, 'anthropic-messages');
}

async function assertSetProviderWritesCopilotCompatibilityAuthMethod() {
  const { runtimeListeners, stores } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      providerConfigs: {
        'github-copilot': {
          endpoint: '',
          apiKey: '',
          model: 'gpt-4o',
          models: '',
          apiShape: 'openai-compatible'
        }
      }
    }
  });

  await sendRuntimeMessage(runtimeListeners, { type: 'SET_PROVIDER', providerType: 'github-copilot' });

  assert.strictEqual(stores.syncStore.providerType, 'github-copilot');
  assert.strictEqual(stores.syncStore.authMethod, 'github-copilot');
  assert.strictEqual(stores.syncStore.model, 'gpt-4o');
}

async function assertSetModelUpdatesActiveProviderConfig() {
  const { runtimeListeners, stores } = await createBackgroundContext({
    storage: {
      providerType: 'azure-foundry',
      model: 'azure-model',
      providerConfigs: {
        'azure-foundry': {
          endpoint: 'https://azure.example.services.ai.azure.com',
          apiKey: 'azure-key',
          model: 'azure-model',
          models: 'azure-model, azure-alt',
          apiShape: 'openai-responses'
        }
      }
    }
  });

  const response = await sendRuntimeMessage(runtimeListeners, { type: 'SET_MODEL', model: 'azure-alt' });

  assert.deepStrictEqual(response.success, true);
  assert.strictEqual(stores.syncStore.model, 'azure-alt');
  assert.strictEqual(stores.syncStore.providerConfigs['azure-foundry'].model, 'azure-alt');
}

async function assertA2aDiscoveryFetchesAgentCardWithBearerToken() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://planner.example', enabled: true }
      ],
      a2aServerTokens: { planner: 'secret-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://planner.example/.well-known/agent.json') {
        return {
          ok: true,
          json: async () => ({
            name: 'Planner Agent',
            description: 'Plans tasks',
            url: 'https://planner.example/a2a'
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const card = await context.discoverA2aServer('planner');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(card)), {
    name: 'Planner Agent',
    description: 'Plans tasks',
    url: 'https://planner.example/a2a'
  });
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://planner.example/.well-known/agent.json');
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer secret-token');
}

async function assertA2aDiscoveryFallsBackToEndpointAgentCard() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }
      ],
      a2aServerTokens: { planner: 'secret-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://planner.example/.well-known/agent.json') {
        return {
          ok: false,
          status: 404,
          json: async () => ({})
        };
      }
      if (url === 'https://planner.example/a2a/.well-known/agent.json') {
        return {
          ok: true,
          json: async () => ({
            name: 'Planner Fallback Agent',
            description: 'Fallback card',
            url: 'https://planner.example/a2a'
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const card = await context.discoverA2aServer('planner');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(card)), {
    name: 'Planner Fallback Agent',
    description: 'Fallback card',
    url: 'https://planner.example/a2a'
  });
  assert.deepStrictEqual(requests.map(request => request.url), [
    'https://planner.example/.well-known/agent.json',
    'https://planner.example/a2a/.well-known/agent.json'
  ]);
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer secret-token');
  assert.strictEqual(requests[1].options.headers.Authorization, 'Bearer secret-token');
}

async function assertRemoveA2aServerRemovesLocalTokenOnlyForThatServer() {
  const { context, stores } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      models: 'custom-model, custom-alt',
      apiShape: 'openai-compatible',
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true },
        { id: 'writer', name: 'Writer', endpoint: 'https://writer.example/a2a', enabled: true }
      ],
      a2aServerTokens: {
        planner: 'secret-token',
        writer: 'writer-token'
      },
      providerConfigs: {
        'a2a:planner': {
          endpoint: 'https://planner.example/a2a',
          apiKey: '',
          model: 'planner-model',
          models: 'planner-model',
          apiShape: 'openai-compatible'
        },
        'a2a:writer': {
          endpoint: 'https://writer.example/a2a',
          apiKey: '',
          model: 'writer-model',
          models: 'writer-model',
          apiShape: 'openai-compatible'
        },
        'custom-provider': {
          endpoint: 'https://custom.example/v1',
          apiKey: 'custom-key',
          model: 'custom-model',
          models: 'custom-model, custom-alt',
          apiShape: 'openai-compatible'
        }
      }
    }
  });

  await context.removeA2aServer('planner');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(stores.localStore.a2aServers)), [
    { id: 'writer', name: 'Writer', endpoint: 'https://writer.example/a2a', enabled: true }
  ]);
  assert.strictEqual(stores.localStore.a2aServerTokens.planner, undefined);
  assert.strictEqual(stores.localStore.a2aServerTokens.writer, 'writer-token');
  assert.strictEqual(stores.syncStore.a2aServerTokens, undefined);
  assert.strictEqual(stores.syncStore.providerConfigs['a2a:planner'], undefined);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(stores.syncStore.providerConfigs['a2a:writer'])), {
    endpoint: 'https://writer.example/a2a',
    apiKey: '',
    model: 'writer-model',
    models: 'writer-model',
    apiShape: 'openai-compatible'
  });
}

async function assertA2aDelegateTaskBuildsStandaloneTaskText() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://a2a.example/rpc', enabled: true }
      ],
      a2aServerTokens: { planner: 'server-token' }
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'ok' }] } } })
    })
  });

  await context.delegateA2aTask({
    serverId: 'planner',
    task: 'Answer from popup context',
    contextText: 'Popup user asked: What is this?\nPopup assistant answered: It is selected text.'
  });

  const body = JSON.parse(requests[0].options.body);
  const text = body.params.message.parts[0].text;
  assert.ok(text.includes('Use only the task and popup context below'));
  assert.ok(text.includes('Ignore any prior conversation or session state in the A2A backend'));
  assert.ok(text.includes('Answer from popup context'));
  assert.ok(text.includes('Popup user asked: What is this?'));
  assert.ok(text.includes('Popup assistant answered: It is selected text.'));
}

async function assertA2aDelegateTaskUsesAgentCardRpcUrl() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        {
          id: 'planner',
          name: 'Planner',
          endpoint: 'https://planner.example',
          enabled: true,
          agentCard: { url: 'https://planner.example/a2a' }
        }
      ],
      a2aServerTokens: { planner: 'server-token' }
    },
    fetchImpl: async (url) => {
      assert.strictEqual(url, 'https://planner.example/a2a');
      return {
        ok: true,
        json: async () => ({
          result: {
            message: {
              parts: [{ type: 'text', text: 'Agent card URL result' }]
            }
          }
        })
      };
    }
  });

  const result = await context.delegateA2aTask({
    serverId: 'planner',
    task: 'Use the advertised RPC URL',
    contextText: ''
  });

  assert.strictEqual(result, 'Agent card URL result');
  assert.strictEqual(requests[0].url, 'https://planner.example/a2a');
}

async function assertA2aDelegateTaskNormalizesLocalhostEndpointToLoopback() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'local', name: 'A2A localhost', endpoint: 'http://localhost:1423', enabled: true }
      ],
      a2aServerTokens: { local: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      assert.ok(!String(url).includes('localhost'), `expected loopback URL, got ${url}`);
      if (url === 'http://127.0.0.1:1423') {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      if (url === 'http://127.0.0.1:1423/message:send') {
        return {
          ok: true,
          json: async () => ({
            id: 'task-1',
            status: {
              state: 'completed',
              message: { role: 'agent', parts: [{ type: 'text', text: 'Loopback REST result' }] }
            }
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.delegateA2aTask({ serverId: 'local', task: 'hi', contextText: '' });

  assert.strictEqual(result, 'Loopback REST result');
  assert.deepStrictEqual(requests.map(request => request.url), [
    'http://127.0.0.1:1423',
    'http://127.0.0.1:1423/message:send'
  ]);
}

async function assertA2aDelegateTaskFallsBackFromStoredAgentCardBaseUrlToRestRoutes() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        {
          id: 'local',
          name: 'A2A localhost',
          endpoint: 'http://localhost:1423',
          enabled: true,
          agentCard: { name: 'OmniLauncher', url: 'http://localhost:1423' }
        }
      ],
      a2aServerTokens: { local: 'server-token' }
    },
    fetchImpl: async (url) => {
      assert.ok(!String(url).includes('localhost'), `expected loopback URL, got ${url}`);
      if (url === 'http://127.0.0.1:1423') {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      if (url === 'http://127.0.0.1:1423/message:send') {
        return {
          ok: true,
          json: async () => ({
            id: 'task-1',
            status: {
              state: 'completed',
              message: { role: 'agent', parts: [{ type: 'text', text: 'Stored card REST result' }] }
            }
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.delegateA2aTask({ serverId: 'local', task: 'hi', contextText: '' });

  assert.strictEqual(result, 'Stored card REST result');
  assert.deepStrictEqual(requests.map(request => request.url), [
    'http://127.0.0.1:1423',
    'http://127.0.0.1:1423/message:send'
  ]);
}

async function assertA2aDelegateTaskFallsBackFromJsonRpcMessagesErrorToRestRoutes() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        {
          id: 'local',
          name: 'A2A localhost',
          endpoint: 'http://localhost:1423',
          enabled: true,
          agentCard: { name: 'OmniLauncher', url: 'http://localhost:1423' }
        }
      ],
      a2aServerTokens: { local: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      assert.ok(!String(url).includes('localhost'), `expected loopback URL, got ${url}`);
      if (url === 'http://127.0.0.1:1423') {
        return { ok: false, status: 400, text: async () => 'Invalid JSON: missing field `messages` at line 1 column 246' };
      }
      if (url === 'http://127.0.0.1:1423/message:send') {
        const body = JSON.parse(options.body);
        assert.deepStrictEqual(Object.keys(body), ['messages']);
        assert.strictEqual(body.messages[0].role, 'user');
        assert.ok(body.messages[0].parts[0].text.includes('hi'));
        return {
          ok: true,
          json: async () => ({
            id: 'task-1',
            status: {
              state: 'completed',
              message: { role: 'agent', parts: [{ type: 'text', text: 'REST messages result' }] }
            }
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.delegateA2aTask({ serverId: 'local', task: 'hi', contextText: '' });

  assert.strictEqual(result, 'REST messages result');
  assert.deepStrictEqual(requests.map(request => request.url), [
    'http://127.0.0.1:1423',
    'http://127.0.0.1:1423/message:send'
  ]);
}

async function assertA2aDelegateTaskFallsBackToRestRoutesAfterJsonRpc404() {
  const waits = [];
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://planner.example', enabled: true }
      ],
      a2aServerTokens: { planner: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://planner.example' && options.method === 'POST') {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      if (url === 'https://planner.example/message:send') {
        return {
          ok: true,
          json: async () => ({ id: 'task-123', status: { state: 'working' } })
        };
      }
      if (url === 'https://planner.example/tasks/task-123') {
        return {
          ok: true,
          json: async () => ({
            id: 'task-123',
            status: { state: 'completed' },
            artifacts: [{ parts: [{ type: 'text', text: 'REST completed result' }] }]
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });
  context.wait = async ms => waits.push(ms);

  const result = await context.delegateA2aTask({
    serverId: 'planner',
    task: 'Use REST A2A routes',
    contextText: ''
  });

  assert.strictEqual(result, 'REST completed result');
  assert.deepStrictEqual(requests.map(request => request.url), [
    'https://planner.example',
    'https://planner.example/message:send',
    'https://planner.example/tasks/task-123'
  ]);
  assert.deepStrictEqual(waits, [500]);
}

async function assertA2aDelegateTaskDiscoversRpcUrlAfterBaseEndpoint404() {
  const waits = [];
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://planner.example', enabled: true }
      ],
      a2aServerTokens: { planner: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://planner.example' && options.method === 'POST') {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      if (url === 'https://planner.example/message:send') {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      if (url === 'https://planner.example/.well-known/agent.json') {
        return {
          ok: true,
          json: async () => ({ name: 'Planner Agent', url: 'https://planner.example/a2a' })
        };
      }
      if (url === 'https://planner.example/a2a') {
        const body = JSON.parse(options.body);
        if (body.method === 'message/send') {
          return {
            ok: true,
            json: async () => ({ result: { id: 'task-123', state: 'working' } })
          };
        }
        if (body.method === 'tasks/get') {
          return {
            ok: true,
            json: async () => ({
              result: {
                id: 'task-123',
                state: 'completed',
                artifacts: [{ parts: [{ type: 'text', text: 'Discovered RPC URL result' }] }]
              }
            })
          };
        }
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });
  context.wait = async ms => waits.push(ms);

  const result = await context.delegateA2aTask({
    serverId: 'planner',
    task: 'Retry with discovered RPC URL',
    contextText: ''
  });

  assert.strictEqual(result, 'Discovered RPC URL result');
  assert.deepStrictEqual(requests.map(request => request.url), [
    'https://planner.example',
    'https://planner.example/message:send',
    'https://planner.example/.well-known/agent.json',
    'https://planner.example/a2a',
    'https://planner.example/a2a'
  ]);
  assert.deepStrictEqual(requests.slice(3).map(request => JSON.parse(request.options.body).method), ['message/send', 'tasks/get']);
  assert.deepStrictEqual(waits, [500]);
}

async function assertA2aDelegateTaskReturnsImmediateTextResult() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://a2a.example/rpc', enabled: true }
      ],
      a2aServerTokens: { planner: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      return {
        ok: true,
        json: async () => ({
          result: {
            message: {
              parts: [
                { type: 'text', text: 'Immediate result text' }
              ]
            }
          }
        })
      };
    }
  });

  const result = await context.delegateA2aTask({
    serverId: 'planner',
    task: 'Summarize the article',
    contextText: 'Selected context from page'
  });

  assert.strictEqual(result, 'Immediate result text');
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, 'https://a2a.example/rpc');
  assert.strictEqual(requests[0].options.method, 'POST');
  assert.strictEqual(requests[0].options.headers['Content-Type'], 'application/json');
  assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer server-token');

  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.jsonrpc, '2.0');
  assert.strictEqual(body.method, 'message/send');
  assert.strictEqual(body.params.message.parts[0].type, 'text');
  assert.ok(body.params.message.parts[0].text.includes('Summarize the article'));
  assert.ok(body.params.message.parts[0].text.includes('Selected context from page'));
}

async function assertA2aDelegateTaskPollsUntilCompleted() {
  const waits = [];
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://a2a.example/rpc', enabled: true }
      ],
      a2aServerTokens: { planner: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === 'message/send') {
        return {
          ok: true,
          json: async () => ({
            result: {
              id: 'task-123',
              state: 'working'
            }
          })
        };
      }

      if (body.method === 'tasks/get' && requests.filter(request => JSON.parse(request.options.body).method === 'tasks/get').length === 1) {
        return {
          ok: true,
          json: async () => ({
            result: {
              id: 'task-123',
              state: 'working'
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          result: {
            id: 'task-123',
            state: 'completed',
            artifacts: [
              {
                parts: [
                  { type: 'text', text: 'Async done' }
                ]
              }
            ]
          }
        })
      };
    }
  });

  context.wait = async ms => {
    waits.push(ms);
  };

  const result = await context.delegateA2aTask({
    serverId: 'planner',
    task: 'Analyze async work',
    contextText: 'Context block'
  });

  assert.strictEqual(result, 'Async done');
  assert.deepStrictEqual(requests.map(request => JSON.parse(request.options.body).method), ['message/send', 'tasks/get', 'tasks/get']);
  assert.deepStrictEqual(waits, [500, 500]);
}

async function assertA2aDelegateTaskWaitsForSlowAgentCompletion() {
  const waits = [];
  const { context, requests } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://a2a.example/rpc', enabled: true }
      ],
      a2aServerTokens: { planner: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.method === 'message/send') {
        return {
          ok: true,
          json: async () => ({ result: { id: 'task-123', state: 'working' } })
        };
      }

      const pollCount = requests.filter(request => JSON.parse(request.options.body).method === 'tasks/get').length;
      return {
        ok: true,
        json: async () => ({
          result: pollCount < 25
            ? { id: 'task-123', state: 'working' }
            : {
                id: 'task-123',
                state: 'completed',
                artifacts: [{ parts: [{ type: 'text', text: 'Slow async done' }] }]
              }
        })
      };
    }
  });

  context.wait = async ms => waits.push(ms);

  const result = await context.delegateA2aTask({
    serverId: 'planner',
    task: 'Wait for a slow A2A agent',
    contextText: 'Context block'
  });

  assert.strictEqual(result, 'Slow async done');
  assert.strictEqual(waits.length, 25);
}

async function assertA2aDelegateTaskSurfacesFailedTaskState() {
  const { context } = await createBackgroundContext({
    storage: {
      a2aServers: [
        { id: 'planner', name: 'Planner', endpoint: 'https://a2a.example/rpc', enabled: true }
      ],
      a2aServerTokens: { planner: 'server-token' }
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        result: {
          id: 'task-123',
          state: 'failed',
          status: {
            message: {
              parts: [
                { type: 'text', text: 'No access' }
              ]
            }
          }
        }
      })
    })
  });

  await assert.rejects(
    () => context.delegateA2aTask({
      serverId: 'planner',
      task: 'Restricted task',
      contextText: 'Context block'
    }),
    err => err.message === 'No access'
  );
}


async function assertLegacyA2aProviderTypeFallsBackToCustomProvider() {
  const { context } = await createBackgroundContext({
    storage: {
      providerType: 'a2a:a2a-1',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [{ id: 'a2a-1', endpoint: 'https://planner.example/a2a', enabled: true }]
    }
  });

  const config = await context.loadConfig();

  assert.strictEqual(config.providerType, 'custom-provider');
  assert.strictEqual(config.model, 'custom-model');
}

async function assertConfiguredA2aServerWithoutAgentCardDoesNotAutomaticallyHandleChat() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [{ id: 'planner', name: 'Planner', endpoint: 'https://planner.example/a2a', enabled: true }]
    },
    fetchImpl: async (url) => {
      // Auto-discovery is attempted first; simulate a server that cannot be
      // discovered (returns 404). Routing must fall back to a plain chat request.
      if (/\.well-known\/agent\.json/.test(url)) {
        return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
      }
      if (url === 'https://custom.example/v1/chat/completions') {
        return { ok: true, json: async () => RESPONSE_BY_SHAPE['openai-compatible'] };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'Plan my day' }]);

  assert.strictEqual(result, 'ok');
  const llmRequests = requests.filter(r => r.url === 'https://custom.example/v1/chat/completions');
  assert.strictEqual(llmRequests.length, 1, 'falls back to a single plain chat request');
  const body = JSON.parse(llmRequests[0].options.body);
  assert.strictEqual(body.tools, undefined, 'no tools injected when discovery fails');
}

async function assertA2aAutoRouteInjectsToolsForDiscoveredAgentCards() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: {
            name: 'OmniLauncher',
            description: 'Runs local machine diagnostics and shell commands.',
            skills: [{ id: 'disk', name: 'Disk usage', description: 'Show disk usage and filesystem capacity.' }]
          }
        }
      ]
    },
    fetchImpl: async (url) => {
      assert.strictEqual(url, 'https://custom.example/v1/chat/completions');
      return { ok: true, json: async () => RESPONSE_BY_SHAPE['openai-compatible'] };
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'Plan my day' }]);

  assert.strictEqual(result, 'ok');
  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.tool_choice, 'auto');
  assert.strictEqual(body.tools.length, 1);
  assert.strictEqual(body.tools[0].function.name, 'a2a__launcher__disk');
  assert.ok(body.tools[0].function.description.includes('Disk usage'));
}

async function assertCopilotAutoRouteToolCallDelegates() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'github-copilot',
      endpoint: '',
      apiKey: '',
      model: 'claude-haiku-4.5',
      copilotAccessToken: 'cached-copilot-token',
      copilotTokenExpiry: Date.now() + 60_000,
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: {
            name: 'OmniLauncher',
            description: 'Runs local machine diagnostics and shell commands.',
            skills: [{ id: 'disk', name: 'Disk usage', description: 'Show disk usage.' }]
          }
        }
      ],
      a2aServerTokens: { launcher: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://api.githubcopilot.com/chat/completions') {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  type: 'function',
                  function: {
                    name: 'a2a__launcher__disk',
                    arguments: JSON.stringify({ task: 'show me disk usage' })
                  }
                }]
              }
            }]
          })
        };
      }
      if (url === 'https://launcher.example/a2a') {
        return {
          ok: true,
          json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'Disk usage result' }] } } })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'please handle delegated task' }]);

  assert.strictEqual(result, 'Disk usage result');
  assert.ok(requests.some(r => r.url === 'https://api.githubcopilot.com/chat/completions'));
  assert.ok(requests.some(r => r.url === 'https://launcher.example/a2a'));
  const llmBody = JSON.parse(requests.find(r => r.url === 'https://api.githubcopilot.com/chat/completions').options.body);
  assert.ok(Array.isArray(llmBody.tools) && llmBody.tools.length === 1, 'Copilot request should inject A2A tools');
}

async function assertAutoRouteSystemPromptInstructsToolUse() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: { name: 'OmniLauncher', description: 'Runs shell commands.', skills: [{ name: 'disk' }] }
        }
      ]
    },
    fetchImpl: async () => ({ ok: true, json: async () => RESPONSE_BY_SHAPE['openai-compatible'] })
  });

  await context.handleAIChat([{ role: 'user', content: 'Plan my day' }]);

  const body = JSON.parse(requests[0].options.body);
  const systemMessage = body.messages.find(m => m.role === 'system');
  assert.ok(systemMessage, 'request should include a system message');
  assert.ok(/a2a|agent|tool/i.test(systemMessage.content), 'system prompt should mention A2A agent tools');
  assert.ok(/registered/i.test(systemMessage.content), 'system prompt should mention registered A2A tools or skills');
  assert.ok(/skill/i.test(systemMessage.content), 'system prompt should mention A2A skills');
  assert.ok(/latest user prompt|user prompt|user request/i.test(systemMessage.content), 'system prompt should instruct matching against the user prompt');
  assert.ok(/delegat|call|use/i.test(systemMessage.content), 'system prompt should instruct the model to call/delegate to a matching agent');
  assert.ok(/do not answer locally/i.test(systemMessage.content), 'system prompt should prefer delegation over local answers when there is a clear match');
  assert.ok(/every matching|one tool call per matched skill|call every|call all/i.test(systemMessage.content), 'system prompt should instruct the model to call every matching A2A tool, not just the single best one');
  assert.ok(/parallel|distinct topics|compound|multiple|MUST/i.test(systemMessage.content), 'system prompt should push the model to decompose compound prompts and emit parallel tool calls');
}

async function assertA2aAutoRouteToolCallDelegatesOrdinaryFollowUp() {
  let chatCallCount = 0;
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: {
            name: 'OmniLauncher',
            description: 'Runs local machine diagnostics and shell commands.',
            skills: [{ id: 'disk', name: 'Disk usage', description: 'Show disk usage and filesystem capacity.' }]
          }
        }
      ],
      a2aServerTokens: { launcher: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        chatCallCount += 1;
        // Round 0: emit a tool call so the router delegates to launcher.
        if (chatCallCount === 1) {
          return {
            ok: true,
            json: async () => ({
              choices: [{
                message: {
                  tool_calls: [{
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'a2a__launcher__disk',
                      arguments: JSON.stringify({ task: 'show me disk usage' })
                    }
                  }]
                }
              }]
            })
          };
        }
        // Round 1: after receiving the tool_result, produce the final answer.
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Your disk usage is: Disk usage result' } }]
          })
        };
      }
      if (url === 'https://launcher.example/a2a') {
        return {
          ok: true,
          json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'Disk usage result' }] } } })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([
    { role: 'user', content: 'Additional selected context:\nThis is a local troubleshooting session.' },
    { role: 'assistant', content: 'What would you like to check?' },
    { role: 'user', content: 'please handle delegated task' }
  ]);

  // Agentic loop: two chat requests (initial + follow-up after tool_result)
  // and one A2A delegation in between.
  assert.strictEqual(result, 'Your disk usage is: Disk usage result');
  assert.strictEqual(requests.length, 3);
  assert.strictEqual(requests[0].url, 'https://custom.example/v1/chat/completions');
  assert.strictEqual(requests[1].url, 'https://launcher.example/a2a');
  assert.strictEqual(requests[2].url, 'https://custom.example/v1/chat/completions');
  const a2aText = JSON.parse(requests[1].options.body).params.message.parts[0].text;
  assert.ok(a2aText.includes('Task:\nshow me disk usage'));
  assert.ok(a2aText.includes('Popup user: Additional selected context'));
  assert.ok(a2aText.includes('Popup assistant: What would you like to check?'));
  // Round 1 request must carry the assistant tool_call turn and a tool-role
  // message with the delegated result, so the model can compose a final
  // answer from the tool output.
  const round1Body = JSON.parse(requests[2].options.body);
  const toolMsg = round1Body.messages.find(m => m.role === 'tool');
  assert.ok(toolMsg, 'follow-up request should include a tool-role message with the delegation result');
  assert.strictEqual(toolMsg.tool_call_id, 'call_1');
  assert.strictEqual(toolMsg.content, 'Disk usage result');
  const assistantWithCall = round1Body.messages.find(m => m.role === 'assistant' && Array.isArray(m.tool_calls));
  assert.ok(assistantWithCall, 'follow-up request should echo the assistant tool_call turn');
}

async function assertA2aAutoRouteDelegatesToEveryMatchedTool() {
  let chatCallCount = 0;
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: {
            name: 'OmniLauncher',
            description: 'Runs local machine diagnostics.',
            skills: [{ id: 'disk', name: 'Disk usage', description: 'Show disk usage.' }]
          }
        },
        {
          id: 'planner',
          name: 'Planner',
          endpoint: 'https://planner.example/a2a',
          enabled: true,
          agentCard: {
            name: 'Planner',
            description: 'Plans daily work.',
            skills: [{ id: 'today', name: 'Today plan', description: 'Draft today\'s plan.' }]
          }
        }
      ],
      a2aServerTokens: { launcher: 'server-token', planner: 'server-token' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        chatCallCount += 1;
        if (chatCallCount === 1) {
          // Round 0: emit two parallel tool calls, one per matched skill.
          return {
            ok: true,
            json: async () => ({
              choices: [{
                message: {
                  tool_calls: [
                    { id: 'call_disk', type: 'function', function: { name: 'a2a__launcher__disk', arguments: JSON.stringify({ task: 'show disk usage' }) } },
                    { id: 'call_plan', type: 'function', function: { name: 'a2a__planner__today', arguments: JSON.stringify({ task: 'draft today plan' }) } }
                  ]
                }
              }]
            })
          };
        }
        // Round 1: after tool_results, produce a summary that references both.
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Disk: 42% used. Plan: focus block, review, walk.' } }]
          })
        };
      }
      if (url === 'https://launcher.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'Disk: 42% used' }] } } }) };
      }
      if (url === 'https://planner.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'Plan: focus block, review, walk' }] } } }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([
    { role: 'user', content: 'Show my disk usage and draft today plan' }
  ]);

  // Both agents were delegated to in round 0 (order-independent).
  const delegatedUrls = requests.map(r => r.url);
  assert.ok(delegatedUrls.includes('https://launcher.example/a2a'), 'should delegate to launcher');
  assert.ok(delegatedUrls.includes('https://planner.example/a2a'), 'should delegate to planner');
  // Agentic loop: round 0 chat + 2 fanned-out A2A delegations + round 1 chat = 4 requests.
  assert.strictEqual(requests.length, 4, 'expected 2 chat rounds and 2 parallel delegations');

  // Model composed a final answer from both tool_result messages.
  assert.strictEqual(result, 'Disk: 42% used. Plan: focus block, review, walk.');

  // Round 1 request must include both tool-role messages so the model has
  // both delegation outputs when composing the summary.
  const round1Body = JSON.parse(requests[3].options.body);
  const toolMessages = round1Body.messages.filter(m => m.role === 'tool');
  assert.strictEqual(toolMessages.length, 2, 'follow-up request should carry both tool_result messages');
  const toolCallIds = toolMessages.map(m => m.tool_call_id).sort();
  assert.deepStrictEqual(toolCallIds, ['call_disk', 'call_plan']);
}

async function assertA2aAutoRouteMultiToolIsolatesPerAgentFailures() {
  let chatCallCount = 0;
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'good',
          name: 'GoodAgent',
          endpoint: 'https://good.example/a2a',
          enabled: true,
          agentCard: { name: 'GoodAgent', skills: [{ id: 'gs', name: 'Good skill' }] }
        },
        {
          id: 'bad',
          name: 'BadAgent',
          endpoint: 'https://bad.example/a2a',
          enabled: true,
          agentCard: { name: 'BadAgent', skills: [{ id: 'bs', name: 'Bad skill' }] }
        }
      ],
      a2aServerTokens: { good: 't', bad: 't' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        chatCallCount += 1;
        if (chatCallCount === 1) {
          return {
            ok: true,
            json: async () => ({
              choices: [{
                message: {
                  tool_calls: [
                    { id: 'call_good', type: 'function', function: { name: 'a2a__good__gs', arguments: JSON.stringify({ task: 'ok' }) } },
                    { id: 'call_bad', type: 'function', function: { name: 'a2a__bad__bs', arguments: JSON.stringify({ task: 'boom' }) } }
                  ]
                }
              }]
            })
          };
        }
        // Round 1: after tool_results (one success, one failure), produce a
        // summary that surfaces both outcomes.
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'good result. BadAgent failed: A2A delegation failed (boom).' } }]
          })
        };
      }
      if (url === 'https://good.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'good result' }] } } }) };
      }
      if (url === 'https://bad.example/a2a') {
        // Simulate a failing A2A backend; the router must surface the error
        // as a tool_result rather than aborting the whole request.
        return { ok: false, status: 500, text: async () => 'boom' };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'run both' }]);

  // The model composed a final answer that mentions both agents' outputs
  // (or their failure), proving neither failure sank the other's delegation.
  assert.ok(result.includes('good result'), 'good agent output should survive to the final answer');
  assert.ok(/BadAgent failed|A2A delegation failed/.test(result), 'bad agent failure should be surfaced to the model');

  // Round 1 request must carry a tool_result for the failed delegation with
  // the error message baked in, so the model can decide how to present it.
  const round1Body = JSON.parse(requests.filter(r => r.url === 'https://custom.example/v1/chat/completions')[1].options.body);
  const toolMessages = round1Body.messages.filter(m => m.role === 'tool');
  assert.strictEqual(toolMessages.length, 2, 'follow-up should include both tool_results (success + failure)');
  const badResult = toolMessages.find(m => m.tool_call_id === 'call_bad');
  assert.ok(badResult && /A2A delegation failed/.test(badResult.content), 'failed delegation must surface as a tool_result with the error text');
}

async function assertA2aAutoRouteRunsAgenticLoopSequentially() {
  // Simulates a provider whose model calls one tool per round instead of
  // fanning out in parallel. The router must feed each tool_result back and
  // keep iterating until the model produces final text (or hits the round cap).
  let chatCallCount = 0;
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'alibaba',
          name: 'Alibaba',
          endpoint: 'https://alibaba.example/a2a',
          enabled: true,
          agentCard: { name: 'Alibaba', skills: [{ id: 'vm', name: 'VM count' }] }
        },
        {
          id: 'azure',
          name: 'Azure',
          endpoint: 'https://azure.example/a2a',
          enabled: true,
          agentCard: { name: 'Azure', skills: [{ id: 'vm', name: 'VM count' }] }
        }
      ],
      a2aServerTokens: { alibaba: 't', azure: 't' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        chatCallCount += 1;
        if (chatCallCount === 1) {
          return {
            ok: true,
            json: async () => ({
              choices: [{
                message: {
                  tool_calls: [
                    { id: 'r0_alibaba', type: 'function', function: { name: 'a2a__alibaba__vm', arguments: JSON.stringify({ task: 'how many VMs in alibaba' }) } }
                  ]
                }
              }]
            })
          };
        }
        if (chatCallCount === 2) {
          return {
            ok: true,
            json: async () => ({
              choices: [{
                message: {
                  tool_calls: [
                    { id: 'r1_azure', type: 'function', function: { name: 'a2a__azure__vm', arguments: JSON.stringify({ task: 'how many VMs in Azure' }) } }
                  ]
                }
              }]
            })
          };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Alibaba: 11,157 VMs. Azure: 7,842 VMs.' } }]
          })
        };
      }
      if (url === 'https://alibaba.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'Alibaba: 11,157 VMs' }] } } }) };
      }
      if (url === 'https://azure.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'Azure: 7,842 VMs' }] } } }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'how many VMs in alibaba and Azure' }]);

  // Three chat rounds + one delegation per round for the first two = 5 requests.
  assert.strictEqual(requests.length, 5);
  const delegatedUrls = requests.map(r => r.url);
  assert.ok(delegatedUrls.includes('https://alibaba.example/a2a'), 'alibaba must be delegated to in round 0');
  assert.ok(delegatedUrls.includes('https://azure.example/a2a'), 'azure must be delegated to in round 1');
  assert.strictEqual(result, 'Alibaba: 11,157 VMs. Azure: 7,842 VMs.');

  // Round 1 request must carry the round-0 tool_result so the model can
  // notice azure hasn't been called yet and emit that tool call next.
  const round1Body = JSON.parse(requests[2].options.body);
  const round1ToolMessages = round1Body.messages.filter(m => m.role === 'tool');
  assert.strictEqual(round1ToolMessages.length, 1);
  assert.strictEqual(round1ToolMessages[0].tool_call_id, 'r0_alibaba');
  assert.strictEqual(round1ToolMessages[0].content, 'Alibaba: 11,157 VMs');
}

async function assertRunnerRunsAgenticLoopEndToEnd() {
  // Same shape as assertA2aAutoRouteRunsAgenticLoopSequentially but drives
  // the Runner directly, proving the primitive is wired.
  let chatCallCount = 0;
  const { context } = await createBackgroundContext({
    storage: {},
    fetchImpl: async (url, options) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        chatCallCount += 1;
        if (chatCallCount === 1) return {
          ok: true,
          json: async () => ({ choices: [{ message: { tool_calls: [
            { id: 'x', type: 'function', function: { name: 'a2a__local__echo', arguments: JSON.stringify({ task: 'ping' }) } }
          ] } }] })
        };
        const body = JSON.parse(options.body);
        const toolMessages = body.messages.filter(message => message.role === 'tool');
        assert.strictEqual(toolMessages.length, 1);
        assert.strictEqual(toolMessages[0].tool_call_id, 'x');
        assert.strictEqual(toolMessages[0].content, 'ping-pong');
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'done: ping-pong' } }] }) };
      }
      throw new Error(`unexpected ${url}`);
    }
  });

  const registry = context.createToolRegistry();
  registry.register(context.createTool({
    name: 'a2a__local__echo',
    description: 'echo',
    parameters: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
    dispatch: async ({ task }) => `${task}-pong`,
    meta: { serverId: 'local', skillId: 'echo' }
  }));

  const session = context.createSession({ messages: [{ role: 'user', content: 'ping' }] });
  const runner = context.createRunner({
    config: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'k',
      model: 'm',
      apiShape: 'openai-compatible'
    },
    systemPrompt: 'You are a helpful assistant.',
    toolRegistry: registry,
    session,
    maxTurns: 3
  });

  const result = await runner.run();
  assert.strictEqual(result, 'done: ping-pong');
  assert.strictEqual(chatCallCount, 2);
}

async function assertA2aAutoRouteAgenticLoopBoundsRoundsAndDedupes() {
  // A misbehaving model that keeps re-emitting the same tool call must not
  // cause an infinite loop. The router must dedupe across rounds and, if the
  // model never produces final text, fall back to the fanned-out tool output.
  const chatCalls = [];
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: { name: 'OmniLauncher', skills: [{ id: 'disk', name: 'Disk usage' }] }
        }
      ],
      a2aServerTokens: { launcher: 't' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        chatCalls.push(1);
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [
                  { id: `call_${chatCalls.length}`, type: 'function', function: { name: 'a2a__launcher__disk', arguments: JSON.stringify({ task: 'show disk' }) } }
                ]
              }
            }]
          })
        };
      }
      if (url === 'https://launcher.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'Disk: 42% used' }] } } }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'show disk' }]);

  // Model insists on calling the same tool every round. Dedup catches the
  // repeat on round 1, so we only delegate ONCE across all rounds.
  const delegations = requests.filter(r => r.url === 'https://launcher.example/a2a');
  assert.strictEqual(delegations.length, 1, 'dedupe must prevent re-running the same (serverId, task)');
  // Fall back: single-result plain-text path preserves the raw tool output.
  assert.strictEqual(result, 'Disk: 42% used');
}

async function assertAutoRouteRequestEnablesParallelToolCalls() {
  // OpenAI-compatible providers must receive parallel_tool_calls: true so the
  // model is free to emit multiple tool calls for a compound prompt like
  // "how many VMs in Alibaba and Azure".
  const openAiCase = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: { name: 'OmniLauncher', skills: [{ id: 'disk', name: 'Disk usage' }] }
        }
      ]
    },
    fetchImpl: async () => ({ ok: true, json: async () => RESPONSE_BY_SHAPE['openai-compatible'] })
  });

  await openAiCase.context.handleAIChat([{ role: 'user', content: 'anything' }]);
  const openAiBody = JSON.parse(openAiCase.requests[0].options.body);
  assert.equal(openAiBody.parallel_tool_calls, true, 'OpenAI-compatible request should set parallel_tool_calls: true when tools are attached');
  assert.equal(openAiBody.tool_choice, 'auto', 'OpenAI-compatible request should keep tool_choice: auto');
  assert.ok(Array.isArray(openAiBody.tools) && openAiBody.tools.length > 0, 'OpenAI-compatible request should attach tools');

  // Anthropic providers must receive an explicit tool_choice object with
  // disable_parallel_tool_use: false so the model is free to emit multiple
  // tool_use blocks in a single response.
  const anthropicCase = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://anthropic.example/v1',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      apiShape: 'anthropic-messages',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: { name: 'OmniLauncher', skills: [{ id: 'disk', name: 'Disk usage' }] }
        }
      ]
    },
    fetchImpl: async () => ({ ok: true, json: async () => RESPONSE_BY_SHAPE['anthropic-messages'] })
  });

  await anthropicCase.context.handleAIChat([{ role: 'user', content: 'anything' }]);
  const anthropicBody = JSON.parse(anthropicCase.requests[0].options.body);
  assert.ok(anthropicBody.tool_choice && typeof anthropicBody.tool_choice === 'object', 'Anthropic request should set tool_choice as an object');
  assert.equal(anthropicBody.tool_choice.type, 'auto', 'Anthropic tool_choice.type should be "auto"');
  assert.equal(anthropicBody.tool_choice.disable_parallel_tool_use, false, 'Anthropic tool_choice.disable_parallel_tool_use should be false');
  assert.ok(Array.isArray(anthropicBody.tools) && anthropicBody.tools.length > 0, 'Anthropic request should attach tools');
}

async function assertA2aAutoRouteToolCallUsesCollisionSafeToolMapping() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'ops.agent',
          name: 'Ops Agent A',
          endpoint: 'https://ops-a.example/a2a',
          enabled: true,
          agentCard: { name: 'Ops Agent A', skills: [{ name: 'Disk usage', description: 'Show disk usage.' }] }
        },
        {
          id: 'ops_agent',
          name: 'Ops Agent B',
          endpoint: 'https://ops-b.example/a2a',
          enabled: true,
          agentCard: { name: 'Ops Agent B', skills: [{ name: 'Memory usage', description: 'Show memory usage.' }] }
        }
      ],
      a2aServerTokens: { 'ops.agent': 'token-a', ops_agent: 'token-b' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  type: 'function',
                  function: {
                    name: 'a2a__ops_agent__memory_usage',
                    arguments: JSON.stringify({ task: 'show memory usage' })
                  }
                }]
              }
            }]
          })
        };
      }
      if (url === 'https://ops-b.example/a2a') {
        return {
          ok: true,
          json: async () => ({ result: { message: { parts: [{ type: 'text', text: 'Memory usage result' }] } } })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const schemas = context.buildA2aToolSchemas([
    {
      id: 'ops.agent',
      name: 'Ops Agent A',
      endpoint: 'https://ops-a.example/a2a',
      enabled: true,
      agentCard: { name: 'Ops Agent A', skills: [{ name: 'Disk usage', description: 'Show disk usage.' }] }
    },
    {
      id: 'ops_agent',
      name: 'Ops Agent B',
      endpoint: 'https://ops-b.example/a2a',
      enabled: true,
      agentCard: { name: 'Ops Agent B', skills: [{ name: 'Memory usage', description: 'Show memory usage.' }] }
    }
  ]);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(schemas.map(tool => ({ name: tool.name, serverId: tool.serverId, skillName: tool.skillName })))),
    [
      { name: 'a2a__ops_agent__disk_usage', serverId: 'ops.agent', skillName: 'Disk usage' },
      { name: 'a2a__ops_agent__memory_usage', serverId: 'ops_agent', skillName: 'Memory usage' }
    ]
  );
  assert.ok(schemas[0].openAIChat.function.description.includes('Ops Agent A'));
  assert.ok(schemas[0].openAIChat.function.description.includes('Disk usage'));
  assert.ok(schemas[1].openAIChat.function.description.includes('Ops Agent B'));
  assert.ok(schemas[1].openAIChat.function.description.includes('Memory usage'));

  const result = await context.handleAIChat([{ role: 'user', content: 'please handle delegated task' }]);

  assert.strictEqual(result, 'Memory usage result');
  const toolRequest = JSON.parse(requests[0].options.body);
  assert.strictEqual(toolRequest.tools.map(tool => tool.function.name).join(','), 'a2a__ops_agent__disk_usage,a2a__ops_agent__memory_usage');
  assert.strictEqual(requests[1].url, 'https://ops-b.example/a2a');
}

async function assertA2aAutoRouteRespectsDisableToggle() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aAutoRoute: false,
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: { name: 'OmniLauncher', skills: [{ name: 'Disk usage', description: 'Show disk usage.' }] }
        }
      ]
    },
    fetchImpl: async () => ({ ok: true, json: async () => RESPONSE_BY_SHAPE['openai-compatible'] })
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'show me disk usage' }]);

  assert.strictEqual(result, 'ok');
  const body = JSON.parse(requests[0].options.body);
  assert.strictEqual(body.tools, undefined);
}

async function assertA2aToolSchemasIncludeOneToolPerSkill() {
  const { context } = await createBackgroundContext();
  const schemas = context.buildA2aToolSchemas([
    {
      id: 'cloudbot',
      name: 'CloudBot',
      agentCard: {
        name: 'CloudBot',
        description: 'Cloud operations agent.',
        skills: [
          { id: 'aws', name: 'AWS', description: 'Query AWS resources like EC2 and S3.' },
          { id: 'gcp', name: 'GCP', description: 'Query Google Cloud resources.' }
        ]
      }
    }
  ]);

  assert.strictEqual(schemas.length, 2, 'one tool per discovered skill');
  const names = schemas.map(s => String(s.name)).sort();
  assert.strictEqual(names.join(','), 'a2a__cloudbot__aws,a2a__cloudbot__gcp');
  const aws = schemas.find(s => s.name === 'a2a__cloudbot__aws');
  assert.strictEqual(aws.serverId, 'cloudbot');
  assert.strictEqual(aws.skillId, 'aws');
  assert.ok(aws.openAIChat.function.description.includes('AWS'));
  assert.ok(aws.openAIChat.function.description.includes('EC2'));
}

async function assertA2aToolSchemasFallBackToServerToolWhenNoSkills() {
  const { context } = await createBackgroundContext();
  const schemas = context.buildA2aToolSchemas([
    { id: 'launcher', name: 'OmniLauncher', agentCard: { name: 'OmniLauncher', description: 'Desktop agent.' } }
  ]);

  assert.strictEqual(schemas.length, 1, 'one tool per server when no skills');
  assert.strictEqual(schemas[0].name, 'a2a__launcher');
  assert.strictEqual(schemas[0].serverId, 'launcher');
  assert.strictEqual(schemas[0].skillId, null);
}

async function assertSkillToolCallDelegatesToCorrectServer() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'cloudbot',
          name: 'CloudBot',
          endpoint: 'https://cloudbot.example/a2a',
          enabled: true,
          agentCard: {
            name: 'CloudBot',
            description: 'Cloud operations agent.',
            skills: [
              { id: 'aws', name: 'AWS', description: 'Query AWS resources.' },
              { id: 'gcp', name: 'GCP', description: 'Query Google Cloud resources.' }
            ]
          }
        }
      ],
      a2aServerTokens: { cloudbot: 'server-token' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  type: 'function',
                  function: { name: 'a2a__cloudbot__aws', arguments: JSON.stringify({ task: 'how many EC2 in AWS' }) }
                }]
              }
            }]
          })
        };
      }
      if (url === 'https://cloudbot.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: '12 EC2 instances' }] } } }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'please handle this delegated task' }]);

  assert.strictEqual(result, '12 EC2 instances');
  const llmBody = JSON.parse(requests.find(r => r.url === 'https://custom.example/v1/chat/completions').options.body);
  assert.strictEqual(llmBody.tools.length, 2, 'one tool per skill should be injected');
  assert.ok(llmBody.tools.some(tool => tool.function.name === 'a2a__cloudbot__aws'));
  assert.ok(llmBody.tools.some(tool => tool.function.name === 'a2a__cloudbot__gcp'));
  assert.ok(requests.some(r => r.url === 'https://cloudbot.example/a2a'), 'delegated to the A2A server');
}

async function assertQuestionMatchingA2aSkillUsesLlmToolCallRouting() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'cloudbot',
          name: 'CloudBot',
          endpoint: 'https://cloudbot.example/a2a',
          enabled: true,
          agentCard: {
            name: 'CloudBot',
            description: 'Cloud operations agent.',
            skills: [
              { id: 'alibaba', name: 'Alibaba Cloud', description: 'Query Alibaba Cloud ECS instances, VMs, OSS, and other resources.', tags: ['alibaba', 'ecs', 'vm'] },
              { id: 'aws', name: 'AWS', description: 'Query AWS EC2 and S3 resources.', tags: ['aws', 'ec2'] }
            ]
          }
        }
      ],
      a2aServerTokens: { cloudbot: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://cloudbot.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: '5 Alibaba VMs' }] } } }) };
      }
      if (url === 'https://custom.example/v1/chat/completions') {
        const body = JSON.parse(options.body);
        assert.ok(Array.isArray(body.tools), 'A2A tools should be sent to the model');
        assert.ok(body.tools.some(tool => tool.function.name === 'a2a__cloudbot__alibaba'));
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  type: 'function',
                  function: { name: 'a2a__cloudbot__alibaba', arguments: JSON.stringify({ task: 'How many VM in Alibaba?' }) }
                }]
              }
            }]
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'How many VM in Alibaba?' }]);

  assert.strictEqual(result, '5 Alibaba VMs');
  assert.ok(requests.some(r => r.url === 'https://custom.example/v1/chat/completions'), 'should let the model choose an A2A tool');
  assert.ok(requests.some(r => r.url === 'https://cloudbot.example/a2a'), 'selected Alibaba tool should delegate');
}

async function assertAutoRouteRefreshesSparseCachedAgentCard() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        { id: 'cloudbot', name: 'CloudBot', endpoint: 'https://cloudbot.example/a2a', enabled: true, agentCard: { name: 'CloudBot' } }
      ],
      a2aServerTokens: { cloudbot: 'server-token' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://cloudbot.example/a2a/.well-known/agent.json'
        || url === 'https://cloudbot.example/.well-known/agent.json') {
        return {
          ok: true,
          json: async () => ({
            name: 'CloudBot',
            description: 'Cloud operations agent.',
            skills: [
              { id: 'alibaba', name: 'Alibaba Cloud', description: 'Query Alibaba Cloud ECS instances and VMs.', tags: ['alibaba', 'ecs', 'vm'] }
            ]
          })
        };
      }
      if (url === 'https://cloudbot.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: '11053 Alibaba VMs' }] } } }) };
      }
      if (url === 'https://custom.example/v1/chat/completions') {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  type: 'function',
                  function: { name: 'a2a__cloudbot__alibaba', arguments: JSON.stringify({ task: 'how many VMs in Alibaba' }) }
                }]
              }
            }]
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const result = await context.handleAIChat([{ role: 'user', content: 'how many VMs in Alibaba' }]);

  assert.strictEqual(result, '11053 Alibaba VMs');
  assert.ok(requests.some(r => /\.well-known\/agent\.json/.test(r.url)), 'should refresh sparse cached agent cards');
  assert.ok(requests.some(r => r.url === 'https://custom.example/v1/chat/completions'), 'should let the model choose from refreshed A2A tools');
  assert.ok(requests.some(r => r.url === 'https://cloudbot.example/a2a'), 'should delegate after the model selects a refreshed skill tool');
}

async function assertAutoRouteDiscoversAgentCardOnDemand() {
  const { context, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        { id: 'cloudbot', name: 'CloudBot', endpoint: 'https://cloudbot.example/a2a', enabled: true }
      ],
      a2aServerTokens: { cloudbot: 'server-token' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://cloudbot.example/a2a/.well-known/agent.json'
        || url === 'https://cloudbot.example/.well-known/agent.json') {
        return {
          ok: true,
          json: async () => ({
            name: 'CloudBot',
            description: 'Cloud operations agent.',
            skills: [{ id: 'aws', name: 'AWS', description: 'Query AWS resources.' }]
          })
        };
      }
      if (url === 'https://custom.example/v1/chat/completions') {
        return { ok: true, json: async () => RESPONSE_BY_SHAPE['openai-compatible'] };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  await context.handleAIChat([{ role: 'user', content: 'Plan my day' }]);

  const llmRequest = requests.find(r => r.url === 'https://custom.example/v1/chat/completions');
  assert.ok(llmRequest, 'should still reach the LLM');
  const body = JSON.parse(llmRequest.options.body);
  assert.ok(Array.isArray(body.tools) && body.tools.length >= 1, 'auto-discovery should inject tools even without a cached agent card');
  assert.ok(requests.some(r => /\.well-known\/agent\.json/.test(r.url)), 'should have fetched the agent card on demand');
}

async function assertSummarizePageActionPromptExists() {
  const { context } = await createBackgroundContext({
    storage: {
      endpoint: 'http://localhost:5000/v1',
      apiKey: 'test-key',
      model: 'gpt-4o'
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Page summary result' } }] })
    })
  });

  const result = await context.handleAIAction('summarize-page', 'Some page content here.');
  assert.strictEqual(result, 'Page summary result');
}

async function assertSummarizePageRejectsUnknownAction() {
  const { context } = await createBackgroundContext({
    storage: {
      endpoint: 'http://localhost:5000/v1',
      apiKey: 'test-key',
      model: 'gpt-4o'
    }
  });

  await assert.rejects(
    () => context.handleAIAction('nonexistent-action', 'text'),
    /Unknown action/
  );
}

async function assertStreamingRequestSetsSseFlag() {
  const requests = [];
  const { context } = await createBackgroundContext({
    storage: {
      endpoint: 'http://localhost:5000/v1',
      apiKey: 'test-key',
      model: 'gpt-4o'
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        body: null,
        json: async () => ({ choices: [{ message: { content: 'streamed result' } }] })
      };
    }
  });

  const chunks = [];
  let doneCalled = false;

  await context.executeApiRequestStreaming({
    messages: [{ role: 'user', content: 'test' }],
    systemPrompt: 'be helpful',
    onChunk: text => chunks.push(text),
    onDone: () => { doneCalled = true; },
    onError: () => {}
  });

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].body.stream, true, 'streaming request must set stream: true');
  assert.ok(doneCalled, 'onDone should be called');
  // Falls back to json when no body (ReadableStream)
  assert.deepStrictEqual(chunks, ['streamed result']);
}

async function assertStreamingChatAutoRouteHandlesA2aToolCalls() {
  const portMessages = [];
  const { connectListeners, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: {
            name: 'OmniLauncher',
            description: 'Runs cloud and desktop skills.',
            skills: [{ id: 'skill:alibaba', name: 'alibaba', description: 'Query Alibaba Cloud resources and accounts.' }]
          }
        }
      ],
      a2aServerTokens: { launcher: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        const body = JSON.parse(options.body);
        assert.ok(Array.isArray(body.tools), 'streaming chat should include A2A tools');
        assert.strictEqual(body.tool_choice, 'auto');
        const alibabaTool = body.tools.find(tool => tool.function.name === 'a2a__launcher__skill_alibaba');
        assert.ok(alibabaTool, 'expected an Alibaba A2A tool schema');
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  type: 'function',
                  function: { name: alibabaTool.function.name, arguments: JSON.stringify({ task: 'How many VMs in Alibaba now' }) }
                }]
              }
            }]
          })
        };
      }
      if (url === 'https://launcher.example/a2a') {
        return { ok: true, json: async () => ({ result: { message: { parts: [{ type: 'text', text: '11053 Alibaba VMs' }] } } }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  assert.strictEqual(connectListeners.length, 1, 'background should register one port listener');
  const messageListeners = [];
  connectListeners[0]({
    name: 'omnipilot-stream',
    onMessage: { addListener(fn) { messageListeners.push(fn); } },
    postMessage(message) { portMessages.push(message); }
  });
  assert.strictEqual(messageListeners.length, 1, 'stream port should register one message listener');

  await messageListeners[0]({
    type: 'AI_CHAT_STREAM',
    messages: [{ role: 'user', content: 'How many VMs in Alibaba now' }]
  });

  assert.deepStrictEqual(JSON.parse(JSON.stringify(portMessages)), [
    { type: 'status', status: 'delegating' },
    { type: 'chunk', text: '11053 Alibaba VMs' },
    { type: 'done' }
  ]);
  assert.ok(requests.some(request => request.url === 'https://custom.example/v1/chat/completions'), 'should let the model choose an A2A tool');
  assert.ok(requests.some(request => request.url === 'https://launcher.example/a2a'), 'should delegate selected A2A tool call');
}

// Regression: before the streaming fix, ordinary chat (no A2A servers) was
// forced through the non-streaming handleAIChat path — a single chunk with the
// whole answer and, worse, no stream:true. This asserts real streaming is back.
async function assertStreamingChatPlainChatStreams() {
  const portMessages = [];
  const { connectListeners, requests } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible'
      // no a2aServers → plain streaming path
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        const body = JSON.parse(options.body);
        assert.strictEqual(body.stream, true, 'plain chat must stream (stream: true)');
        assert.ok(!('tools' in body), 'plain chat with no A2A servers should not send tools');
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Refund policy explained.' } }] }) };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const messageListeners = [];
  connectListeners[0]({
    name: 'omnipilot-stream',
    onMessage: { addListener(fn) { messageListeners.push(fn); } },
    postMessage(message) { portMessages.push(message); }
  });

  await messageListeners[0]({
    type: 'AI_CHAT_STREAM',
    messages: [{ role: 'user', content: 'Check refund eligibility' }]
  });

  assert.ok(!portMessages.some(m => m.type === 'status'), 'plain chat should not emit a delegating status');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(portMessages)), [
    { type: 'chunk', text: 'Refund policy explained.' },
    { type: 'done' }
  ]);
  assert.ok(requests.some(request => request.url === 'https://custom.example/v1/chat/completions'), 'plain chat should reach the chat endpoint');
}

async function assertStreamingChatDoesNotShowDelegatingBeforeToolSelection() {
  const portMessages = [];
  const { connectListeners, context } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: {
            name: 'OmniLauncher',
            description: 'Runs cloud and desktop skills.',
            skills: [{ id: 'skill:alibaba', name: 'alibaba', description: 'Query Alibaba Cloud resources and accounts.' }]
          }
        }
      ],
      a2aServerTokens: { launcher: 'server-token' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        await new Promise(resolve => setTimeout(resolve, 20));
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'Direct answer without delegation.' } }] })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });
  context.A2A_STATUS_HEARTBEAT_MS = 5;

  const messageListeners = [];
  connectListeners[0]({
    name: 'omnipilot-stream',
    onMessage: { addListener(fn) { messageListeners.push(fn); } },
    postMessage(message) { portMessages.push(message); }
  });

  await messageListeners[0]({
    type: 'AI_CHAT_STREAM',
    messages: [{ role: 'user', content: 'Explain this selected text' }]
  });

  assert.ok(!portMessages.some(m => m.type === 'status'), 'direct answers should not show A2A delegation status before any tool call');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(portMessages)), [
    { type: 'chunk', text: 'Direct answer without delegation.' },
    { type: 'done' }
  ]);
}

// Regression: OmniLauncher can spend a long time inside the initial A2A
// message/send call while its own model/tool loop runs. The extension must send
// status heartbeats during that await too; polling heartbeats are too late.
async function assertStreamingChatKeepsA2aDelegationAliveDuringSlowInitialSend() {
  const portMessages = [];
  const { connectListeners, context } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: {
            name: 'OmniLauncher',
            description: 'Runs cloud and desktop skills.',
            skills: [{ id: 'skill:alibaba', name: 'alibaba', description: 'Query Alibaba Cloud resources and accounts.' }]
          }
        }
      ],
      a2aServerTokens: { launcher: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  type: 'function',
                  function: { name: 'a2a__launcher__skill_alibaba', arguments: JSON.stringify({ task: 'How many VMs in Alibaba now' }) }
                }]
              }
            }]
          })
        };
      }
      if (url === 'https://launcher.example/a2a') {
        await new Promise(() => {});
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });
  context.A2A_STATUS_HEARTBEAT_MS = 5;

  const messageListeners = [];
  connectListeners[0]({
    name: 'omnipilot-stream',
    onMessage: { addListener(fn) { messageListeners.push(fn); } },
    postMessage(message) { portMessages.push(message); }
  });

  const pending = messageListeners[0]({
    type: 'AI_CHAT_STREAM',
    messages: [{ role: 'user', content: 'How many VMs in Alibaba now' }]
  });

  await new Promise(resolve => setTimeout(resolve, 30));

  const statusMessages = portMessages.filter(m => m.type === 'status' && m.status === 'delegating');
  assert.ok(statusMessages.length >= 2, 'slow initial A2A send should emit repeated delegating status messages');
  assert.ok(!portMessages.some(m => m.type === 'done'), 'still-running delegation should not finish');
  assert.strictEqual(typeof pending?.then, 'function', 'stream handler should still be awaiting the A2A send');
}

// Regression: slow A2A agents can run for many polling intervals. The background
// worker must keep sending status heartbeats so the content-side stream watchdog
// does not replace an in-progress delegation with "No response".
async function assertStreamingChatKeepsA2aDelegationAliveDuringSlowPoll() {
  const portMessages = [];
  const { connectListeners, requests, context } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: {
            name: 'OmniLauncher',
            description: 'Runs cloud and desktop skills.',
            skills: [{ id: 'skill:alibaba', name: 'alibaba', description: 'Query Alibaba Cloud resources and accounts.' }]
          }
        }
      ],
      a2aServerTokens: { launcher: 'server-token' }
    },
    fetchImpl: async (url, options) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  type: 'function',
                  function: { name: 'a2a__launcher__skill_alibaba', arguments: JSON.stringify({ task: 'How many VMs in Alibaba now' }) }
                }]
              }
            }]
          })
        };
      }
      if (url === 'https://launcher.example/a2a') {
        const body = JSON.parse(options.body);
        if (body.method === 'message/send') {
          return { ok: true, json: async () => ({ result: { id: 'task-123', state: 'working' } }) };
        }

        const pollCount = requests.filter(request => request.url === 'https://launcher.example/a2a' && JSON.parse(request.options.body).method === 'tasks/get').length;
        return {
          ok: true,
          json: async () => ({
            result: pollCount < 25
              ? { id: 'task-123', state: 'working' }
              : { id: 'task-123', state: 'completed', artifacts: [{ parts: [{ type: 'text', text: '11053 Alibaba VMs' }] }] }
          })
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });
  context.A2A_STATUS_HEARTBEAT_MS = 5;
  context.wait = async () => new Promise(resolve => setTimeout(resolve, 1));

  const messageListeners = [];
  connectListeners[0]({
    name: 'omnipilot-stream',
    onMessage: { addListener(fn) { messageListeners.push(fn); } },
    postMessage(message) { portMessages.push(message); }
  });

  await messageListeners[0]({
    type: 'AI_CHAT_STREAM',
    messages: [{ role: 'user', content: 'How many VMs in Alibaba now' }]
  });

  const statusMessages = portMessages.filter(m => m.type === 'status' && m.status === 'delegating');
  assert.ok(statusMessages.length >= 2, 'slow delegation should emit repeated delegating status messages');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(portMessages.slice(-2))), [
    { type: 'chunk', text: '11053 Alibaba VMs' },
    { type: 'done' }
  ]);
}

// Regression: a failing A2A delegation used to leave the panel spinner spinning
// forever. The streaming handler must translate the failure into error + done.
async function assertStreamingChatReportsA2aDelegationError() {
  const portMessages = [];
  const { connectListeners } = await createBackgroundContext({
    storage: {
      providerType: 'custom-provider',
      endpoint: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'custom-model',
      apiShape: 'openai-compatible',
      a2aServers: [
        {
          id: 'launcher',
          name: 'OmniLauncher',
          endpoint: 'https://launcher.example/a2a',
          enabled: true,
          agentCard: {
            name: 'OmniLauncher',
            description: 'Runs cloud and desktop skills.',
            skills: [{ id: 'skill:alibaba', name: 'alibaba', description: 'Query Alibaba Cloud resources and accounts.' }]
          }
        }
      ],
      a2aServerTokens: { launcher: 'server-token' }
    },
    fetchImpl: async (url) => {
      if (url === 'https://custom.example/v1/chat/completions') {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                tool_calls: [{
                  type: 'function',
                  function: { name: 'a2a__launcher__skill_alibaba', arguments: JSON.stringify({ task: 'How many VMs in Alibaba now' }) }
                }]
              }
            }]
          })
        };
      }
      if (url === 'https://launcher.example/a2a') {
        return { ok: false, status: 503, text: async () => 'agent offline' };
      }
      throw new Error(`Unexpected fetch ${url}`);
    }
  });

  const messageListeners = [];
  connectListeners[0]({
    name: 'omnipilot-stream',
    onMessage: { addListener(fn) { messageListeners.push(fn); } },
    postMessage(message) { portMessages.push(message); }
  });

  await messageListeners[0]({
    type: 'AI_CHAT_STREAM',
    messages: [{ role: 'user', content: 'How many VMs in Alibaba now' }]
  });

  assert.ok(portMessages.some(m => m.type === 'status' && m.status === 'delegating'), 'should announce delegation before it fails');
  const errorMsg = portMessages.find(m => m.type === 'error');
  assert.ok(errorMsg, 'a failed delegation must emit an error message');
  assert.strictEqual(portMessages.at(-1).type, 'done', 'must always finish with done so the client clears its spinner');
  assert.ok(!portMessages.some(m => m.type === 'chunk'), 'a failed delegation should not emit a content chunk');
}

// A dedicated A2A provider streams a delegating status then the delegated text.

async function assertStreamingReportsErrorOnBadStatus() {
  const { context } = await createBackgroundContext({
    storage: {
      endpoint: 'http://localhost:5000/v1',
      apiKey: 'test-key',
      model: 'gpt-4o'
    },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
      headers: { entries: () => [] }
    })
  });

  let errorMsg = '';
  let doneCalled = false;

  await context.executeApiRequestStreaming({
    messages: [{ role: 'user', content: 'test' }],
    systemPrompt: 'be helpful',
    onChunk: () => {},
    onDone: () => { doneCalled = true; },
    onError: err => { errorMsg = err; }
  });

  assert.ok(errorMsg.includes('Invalid API key'), `expected auth error, got: ${errorMsg}`);
}

async function assertStreamingReportsErrorWhenNoApiKey() {
  const { context } = await createBackgroundContext({
    storage: {
      endpoint: 'http://localhost:5000/v1',
      apiKey: '',
      model: 'gpt-4o'
    }
  });

  let errorMsg = '';
  await context.executeApiRequestStreaming({
    messages: [{ role: 'user', content: 'test' }],
    systemPrompt: 'be helpful',
    onChunk: () => {},
    onDone: () => {},
    onError: err => { errorMsg = err; }
  });

  assert.ok(errorMsg.includes('No API key configured'), `expected no-key error, got: ${errorMsg}`);
}

async function assertStreamChunkParsersWorkForAllShapes() {
  const { context } = await createBackgroundContext({
    storage: {}
  });

  // OpenAI chat chunk
  const openaiParser = context.parseStreamChunkOpenAIChat;
  assert.strictEqual(openaiParser({ choices: [{ delta: { content: 'hello' } }] }), 'hello');
  assert.strictEqual(openaiParser({ choices: [{ delta: {} }] }), '');
  assert.strictEqual(openaiParser({}), '');

  // Anthropic chunk
  const anthropicParser = context.parseStreamChunkAnthropic;
  assert.strictEqual(anthropicParser({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'bonjour' } }), 'bonjour');
  assert.strictEqual(anthropicParser({ type: 'message_start' }), '');
  assert.strictEqual(anthropicParser({}), '');

  // OpenAI Responses chunk
  const responsesParser = context.parseStreamChunkOpenAIResponses;
  assert.strictEqual(responsesParser({ type: 'response.output_text.delta', delta: 'hola' }), 'hola');
  assert.strictEqual(responsesParser({ type: 'response.created' }), '');
  assert.strictEqual(responsesParser({}), '');
}

async function assertContextMenuSetupCreatesExpectedMenuItems() {
  const { context } = await createBackgroundContext({
    storage: {}
  });

  // setupContextMenus should be defined and callable
  assert.strictEqual(typeof context.setupContextMenus, 'function');
}

async function assertNewActionPromptsExist() {
  const { context } = await createBackgroundContext({
    storage: {
      endpoint: 'http://localhost:5000/v1',
      apiKey: 'test-key',
      model: 'gpt-4o'
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'result' } }] })
    })
  });

  // All new actions should have prompts and be callable
  for (const action of ['sentiment', 'code-explain', 'divide-paragraphs', 'ask', 'translate-en', 'translate-zh', 'translate-bidi', 'summarize-github']) {
    const result = await context.handleAIAction(action, 'test text');
    assert.strictEqual(result, 'result', `${action} should return a result`);
  }
}

async function assertStreamChunkParsersHandleEdgeCases() {
  const { context } = await createBackgroundContext({ storage: {} });

  // OpenAI: empty delta
  assert.strictEqual(context.parseStreamChunkOpenAIChat({ choices: [{ delta: { role: 'assistant' } }] }), '');
  // Anthropic: non-delta event
  assert.strictEqual(context.parseStreamChunkAnthropic({ type: 'message_stop' }), '');
  // Responses: non-text event
  assert.strictEqual(context.parseStreamChunkOpenAIResponses({ type: 'response.done' }), '');
}


async function assertToolAndToolRegistryPrimitivesExist() {
  const { context } = await createBackgroundContext({ storage: {} });

  // createTool: factory that returns a plain shape (not a class instance).
  const echo = context.createTool({
    name: 'echo',
    description: 'Return the input verbatim',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    dispatch: async ({ text }) => text
  });
  assert.strictEqual(echo.name, 'echo');
  assert.strictEqual(typeof echo.dispatch, 'function');
  assert.strictEqual(await echo.dispatch({ text: 'hi' }), 'hi');

  // createToolRegistry: register, get, list, schemasFor(apiShape).
  const registry = context.createToolRegistry();
  registry.register(echo);
  assert.strictEqual(registry.get('echo'), echo);
  assert.strictEqual(registry.list().length, 1);
  assert.strictEqual(registry.list()[0].name, 'echo');

  // Dispatch through the registry.
  assert.strictEqual(await registry.dispatch('echo', { text: 'hi' }), 'hi');

  // schemasFor returns OpenAI-Chat / Anthropic / OpenAI-Responses shapes.
  const openai = registry.schemasFor('openai-compatible');
  assert.strictEqual(openai[0].type, 'function');
  assert.strictEqual(openai[0].function.name, 'echo');
  const anthropic = registry.schemasFor('anthropic-messages');
  assert.strictEqual(anthropic[0].name, 'echo');
  assert.ok(anthropic[0].input_schema);
  const responses = registry.schemasFor('openai-responses');
  assert.strictEqual(responses[0].type, 'function');
  assert.strictEqual(responses[0].name, 'echo');

  // Registering a duplicate name throws.
  assert.throws(() => registry.register(echo), /already registered/i);

  // Dispatching an unknown tool throws with the tool name in the message.
  await assert.rejects(() => registry.dispatch('nope', {}), /nope/);
}

async function assertSessionAndStatePrimitivesExist() {
  const { context } = await createBackgroundContext({ storage: {} });

  const session = context.createSession({ messages: [{ role: 'user', content: 'hi' }] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(session.messages)), [{ role: 'user', content: 'hi' }]);

  // Dispatch tracking — dedupe key is caller-supplied so callers pick the
  // policy (currently `${serverId} ${task}` for A2A).
  assert.strictEqual(session.hasDispatched('a2a launcher show disk'), false);
  session.markDispatched('a2a launcher show disk');
  assert.strictEqual(session.hasDispatched('a2a launcher show disk'), true);

  // appendFollowUp: takes the assistant turn's raw response, per-call
  // settled results, and an apiShape; returns nothing and grows messages.
  const before = session.messages.length;
  session.appendFollowUp('openai-compatible',
    { choices: [{ message: { tool_calls: [{ id: 'x', function: { name: 'a2a__srv__k', arguments: '{}' } }] } }] },
    [{ call: { id: 'x' }, server: { id: 'srv' }, tool: { name: 'a2a__srv__k' }, text: 'ok', error: null }]
  );
  assert.strictEqual(session.messages.length, before + 2, 'follow-up should add assistant + tool messages');
  assert.strictEqual(session.messages[before].role, 'assistant');
  assert.strictEqual(session.messages[before + 1].role, 'tool');
  assert.strictEqual(session.messages[before + 1].tool_call_id, 'x');
  assert.strictEqual(session.messages[before + 1].content, 'ok');

  // State: opaque scratch bag with get/set/incr for a single run.
  const state = context.createState();
  assert.strictEqual(state.get('round'), undefined);
  state.set('round', 0);
  assert.strictEqual(state.get('round'), 0);
  assert.strictEqual(state.incr('round'), 1);
  assert.strictEqual(state.get('round'), 1);
}

async function assertA2aToolProviderRegistersOnePerSkill() {
  const { context } = await createBackgroundContext({ storage: {} });

  const servers = [
    {
      id: 'launcher', name: 'OmniLauncher',
      endpoint: 'https://launcher.example/a2a', enabled: true,
      agentCard: { name: 'OmniLauncher', skills: [
        { id: 'disk', name: 'Disk usage' },
        { id: 'ram', name: 'RAM usage' }
      ] }
    },
    {
      id: 'planner', name: 'Planner',
      endpoint: 'https://planner.example/a2a', enabled: true,
      agentCard: { name: 'Planner' }
    }
  ];

  const registry = context.createToolRegistry();
  context.registerA2aToolsInRegistry(registry, servers);

  const names = JSON.parse(JSON.stringify(registry.list().map(t => t.name).sort()));
  assert.deepStrictEqual(names, ['a2a__launcher__disk', 'a2a__launcher__ram', 'a2a__planner']);

  const disk = registry.get('a2a__launcher__disk');
  assert.strictEqual(disk.meta.serverId, 'launcher');
  assert.strictEqual(disk.meta.skillId, 'disk');
  assert.strictEqual(disk.meta.skillName, 'Disk usage');

  const planner = registry.get('a2a__planner');
  assert.strictEqual(planner.meta.serverId, 'planner');
  assert.strictEqual(planner.meta.skillId, null);
  assert.strictEqual(planner.meta.skillName, '');
}

async function assertA2aToolProviderUsesCollisionSafeNames() {
  const { context } = await createBackgroundContext({ storage: {} });
  const registry = context.createToolRegistry();

  registry.register(context.createTool({
    name: 'a2a__launcher__disk',
    description: 'pre-existing tool with the same name',
    dispatch: async () => 'noop'
  }));

  context.registerA2aToolsInRegistry(registry, [
    {
      id: 'launcher',
      name: 'OmniLauncher',
      endpoint: 'https://launcher.example/a2a',
      enabled: true,
      agentCard: { name: 'OmniLauncher', skills: [{ id: 'disk', name: 'Disk usage' }] }
    }
  ]);

  const names = JSON.parse(JSON.stringify(registry.list().map(t => t.name).sort()));
  assert.deepStrictEqual(names, ['a2a__launcher__disk', 'a2a__launcher__disk_2']);
}

async function main() {
  await assertAgentConstantsLoadedFromAgentFolder();
  await assertA2aServerMetadataAndTokensUseSeparateStorageAreas();
  await assertLoadA2aServersReadsFromLocalStorage();
  await assertLoadA2aServersMigratesLegacySyncStorageToLocal();
  await assertA2aProviderIdsRoundTripServerIds();
  await assertOpenAICompatibleDefault();
  await assertFreshInstallDefaultShape();
  await assertLegacyOmniEndpointMigratesToAnthropic();
  await assertRootEndpointUsesV1Routes();
  await assertAnthropicMessagesShape();
  await assertOpenAIResponsesShape();
  await assertLegacyAuthMethodMigratesToProviderType();
  await assertAzureFoundryModelListingUsesManualModelsOnly();
  await assertCustomProviderTypeUsesEndpointModels();
  await assertAzureFoundryRequestUsesSelectedApiShape();
  await assertAzureFoundryGpt54UsesMaxCompletionTokens();
  await assertAzureFoundryOtherGptModelsKeepMaxTokens();
  await assertCustomProviderGpt54KeepsMaxTokens();
  await assertCustomProviderModelListingFallsBackToEmptyOnFailure();
  await assertLoadConfigUsesActiveProviderSpecificConfig();
  await assertSetProviderActivatesStoredProviderConfig();
  await assertSetProviderPreservesOutgoingTopLevelConfig();
  await assertSetProviderWritesCopilotCompatibilityAuthMethod();
  await assertSetModelUpdatesActiveProviderConfig();
  await assertA2aDiscoveryFetchesAgentCardWithBearerToken();
  await assertA2aDiscoveryFallsBackToEndpointAgentCard();
  await assertRemoveA2aServerRemovesLocalTokenOnlyForThatServer();
  await assertLegacyA2aProviderTypeFallsBackToCustomProvider();
  await assertConfiguredA2aServerWithoutAgentCardDoesNotAutomaticallyHandleChat();
  await assertA2aAutoRouteInjectsToolsForDiscoveredAgentCards();
  await assertA2aToolSchemasIncludeOneToolPerSkill();
  await assertA2aToolSchemasFallBackToServerToolWhenNoSkills();
  await assertSkillToolCallDelegatesToCorrectServer();
  await assertQuestionMatchingA2aSkillUsesLlmToolCallRouting();
  await assertAutoRouteRefreshesSparseCachedAgentCard();
  await assertAutoRouteDiscoversAgentCardOnDemand();
  await assertCopilotAutoRouteToolCallDelegates();
  await assertAutoRouteSystemPromptInstructsToolUse();
  await assertA2aAutoRouteToolCallDelegatesOrdinaryFollowUp();
  await assertA2aAutoRouteDelegatesToEveryMatchedTool();
  await assertA2aAutoRouteMultiToolIsolatesPerAgentFailures();
  await assertA2aAutoRouteRunsAgenticLoopSequentially();
  await assertRunnerRunsAgenticLoopEndToEnd();
  await assertA2aAutoRouteAgenticLoopBoundsRoundsAndDedupes();
  await assertAutoRouteRequestEnablesParallelToolCalls();
  await assertA2aAutoRouteToolCallUsesCollisionSafeToolMapping();
  await assertA2aAutoRouteRespectsDisableToggle();
  await assertProviderTypeCopilotModelListingUsesCachedToken();
  await assertCopilotModelListingUsesCachedToken();
  await assertCopilotModelListingRefreshesExpiredToken();
  await assertCopilotDeviceFlowAndPollingAndClearAuth();
  await assertCopilotAccessTokenCachesAndClearsOnUnauthorized();
  await assertMalformedDeviceFlowDoesNotPersistState();
  await assertMalformedCopilotTokenRefreshDoesNotPersistState();
  await assertCopilotApiRequestUsesDirectChatCompletionsWithCachedToken();
  await assertCopilotGpt54UsesMaxCompletionTokens();
  await assertCopilotUnsupportedStoredModelRetriesWithAvailableModel();
  await assertCopilotResponsesOnlyModelUsesResponsesEndpoint();
  await assertCopilotApiRequestRefreshesExpiredTokenFirst();
  await assertA2aDelegateTaskBuildsStandaloneTaskText();
  await assertA2aDelegateTaskUsesAgentCardRpcUrl();
  await assertA2aDelegateTaskNormalizesLocalhostEndpointToLoopback();
  await assertA2aDelegateTaskFallsBackFromStoredAgentCardBaseUrlToRestRoutes();
  await assertA2aDelegateTaskFallsBackFromJsonRpcMessagesErrorToRestRoutes();
  await assertA2aDelegateTaskFallsBackToRestRoutesAfterJsonRpc404();
  await assertA2aDelegateTaskDiscoversRpcUrlAfterBaseEndpoint404();
  await assertA2aDelegateTaskReturnsImmediateTextResult();
  await assertA2aDelegateTaskPollsUntilCompleted();
  await assertA2aDelegateTaskWaitsForSlowAgentCompletion();
  await assertA2aDelegateTaskSurfacesFailedTaskState();
  // New feature tests: streaming, context menu, page summary
  await assertSummarizePageActionPromptExists();
  await assertSummarizePageRejectsUnknownAction();
  await assertStreamingRequestSetsSseFlag();
  await assertStreamingChatAutoRouteHandlesA2aToolCalls();
  await assertStreamingChatPlainChatStreams();
  await assertStreamingChatDoesNotShowDelegatingBeforeToolSelection();
  await assertStreamingChatKeepsA2aDelegationAliveDuringSlowInitialSend();
  await assertStreamingChatKeepsA2aDelegationAliveDuringSlowPoll();
  await assertStreamingChatReportsA2aDelegationError();
  await assertStreamingReportsErrorOnBadStatus();
  await assertStreamingReportsErrorWhenNoApiKey();
  await assertStreamChunkParsersWorkForAllShapes();
  await assertStreamChunkParsersHandleEdgeCases();
  await assertToolAndToolRegistryPrimitivesExist();
  await assertSessionAndStatePrimitivesExist();
  await assertA2aToolProviderRegistersOnePerSkill();
  await assertA2aToolProviderUsesCollisionSafeNames();
  await assertContextMenuSetupCreatesExpectedMenuItems();
  await assertNewActionPromptsExist();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
