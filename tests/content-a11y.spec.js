// Oracle for the floating panel's accessibility contract:
//  - one status live region whose role never changes and whose politeness is
//    escalated through aria-live,
//  - a busy state on the streaming assistant message,
//  - decorative brand glyphs kept out of the accessibility tree.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'content.js'), 'utf8');

// 'done'            → every stream completes normally
// 'stall'           → a chunk arrives and the stream never finishes, so the
//                     in-flight (busy) state stays observable
// 'error-then-done' → the first stream fails, later streams succeed
async function setupPage(page, mode = 'done') {
  await page.goto('about:blank');
  await page.setContent('<!DOCTYPE html><html><head></head>' +
    '<body style="padding:40px">' +
    '<p id="para">Bonjour le monde ceci est un texte de test a traduire.</p>' +
    '</body></html>');
  await page.evaluate(({ contentSource, mode }) => {
    window.__streams = 0;
    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        connect(opts) {
          const listeners = [];
          const index = window.__streams++;
          return {
            name: (opts && opts.name) || '',
            onMessage: { addListener(fn) { listeners.push(fn); } },
            onDisconnect: { addListener() {} },
            postMessage() {
              setTimeout(() => {
                const emit = m => { for (const fn of listeners) fn(m); };
                if (mode === 'stall') return emit({ type: 'chunk', text: 'partial reply' });
                if (mode === 'error-then-done' && index === 0) return emit({ type: 'error', error: 'boom' });
                emit({ type: 'chunk', text: 'reply' });
                emit({ type: 'done' });
              }, 0);
            },
            disconnect() {}
          };
        },
        sendMessage(message, callback) {
          if (typeof callback !== 'function') return;
          if (message.type === 'GET_MODELS') return callback({ models: ['gpt-4o'] });
          return callback({ success: true, result: 'reply' });
        },
        openOptionsPage() {}
      },
      storage: {
        sync: { get(d, cb) { cb({ ...d, apiKey: 'k', languagePreference: 'en' }); }, set(v, cb = () => {}) { cb(); } },
        local: { get(k, cb) { cb({}); }, set(v, cb = () => {}) { cb(); } },
        onChanged: { addListener() {} }
      }
    };
    // eslint-disable-next-line no-eval
    window.eval(contentSource);
  }, { contentSource, mode });
}

async function selectParagraph(page) {
  await page.evaluate(() => {
    const node = document.querySelector('#para');
    const range = document.createRange();
    range.selectNodeContents(node);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    const r = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
  });
  await page.locator('#omnipilot-bubble').waitFor({ state: 'visible' });
}

async function openPanel(page) {
  await selectParagraph(page);
  await page.locator('#omnipilot-bubble').click();
  await page.locator('#omnipilot-dropdown .omnipilot-dropdown-item').first().click();
  await page.locator('#omnipilot-panel').waitFor({ state: 'visible' });
}

// ── Status live region ─────────────────────────────────────────────────────

test('the status region is a stable, atomic, polite region for routine status', async ({ page }) => {
  await setupPage(page, 'done');
  await openPanel(page);

  const status = page.locator('#omnipilot-panel-status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(status).toHaveAttribute('aria-live', 'polite');
});

test('a stream error escalates the status region without reassigning its role', async ({ page }) => {
  await setupPage(page, 'error-then-done');
  await openPanel(page);

  await page.locator('.omnipilot-error').waitFor({ state: 'visible' });

  const status = page.locator('#omnipilot-panel-status');
  // role="alert" would be overridden by the region's explicit aria-live, so the
  // urgency has to come from aria-live itself.
  await expect(status).toHaveAttribute('aria-live', 'assertive');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).not.toHaveText('');
});

// ── Streaming busy state ───────────────────────────────────────────────────

test('a streaming assistant message reports busy', async ({ page }) => {
  await setupPage(page, 'stall');
  await openPanel(page);

  const streaming = page.locator('.omnipilot-msg-assistant.omnipilot-streaming');
  await streaming.waitFor({ state: 'visible' });
  await expect(streaming).toHaveAttribute('aria-busy', 'true');
});

test('a finalized assistant message reports not busy', async ({ page }) => {
  await setupPage(page, 'done');
  await openPanel(page);

  const message = page.locator('.omnipilot-msg-assistant').first();
  await message.waitFor({ state: 'visible' });
  await expect(message).toHaveAttribute('aria-busy', 'false');
  await expect(message).not.toHaveClass(/omnipilot-streaming/);
});

// ── Decorative glyphs ──────────────────────────────────────────────────────

test('the selection bubble glyph is not announced', async ({ page }) => {
  await setupPage(page, 'done');
  await selectParagraph(page);

  await expect(page.locator('#omnipilot-bubble .omnipilot-icon')).toHaveAttribute('aria-hidden', 'true');
  // The glyph must not leak into the control's accessible name, which comes
  // entirely from aria-label.
  await expect(page.locator('#omnipilot-bubble')).not.toHaveAccessibleName(/✦/);
});

test('the panel heading glyph is not announced', async ({ page }) => {
  await setupPage(page, 'done');
  await openPanel(page);

  await expect(page.locator('.omnipilot-panel-title span[aria-hidden="true"]')).toHaveCount(1);
  const name = await page.locator('#omnipilot-panel').evaluate(el => {
    const heading = el.getRootNode().querySelector('#omnipilot-panel-heading');
    return heading ? heading.textContent : '';
  });
  // The glyph is still rendered, but it is inside an aria-hidden span.
  expect(name).toContain('✦');
  await expect(page.locator('#omnipilot-panel-heading')).not.toHaveAccessibleName(/✦/);
});

test('message avatars are not announced on either speaker', async ({ page }) => {
  await setupPage(page, 'done');
  await openPanel(page);

  await page.locator('.omnipilot-msg-assistant').first().waitFor({ state: 'visible' });
  await page.locator('#omnipilot-panel-input').fill('follow up question');
  await page.locator('#omnipilot-panel-input').press('Enter');
  await page.locator('.omnipilot-msg-user').first().waitFor({ state: 'visible' });

  const avatars = page.locator('.omnipilot-msg-header-avatar');
  const count = await avatars.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i += 1) {
    await expect(avatars.nth(i)).toHaveAttribute('aria-hidden', 'true');
  }
});

test('the minimized orb glyph is not announced', async ({ page }) => {
  await setupPage(page, 'done');
  await openPanel(page);

  await page.locator('.omnipilot-minimize-btn').click();
  const orb = page.locator('#omnipilot-minimized-orb');
  await orb.waitFor({ state: 'visible' });

  await expect(orb.locator('.omnipilot-orb-icon')).toHaveAttribute('aria-hidden', 'true');
  await expect(orb).toHaveAccessibleName(/restore/i);
});
