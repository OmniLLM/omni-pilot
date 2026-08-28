// End-to-end coverage for the side panel.
//
// Written against the CURRENT imperative implementation, deliberately, so it
// can act as the regression oracle when the panel is converted to a component
// model. If any assertion here needs editing during that conversion, behavior
// drifted and the code is wrong — not the test.
//
// The panel is loaded straight from dist/ over file:// with a scripted
// chrome.* stub installed before the bundle runs. The stub's ports are
// controllable, so streaming, errors, and disconnects can be driven precisely.
const { test, expect } = require('@playwright/test');
const path = require('path');

const SIDEPANEL_URL = 'file:///' + path.resolve(__dirname, '..', 'dist', 'sidepanel.html').replace(/\\/g, '/');

const PORT_NAME = 'omnipilot-stream';
const NO_RESPONSE = 'No response received.';
const TIMED_OUT = 'No response. The assistant may have timed out — try again.';

// The watchdog is armed from RESPONSE_TIMEOUT_DEFAULT_MS (5 minutes), which the
// storage stub returns unchanged. Watchdog tests use Playwright's fake clock
// rather than waiting in real time.
const WATCHDOG_MS = 5 * 60 * 1000;

async function installChromeStub(page) {
  await page.addInitScript(() => {
    const ports = [];
    window.__ports = ports;
    window.__writes = [];
    window.__changeListeners = [];
    window.__lastPort = () => ports[ports.length - 1];
    window.__fireChange = (changes, area = 'sync') => {
      window.__changeListeners.slice().forEach(fn => fn(changes, area));
    };

    window.chrome = {
      runtime: {
        connect(info) {
          const onMessage = [];
          const onDisconnect = [];
          const port = {
            name: info && info.name,
            posted: [],
            disconnected: false,
            onMessage: { addListener: fn => onMessage.push(fn) },
            onDisconnect: { addListener: fn => onDisconnect.push(fn) },
            postMessage(message) { port.posted.push(message); },
            disconnect() { port.disconnected = true; },
            // Test-only drivers.
            emit(message) { onMessage.slice().forEach(fn => fn(message)); },
            fireDisconnect() { onDisconnect.slice().forEach(fn => fn()); }
          };
          ports.push(port);
          return port;
        },
        openOptionsPage() {}
      },
      storage: {
        sync: {
          get(defaults, callback) { callback({ ...defaults }); },
          set(values, callback = () => {}) { window.__writes.push(values); callback(); }
        },
        local: {
          get(_keys, callback) { callback({}); },
          set(_values, callback = () => {}) { callback(); }
        },
        onChanged: {
          addListener(fn) { window.__changeListeners.push(fn); },
          removeListener(fn) {
            const index = window.__changeListeners.indexOf(fn);
            if (index >= 0) window.__changeListeners.splice(index, 1);
          }
        }
      }
    };
  });
}

async function open(page) {
  await installChromeStub(page);
  await page.goto(SIDEPANEL_URL);
}

async function send(page, text) {
  await page.fill('#chatInput', text);
  await page.click('#sendBtn');
}

async function emit(page, message) {
  await page.evaluate(m => window.__lastPort().emit(m), message);
}

async function disconnect(page) {
  await page.evaluate(() => window.__lastPort().fireDisconnect());
}

const portCount = page => page.evaluate(() => window.__ports.length);
const lastPosted = page => page.evaluate(() => window.__lastPort().posted);

// ── Composing and sending ────────────────────────────────────────────────

test('the empty state is shown before any conversation', async ({ page }) => {
  await open(page);
  await expect(page.locator('.sp-empty')).toBeVisible();
});

test('sending replaces the empty state with the user message', async ({ page }) => {
  await open(page);
  await send(page, 'Hello there');

  await expect(page.locator('.sp-empty')).toHaveCount(0);
  await expect(page.locator('.sp-msg-user')).toHaveText('Hello there');
});

test('sending clears the input and resets its height', async ({ page }) => {
  await open(page);
  await send(page, 'Hello there');

  await expect(page.locator('#chatInput')).toHaveValue('');
  expect(await page.evaluate(() => document.getElementById('chatInput').style.height)).toBe('auto');
});

test('whitespace-only input is not sent', async ({ page }) => {
  await open(page);
  await send(page, '    ');

  expect(await portCount(page)).toBe(0);
  await expect(page.locator('.sp-empty')).toBeVisible();
  await expect(page.locator('.sp-msg')).toHaveCount(0);
});

test('Enter sends and Shift+Enter does not', async ({ page }) => {
  await open(page);

  await page.fill('#chatInput', 'first');
  await page.press('#chatInput', 'Enter');
  expect(await portCount(page)).toBe(1);

  await page.fill('#chatInput', 'second');
  await page.press('#chatInput', 'Shift+Enter');
  expect(await portCount(page)).toBe(1);
});

test('the stream port is opened with the expected name and payload', async ({ page }) => {
  await open(page);
  await send(page, 'Hello there');

  expect(await page.evaluate(() => window.__lastPort().name)).toBe(PORT_NAME);
  expect(await lastPosted(page)).toEqual([
    { type: 'AI_CHAT_STREAM', messages: [{ role: 'user', content: 'Hello there' }] }
  ]);
});

// ── Streaming ────────────────────────────────────────────────────────────

test('chunks accumulate into a single streaming bubble', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');

  await emit(page, { type: 'chunk', text: 'Hel' });
  await emit(page, { type: 'chunk', text: 'lo' });

  await expect(page.locator('.sp-msg-assistant')).toHaveCount(1);
  await expect(page.locator('.sp-msg-assistant')).toHaveText('Hello');
  await expect(page.locator('.sp-msg-assistant')).toHaveClass(/sp-streaming/);
});

test('completing a stream clears the streaming state and keeps the text', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'Hello' });
  await emit(page, { type: 'done' });

  await expect(page.locator('.sp-msg-assistant')).toHaveText('Hello');
  await expect(page.locator('.sp-streaming')).toHaveCount(0);
});

test('a completed answer is carried into the next request history', async ({ page }) => {
  await open(page);
  await send(page, 'first question');
  await emit(page, { type: 'chunk', text: 'first answer' });
  await emit(page, { type: 'done' });

  await send(page, 'second question');

  expect(await lastPosted(page)).toEqual([
    {
      type: 'AI_CHAT_STREAM',
      messages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second question' }
      ]
    }
  ]);
});

test('the transcript scrolls to the newest content', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  for (let i = 0; i < 40; i += 1) {
    await emit(page, { type: 'chunk', text: `line ${i}\n` });
  }

  const atBottom = await page.evaluate(() => {
    const body = document.getElementById('chatBody');
    return body.scrollHeight - body.scrollTop - body.clientHeight < 2;
  });
  expect(atBottom).toBe(true);
});

// ── Status placeholders ──────────────────────────────────────────────────

for (const [status, label] of [
  ['thinking', 'Thinking…'],
  ['delegating', 'Delegating…'],
  ['anything-else', 'Working…']
]) {
  test(`a "${status}" status shows "${label}" while no text has arrived`, async ({ page }) => {
    await open(page);
    await send(page, 'Hi');
    await emit(page, { type: 'status', status });

    await expect(page.locator('.sp-msg-assistant')).toHaveText(label);
  });
}

test('a status never overwrites text that has already streamed', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'partial' });
  await emit(page, { type: 'status', status: 'thinking' });

  await expect(page.locator('.sp-msg-assistant')).toHaveText('partial');
});

// ── Errors and completion ────────────────────────────────────────────────

test('an error is surfaced when nothing has streamed', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'error', error: 'Provider exploded' });

  await expect(page.locator('.sp-error')).toHaveText('Provider exploded');
});

test('an error is suppressed once text has streamed', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'partial' });
  await emit(page, { type: 'error', error: 'Provider exploded' });

  await expect(page.locator('.sp-error')).toHaveCount(0);
  await expect(page.locator('.sp-msg-assistant')).toHaveText('partial');
});

test('completing with no text reports that no response arrived', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'status', status: 'thinking' });
  await emit(page, { type: 'done' });

  await expect(page.locator('.sp-msg-assistant')).toHaveCount(0);
  await expect(page.locator('.sp-error')).toHaveText(NO_RESPONSE);
});

test('completing with no text does not stack a second error', async ({ page }) => {
  // Existing behavior: the guard checks the whole transcript for any prior
  // error, not just the current turn. Preserved deliberately.
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'error', error: 'Provider exploded' });
  await emit(page, { type: 'done' });

  await expect(page.locator('.sp-error')).toHaveCount(1);
  await expect(page.locator('.sp-error')).toHaveText('Provider exploded');
});

test('the port is disconnected once a stream settles', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'Hello' });
  await emit(page, { type: 'done' });

  expect(await page.evaluate(() => window.__lastPort().disconnected)).toBe(true);
});

test('messages arriving after a stream settles are ignored', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'Hello' });
  await emit(page, { type: 'done' });

  await emit(page, { type: 'chunk', text: ' extra' });
  await emit(page, { type: 'error', error: 'late failure' });

  await expect(page.locator('.sp-msg-assistant')).toHaveText('Hello');
  await expect(page.locator('.sp-error')).toHaveCount(0);
});

// ── Disconnect ───────────────────────────────────────────────────────────

test('an early disconnect keeps partial text and settles it', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'partial answer' });
  await disconnect(page);

  await expect(page.locator('.sp-msg-assistant')).toHaveText('partial answer');
  await expect(page.locator('.sp-streaming')).toHaveCount(0);
  await expect(page.locator('.sp-error')).toHaveCount(0);
});

test('partial text kept after a disconnect is carried into the next request', async ({ page }) => {
  await open(page);
  await send(page, 'first question');
  await emit(page, { type: 'chunk', text: 'partial answer' });
  await disconnect(page);

  await send(page, 'second question');

  expect(await lastPosted(page)).toEqual([
    {
      type: 'AI_CHAT_STREAM',
      messages: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'partial answer' },
        { role: 'user', content: 'second question' }
      ]
    }
  ]);
});

test('a disconnect with no text reports that no response arrived', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'status', status: 'thinking' });
  await disconnect(page);

  await expect(page.locator('.sp-msg-assistant')).toHaveCount(0);
  await expect(page.locator('.sp-error')).toHaveText(NO_RESPONSE);
});

// ── Layout and appearance ────────────────────────────────────────────────

test('the panel keeps its header / transcript / composer column layout', async ({ page }) => {
  await open(page);

  const layout = await page.evaluate(() => {
    const header = document.querySelector('.sp-header');
    const body = document.getElementById('chatBody');
    const composer = document.querySelector('.sp-input-area');
    return {
      order: [header, body, composer].map(el => Boolean(el && el.offsetHeight)),
      headerTop: header.getBoundingClientRect().top,
      bodyTop: body.getBoundingClientRect().top,
      composerTop: composer.getBoundingClientRect().top,
      bodyFillsRemainder: body.getBoundingClientRect().height > 0
    };
  });

  expect(layout.order).toEqual([true, true, true]);
  expect(layout.headerTop).toBeLessThan(layout.bodyTop);
  expect(layout.bodyTop).toBeLessThan(layout.composerTop);
  expect(layout.bodyFillsRemainder).toBe(true);
});

test('the transcript scrolls internally rather than growing the page', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'lorem ipsum dolor sit amet '.repeat(400) });

  const scrollable = await page.evaluate(() => {
    const body = document.getElementById('chatBody');
    return {
      overflows: body.scrollHeight > body.clientHeight,
      withinViewport: body.clientHeight <= window.innerHeight,
      composerVisible: document.querySelector('.sp-input-area').getBoundingClientRect().bottom
        <= window.innerHeight + 1
    };
  });

  expect(scrollable.overflows).toBe(true);
  expect(scrollable.withinViewport).toBe(true);
  expect(scrollable.composerVisible).toBe(true);
});

test('the appearance controller applies theme attributes to the document', async ({ page }) => {
  await open(page);

  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-surface', 'sidepanel');
  await expect(root).toHaveAttribute('data-theme', /^(light|dark)$/);
  await expect(root).toHaveAttribute('data-visual-style', /.+/);
});

test('the side panel never writes appearance preferences', async ({ page }) => {
  // It is a consumer of appearance settings, not an editor of them.
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'Hello' });
  await emit(page, { type: 'done' });

  expect(await page.evaluate(() => window.__writes)).toEqual([]);
});

test('an appearance change made elsewhere is applied to the panel', async ({ page }) => {
  await open(page);

  await page.evaluate(() => window.__fireChange({
    visualStylePreference: { newValue: 'neo-brutalist' }
  }));

  await expect(page.locator('html')).toHaveAttribute('data-visual-style', 'neo-brutalist');
  expect(await page.evaluate(() => window.__writes)).toEqual([]);
});

// ── Watchdog ─────────────────────────────────────────────────────────────

test('a stream that goes silent after a status reports a timeout', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'status', status: 'thinking' });

  await page.clock.fastForward(WATCHDOG_MS + 1000);

  await expect(page.locator('.sp-error')).toHaveText(TIMED_OUT);
});

test('a port that never responds at all does not arm the watchdog', async ({ page }) => {
  // Existing behavior: the watchdog is armed by incoming messages, so a port
  // that stays completely silent leaves the turn pending indefinitely.
  // Documented here so the component conversion preserves it rather than
  // silently changing it.
  await page.clock.install();
  await open(page);
  await send(page, 'Hi');

  await page.clock.fastForward(WATCHDOG_MS + 1000);

  await expect(page.locator('.sp-error')).toHaveCount(0);
  await expect(page.locator('.sp-msg-assistant')).toHaveCount(0);
});

test('a stream that goes silent after partial text keeps the text', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'partial answer' });

  await page.clock.fastForward(WATCHDOG_MS + 1000);

  await expect(page.locator('.sp-msg-assistant')).toHaveText('partial answer');
  await expect(page.locator('.sp-streaming')).toHaveCount(0);
  await expect(page.locator('.sp-error')).toHaveCount(0);
});

test('activity re-arms the watchdog so long streams are not cut off', async ({ page }) => {
  await page.clock.install();
  await open(page);
  await send(page, 'Hi');

  // Arm the watchdog, then let it nearly expire three times, re-arming with
  // activity just before each deadline.
  await emit(page, { type: 'chunk', text: 'start ' });
  for (let i = 0; i < 3; i += 1) {
    await page.clock.fastForward(WATCHDOG_MS - 30000);
    await emit(page, { type: 'chunk', text: `chunk ${i} ` });
  }

  await expect(page.locator('.sp-error')).toHaveCount(0);
  await expect(page.locator('.sp-msg-assistant')).toHaveClass(/sp-streaming/);
});
