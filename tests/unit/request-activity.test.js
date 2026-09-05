const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('src/background/agent/activity.mjs', 'utf8'), context);
const events = [];
const receive = event => events.push(JSON.parse(JSON.stringify(event)));
context.emitReasoningSummary({ type: 'response.reasoning_summary_text.delta', delta: 'Checking the relevant sources.' }, receive);
context.emitReasoningSummary({ output: [{ type: 'reasoning', encrypted_content: 'SECRET', summary: [{ type: 'summary_text', text: 'Sources agree.' }] }] }, receive);
context.emitReasoningSummary({ choices: [{ delta: { reasoning_content: 'PRIVATE' } }], content: [{ type: 'thinking', thinking: 'PRIVATE' }] }, receive);
assert.deepEqual(events, [
  { type: 'reasoning.summary', text: 'Checking the relevant sources.' },
  { type: 'reasoning.summary', text: 'Sources agree.' }
]);
const activity = context.publicRequestActivity('tool.dispatch', { toolName: 'lookup', callId: '1', args: 'SECRET', requestHeaders: 'SECRET', requestUrl: 'SECRET' });
assert.deepEqual(JSON.parse(JSON.stringify(activity)), { type: 'tool.dispatch', toolName: 'lookup', callId: '1' });
assert.equal(context.publicRequestActivity('error', { message: 'SECRET' }), null);
const toolDetails = context.publicRequestActivity('tool.details', {
  toolName: 'lookup', callId: '1', serverName: 'Cloud agent', skillName: 'aws',
  durationMs: 1200, textLen: 50, args: 'SECRET', requestHeaders: 'SECRET'
});
assert.equal(toolDetails.serverName, 'Cloud agent');
assert.equal(toolDetails.durationMs, 1200);
assert.ok(!JSON.stringify(toolDetails).includes('SECRET'));
vm.runInContext(fs.readFileSync('src/utils/chat-ui.mjs', 'utf8').replace(/^export .*;$/m, ''), context);
let progress = context.createRequestActivity();
progress = context.updateRequestActivity(progress, { type: 'provider.request' });
assert.equal(progress.entries.at(-1).state, 'running', 'thinking must not be marked done on arrival');
progress = context.updateRequestActivity(progress, { type: 'response.streaming' });
assert.equal(progress.entries.at(-2).state, 'complete');
assert.equal(progress.entries.at(-1).state, 'running', 'writing remains active until completion');
assert.equal(context.finishRequestActivity(progress).entries.at(-1).state, 'complete');
assert.equal(context.finishRequestActivity(progress, 'error').entries.at(-1).state, 'error');
console.log('public request activity tests passed');
