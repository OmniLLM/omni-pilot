const assert = require('assert')

async function main() {
  const timeout = await import('../../src/utils/timeout.mjs')

  assert.strictEqual(timeout.normalizeResponseTimeoutMs(undefined), 300000)
  assert.strictEqual(timeout.normalizeResponseTimeoutMs(''), 300000)
  assert.strictEqual(timeout.normalizeResponseTimeoutMs(1000), 30000)
  assert.strictEqual(timeout.normalizeResponseTimeoutMs(9999999), 1800000)
  assert.strictEqual(timeout.responseTimeoutMinutesToMs(0.1), 30000)
  assert.strictEqual(timeout.responseTimeoutMinutesToMs(5), 300000)
  assert.strictEqual(timeout.responseTimeoutMsToMinutes(300000), 5)
  assert.strictEqual(timeout.formatResponseTimeoutDuration(30000), '30 seconds')
  assert.strictEqual(timeout.formatResponseTimeoutDuration(300000), '5 minutes')
  assert.strictEqual(timeout.createResponseTimeoutMessage(300000), 'Response timed out after 5 minutes.')

  const fs = require('fs')
  const vm = require('vm')
  const deadlineSource = fs.readFileSync('src/background/agent/deadline.mjs', 'utf8')
    .replace(/^export\s*\{[\s\S]*?\};?\s*$/m, '')
  let abortListener
  let timerCallback
  let cleared = false
  class FakeAbortController {
    constructor() {
      this.signal = { aborted: false, addEventListener(_type, listener) { abortListener = listener } }
    }
    abort() {
      this.signal.aborted = true
      abortListener?.()
    }
  }
  const context = {
    normalizeResponseTimeoutMs: timeout.normalizeResponseTimeoutMs,
    createResponseTimeoutMessage: timeout.createResponseTimeoutMessage,
    AbortController: FakeAbortController,
    setTimeout(callback) { timerCallback = callback; return 1 },
    clearTimeout() { cleared = true },
    Date,
    Error
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(deadlineSource, context)
  const deadline = context.createResponseDeadline(300000, { now: () => 0 })
  assert.ok(deadline.signal)
  timerCallback()
  assert.strictEqual(deadline.timedOut, true)
  assert.strictEqual(deadline.toError(new Error('aborted')).message, 'Response timed out after 5 minutes.')
  deadline.clear()
  assert.strictEqual(cleared, true)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
