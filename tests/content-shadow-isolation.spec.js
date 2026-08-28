// The content script's UI lives in a shadow root. This suite proves the
// isolation actually holds in a real browser, in both directions:
//
//   * the host page cannot style OmniPilot's UI, and
//   * OmniPilot's stylesheet never reaches the host page.
//
// A hostile host stylesheet is used deliberately — the kind of aggressive
// global rules real sites ship (`* { }`, tag selectors, `!important`).
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'content.js'), 'utf8');

const HOSTILE_CSS = `
  * { font-family: "Comic Sans MS" !important; letter-spacing: 9px !important; }
  div { background: rgb(255, 0, 0) !important; border-radius: 33px !important; }
  button { text-transform: uppercase !important; opacity: 0.05 !important; }
  p { color: rgb(0, 128, 0); }
`;

async function setupPage(page) {
  await page.goto('about:blank');
  await page.setContent(`<!DOCTYPE html><html><head><style>${HOSTILE_CSS}</style></head>` +
    `<body style="padding:40px">` +
    `<p id="para">Bonjour le monde ceci est un texte de test a traduire.</p>` +
    `<div id="hostbox">host box</div>` +
    `</body></html>`);
  await page.evaluate(({ contentSource }) => {
    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        connect(opts) {
          const listeners = [];
          return {
            name: (opts && opts.name) || '',
            onMessage: { addListener(fn) { listeners.push(fn); } },
            onDisconnect: { addListener() {} },
            postMessage() {
              setTimeout(() => {
                for (const fn of listeners) { fn({ type: 'chunk', text: 'reply' }); fn({ type: 'done' }); }
              }, 0);
            },
            disconnect() {}
          };
        },
        sendMessage(message, callback) { callback({ success: true, result: 'reply' }); },
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
  }, { contentSource });
}

async function showBubble(page) {
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
  // The bubble fades in over ~180ms. Sampling computed opacity mid-animation
  // races the keyframes, so wait for them to settle before asserting.
  await page.locator('#omnipilot-bubble').evaluate(async el => {
    await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {})));
  });
}

test('the UI is mounted inside an open shadow root, not in the host document', async ({ page }) => {
  await setupPage(page);
  await showBubble(page);

  const mount = await page.evaluate(() => {
    const host = document.getElementById('omnipilot-extension-host-7f3a9c');
    return {
      hostExists: !!host,
      shadowMode: host && host.shadowRoot ? 'open' : null,
      rootInShadow: !!(host && host.shadowRoot && host.shadowRoot.getElementById('omnipilot-extension-root-7f3a9c')),
      // The light DOM must not contain the UI root at all.
      rootInLightDom: !!document.getElementById('omnipilot-extension-root-7f3a9c')
    };
  });

  expect(mount.hostExists).toBe(true);
  expect(mount.shadowMode).toBe('open');
  expect(mount.rootInShadow).toBe(true);
  expect(mount.rootInLightDom).toBe(false);
});

test('the stylesheet is injected into the shadow root, never the host document', async ({ page }) => {
  await setupPage(page);
  await showBubble(page);

  const styles = await page.evaluate(() => {
    const host = document.getElementById('omnipilot-extension-host-7f3a9c');
    const shadowStyles = [...host.shadowRoot.querySelectorAll('style')].map(s => s.textContent);
    const docStyles = [...document.querySelectorAll('style, link[rel="stylesheet"]')]
      .map(n => n.textContent || n.getAttribute('href') || '');
    return {
      shadowHasOmniPilotCss: shadowStyles.some(t => t.includes('#omnipilot-bubble')),
      documentHasOmniPilotCss: docStyles.some(t => t.includes('#omnipilot-bubble') || t.includes('styles.css'))
    };
  });

  expect(styles.shadowHasOmniPilotCss).toBe(true);
  expect(styles.documentHasOmniPilotCss).toBe(false);
});

test('hostile host-page styles do not reach the OmniPilot UI', async ({ page }) => {
  await setupPage(page);
  await showBubble(page);

  const bubble = page.locator('#omnipilot-bubble');
  const computed = await bubble.evaluate(el => {
    const s = getComputedStyle(el);
    return {
      fontFamily: s.fontFamily,
      letterSpacing: s.letterSpacing,
      textTransform: s.textTransform,
      opacity: s.opacity
    };
  });

  // Every one of these would have been clobbered by the host's `!important`
  // rules if the UI were in the light DOM.
  expect(computed.fontFamily).not.toContain('Comic Sans');
  expect(computed.letterSpacing).not.toBe('9px');
  expect(computed.textTransform).not.toBe('uppercase');
  expect(Number(computed.opacity)).toBeGreaterThan(0.5);
});

test('the host page keeps its own styling once the UI is mounted', async ({ page }) => {
  await setupPage(page);
  await showBubble(page);

  const host = await page.locator('#hostbox').evaluate(el => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, radius: s.borderRadius, color: getComputedStyle(document.querySelector('#para')).color };
  });

  expect(host.background).toBe('rgb(255, 0, 0)');
  expect(host.radius).toBe('33px');
  expect(host.color).toBe('rgb(0, 128, 0)');
});

test('the shadow host itself stays visually inert in the host page layout', async ({ page }) => {
  await setupPage(page);
  await showBubble(page);

  // The host element is a bare div appended to <body>. It must not take up
  // layout space or paint a box of its own, even under hostile `div` rules.
  const box = await page.evaluate(() => {
    const host = document.getElementById('omnipilot-extension-host-7f3a9c');
    const r = host.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });

  expect(box.height).toBe(0);
});
