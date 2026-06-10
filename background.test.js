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

async function main() {
  await assertOpenAICompatibleDefault();
  await assertFreshInstallDefaultShape();
  await assertLegacyOmniEndpointMigratesToAnthropic();
  await assertRootEndpointUsesV1Routes();
  await assertAnthropicMessagesShape();
  await assertOpenAIResponsesShape();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
