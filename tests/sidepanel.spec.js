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

test('arrow navigation preserves drafts and reading position during streaming', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 });
  await open(page);
  await send(page, 'Long answer');
  await emit(page, { type: 'chunk', text: 'A paragraph of useful context.\n\n'.repeat(65) });
  const body = page.locator('#chatBody');
  const input = page.locator('#chatInput');
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  const bottom = await body.evaluate(el => el.scrollTop);
  await input.press('Alt+ArrowUp');
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeLessThan(bottom);
  const reading = await body.evaluate(el => el.scrollTop);
  await emit(page, { type: 'chunk', text: 'More content.\n\n'.repeat(10) });
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(reading);
  await input.fill('My draft\nSecond line');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('My draft\nSecond line');
  expect(await body.evaluate(el => el.scrollTop)).toBe(reading);
  await input.press('Alt+ArrowUp');
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeLessThan(reading);
  await page.getByRole('button', { name: 'Latest message' }).click();
  await expect.poll(() => body.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
  await body.focus();
  await body.press('Home');
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(0);
  await body.press('ArrowDown');
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
});

test('composer arrows recall sent prompts and restore the unsent draft', async ({ page }) => {
  await open(page);
  const input = page.locator('#chatInput');
  await input.fill('Unsent draft');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('Unsent draft');
  for (const prompt of ['First prompt', 'Second prompt\nwith another line']) {
    await send(page, prompt);
    await emit(page, { type: 'chunk', text: 'Answer' });
    await emit(page, { type: 'done' });
  }
  await input.fill('Unsent draft');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('Second prompt\nwith another line');
  await input.press('ArrowUp');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('First prompt');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('Second prompt\nwith another line');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('Unsent draft');
  await input.press('ArrowUp');
  await input.fill('Edited recalled prompt');
  await input.press('Enter');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('Edited recalled prompt');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('');
  expect(await portCount(page)).toBe(3);
});

test('activity shows tools and public summaries, stays separate from answer and history', async ({ page }) => {
  await open(page);
  await send(page, 'Find context');
  await expect(page.locator('.op-activity')).not.toHaveAttribute('open');
  await expect(page.locator('.op-activity-body')).toBeHidden();
  await page.locator('.op-activity > summary').click();
  await emit(page, { type: 'activity', activity: { type: 'tool.dispatch', toolName: 'search', callId: '1' } });
  await expect(page.locator('.op-activity summary')).toContainText('Using search');
  await emit(page, { type: 'activity', activity: { type: 'reasoning.summary', text: '<img src=x onerror=alert(1)>Checking sources.' } });
  await expect(page.locator('.op-activity-reasoning')).toContainText('Checking sources.');
  await expect(page.locator('.op-activity img')).toHaveCount(0);
  await emit(page, { type: 'activity', activity: { type: 'tool.result', toolName: 'search', callId: '1', ok: true } });
  await expect(page.locator('.op-activity li').filter({ hasText: 'search' })).toContainText('Done');
  await emit(page, { type: 'chunk', text: 'The answer.' });
  await emit(page, { type: 'done' });
  await expect(page.locator('.op-activity')).toHaveAttribute('open');
  await expect(page.locator('.op-activity-reasoning')).toBeVisible();
  await page.locator('.op-activity > summary').press('Enter');
  await expect(page.locator('.op-activity-body')).toBeHidden();
  await send(page, 'Follow up');
  const payload = (await lastPosted(page))[0];
  expect(JSON.stringify(payload.messages)).not.toContain('Checking sources');
  expect(JSON.stringify(payload.messages)).not.toContain('tool.dispatch');
});

test('partial errors settle activity and remove every busy indicator', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'Partial answer' });
  await emit(page, { type: 'error', error: 'Connection failed' });
  await expect(page.locator('.sp-error')).toContainText('Connection failed');
  await expect(page.locator('.sp-streaming')).toHaveCount(0);
  await expect(page.locator('.op-activity summary')).toContainText('Request failed');
  await expect(page.locator('.sp-msg-assistant')).toHaveText('Partial answer');
});

test('activity reports available tools, actual calls and tool result details', async ({ page }) => {
  await open(page);
  await send(page, 'Look up resources');
  await page.locator('.op-activity > summary').click();
  await emit(page, { type: 'activity', activity: { type: 'tools.available', count: 1, tools: [{ name: 'a2a_lookup', skillName: 'Cloud lookup', serverName: 'Cloud agent' }] } });
  await expect(page.locator('.op-activity-tools')).toContainText('1 tools available');
  await page.getByText('Available tools', { exact: true }).click();
  await expect(page.locator('.op-activity-tools')).toContainText('Cloud agent');
  await emit(page, { type: 'activity', activity: { type: 'tool.dispatch', callId: '0:0', toolName: 'a2a_lookup' } });
  await emit(page, { type: 'activity', activity: { type: 'tool.details', callId: '0:0', toolName: 'a2a_lookup', serverName: 'Cloud agent', skillName: 'Cloud lookup' } });
  const call = page.locator('.op-activity-body > ol li').filter({ hasText: 'a2a_lookup' });
  await expect(call).toContainText('Cloud agent · Cloud lookup');
  await expect(call).toContainText('Running');
  await emit(page, { type: 'activity', activity: { type: 'tool.result', callId: '0:0', toolName: 'a2a_lookup', ok: true } });
  await emit(page, { type: 'activity', activity: { type: 'tool.details', callId: '0:0', toolName: 'a2a_lookup', serverName: 'Cloud agent', skillName: 'Cloud lookup', durationMs: 1234, textLen: 230 } });
  await expect(call).toContainText('1.2s · 230 response characters');
  await expect(call).toContainText('Done');
});

test('activity explains when discovery finds no tools', async ({ page }) => {
  await open(page);
  await send(page, 'Hello');
  await emit(page, { type: 'activity', activity: { type: 'tools.unavailable', reason: 'none_configured' } });
  await emit(page, { type: 'chunk', text: 'Hello!' });
  await emit(page, { type: 'done' });
  await expect(page.locator('.op-activity')).not.toHaveAttribute('open');
  await page.locator('.op-activity > summary').click();
  await expect(page.locator('.op-activity-tools')).toContainText('No enabled agent tools');
  await expect(page.locator('.op-activity-tools')).toContainText('No tool calls were reported');
});

test('compact chat remains within a narrow viewport with usable targets', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const selector of ['#sendBtn', '.sp-starters button', '#chatInput']) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});

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

test('sending immediately shows a visible thinking indicator', async ({ page }) => {
  await open(page);
  await send(page, 'Hello there');

  const indicator = page.locator('.sp-thinking');
  await expect(indicator).toBeVisible();
  await expect(indicator).toContainText('Thinking…');
  await expect(indicator).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#chatBody')).toHaveAttribute('aria-busy', 'true');
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

test('an error remains visible alongside partial text', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'chunk', text: 'partial' });
  await emit(page, { type: 'error', error: 'Provider exploded' });

  await expect(page.locator('.sp-error')).toHaveText('Provider exploded');
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

test('the panel exposes semantic landmarks without making streamed tokens live', async ({ page }) => {
  await open(page);

  await expect(page.locator('main.sp-shell')).toHaveCount(1);
  await expect(page.locator('header.sp-header')).toHaveCount(1);
  await expect(page.locator('section.sp-toolbar[aria-label="Conversation settings"]')).toHaveCount(1);
  await expect(page.locator('section.sp-body[role="log"][aria-label="Conversation"]')).toHaveCount(1);
  await expect(page.locator('form.sp-input-area[aria-label="Message composer"]')).toHaveCount(1);
  await expect(page.locator('#chatBody')).not.toHaveAttribute('aria-live', /.+/);
  await expect(page.locator('.sp-sr-status')).toHaveAttribute('aria-live', 'polite');
});

test('status announcements are concise and streaming chunks do not rewrite them', async ({ page }) => {
  await open(page);
  await send(page, 'Hi');
  await emit(page, { type: 'status', status: 'thinking' });
  await expect(page.locator('.sp-sr-status')).toHaveText('Thinking…');

  await emit(page, { type: 'chunk', text: 'One' });
  await emit(page, { type: 'chunk', text: ' two' });
  await expect(page.locator('.sp-sr-status')).toHaveText('Writing response…');

  await emit(page, { type: 'done' });
  await expect(page.locator('.sp-sr-status')).toHaveText('Response complete. One two');
});

test('primary controls provide effective 44 pixel targets', async ({ page }) => {
  await open(page);

  const heights = await page.locator('.sp-chip, .sp-context, #chatInput, #sendBtn').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().height)
  );
  expect(heights.every(height => height >= 44)).toBe(true);
});

test('selectors stay within a narrow side panel viewport', async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 620 });
  await open(page);
  await page.click('#spModelChip');

  const bounds = await page.locator('#spModelChip-selector').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(280);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(620);
});

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

test('a port that never responds keeps showing the thinking indicator', async ({ page }) => {
  // Existing behavior: the watchdog is armed by incoming messages, so a port
  // that stays completely silent leaves the turn pending indefinitely.
  // The pending request remains visible even before the background sends its
  // first status or content event.
  await page.clock.install();
  await open(page);
  await send(page, 'Hi');

  await page.clock.fastForward(WATCHDOG_MS + 1000);

  await expect(page.locator('.sp-error')).toHaveCount(0);
  await expect(page.locator('.sp-thinking')).toContainText('Thinking…');
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
