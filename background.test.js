const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('background.js', 'utf8');

async function main() {
  const infoLogs = [];

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
            cb({
              ...defaults,
              endpoint: 'http://localhost:5000/v1',
              apiKey: 'super-secret-key',
              model: 'deepseek-v4-flash'
            });
          }
        }
      }
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] })
    })
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  await context.handleAIAction('summarize', 'hello');

  const requestLog = infoLogs.find(entry => entry[0] === 'OmniPilot API request');
  assert.ok(requestLog, 'expected OmniPilot API request log');
  assert.strictEqual(typeof requestLog[1], 'string');

  const payload = JSON.parse(requestLog[1]);
  assert.strictEqual(payload.requestUrl, 'http://localhost:5000/v1/chat/completions');
  assert.strictEqual(payload.apiFormat, 'openai-chat-completions');
  assert.strictEqual(payload.model, 'deepseek-v4-flash');
  assert.strictEqual(payload.hasApiKey, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(payload.requestHeaders)), {
    'Content-Type': 'application/json',
    Authorization: 'Bearer <redacted>'
  });

  const parsedBody = JSON.parse(payload.requestBody);
  assert.strictEqual(parsedBody.model, 'deepseek-v4-flash');
  assert.strictEqual(parsedBody.max_tokens, 1024);
  assert.deepStrictEqual(parsedBody.messages.map(message => message.role), ['system', 'user']);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
