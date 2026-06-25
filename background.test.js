const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('background.js', 'utf8');

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
      runtime: { onMessage: { addListener() {} } },
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
    console: {
      info: () => {},
      error: () => {}
    },
    chrome: {
      runtime: { onMessage: { addListener(fn) { runtimeListeners.push(fn); } } },
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
    stores: { syncStore, localStore, activeStore: storageArea === 'local' ? localStore : syncStore }
  };
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

  assert.deepStrictEqual(JSON.parse(JSON.stringify(stores.syncStore.a2aServers)), [
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


async function main() {
  await assertA2aServerMetadataAndTokensUseSeparateStorageAreas();
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
  await assertCopilotApiRequestRefreshesExpiredTokenFirst();
  await assertA2aDelegateTaskReturnsImmediateTextResult();
  await assertA2aDelegateTaskPollsUntilCompleted();
  await assertA2aDelegateTaskSurfacesFailedTaskState();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
