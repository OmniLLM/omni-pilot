// Oracle for page content extraction.
//
// The reported bug: clicking Summarize sometimes described something unrelated
// to the page. The captured content turned out to be a promotional banner that
// happened to sit in the first <article> element on the page, which the old
// extractor took unconditionally as soon as it held more than 50 characters.
//
// These tests pin what the extractor is supposed to reach for: the real content
// landmark, with page chrome left out.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const contentSource = fs.readFileSync(path.resolve(__dirname, '..', 'dist', 'content.js'), 'utf8');

const LESSON = [
  'Microsoft Copilot Chat is a generative AI powered chat experience that is grounded in web data.',
  'It is available to every user signed in with a work account at no extra licensing cost.',
  'The chat experience keeps enterprise data protection in place, meaning prompts and responses are not used to train the underlying foundation models.',
  'Throughout this module you will learn how to write effective prompts, how to iterate on a response that is close but not quite right, and how to recognise the situations in which a generative answer should be verified against a primary source.',
  'You will also compare the free chat experience against the licensed Microsoft 365 Copilot experience, which can additionally reason over your organisational documents, meetings and mail.'
].join(' ');

const PROMO = 'Microsoft Ignite. Register now to join us online or in person for three days of sessions, hands on labs and expert connections. Save the date and secure your seat today.';

// Loads a fixture page, injects the content script and returns the text that a
// summarize action would be given.
async function extract(page, body) {
  await page.goto('about:blank');
  await page.setContent('<!DOCTYPE html><html><head></head><body style="padding:20px">' + body + '</body></html>');
  return page.evaluate(contentSource => {
    let pageContextHandler = null;
    window.chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener(fn) { pageContextHandler = fn; } },
        connect() { return { onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} }; },
        sendMessage(message, callback) { if (typeof callback === 'function') callback({ success: true }); },
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

    let captured = null;
    pageContextHandler({ type: 'GET_PAGE_CONTEXT' }, {}, response => { captured = response; });
    return captured;
  }, contentSource);
}

test('a promo banner in the first article does not stand in for the page', async ({ page }) => {
  // The shape of the reported page: an announcement card ahead of the lesson.
  const response = await extract(page, `
    <article class="promo"><h2>Microsoft Ignite</h2><p>${PROMO}</p></article>
    <main><h1>Understand Microsoft Copilot Chat</h1><p>${LESSON}</p></main>
  `);

  expect(response.success).toBe(true);
  expect(response.content).toContain('generative AI powered chat experience');
  expect(response.content).not.toContain('Register now');
});

test('the richest article wins when there is no main landmark', async ({ page }) => {
  const response = await extract(page, `
    <article class="promo"><p>${PROMO}</p></article>
    <article class="lesson"><p>${LESSON}</p></article>
  `);

  expect(response.content).toContain('enterprise data protection');
  expect(response.content).not.toContain('secure your seat');
});

test('navigation, headers and footers are left out of the content', async ({ page }) => {
  const response = await extract(page, `
    <header>Skip to main content Sign in Contact sales</header>
    <nav><a href="/">Documentation</a><a href="/t">Training</a><a href="/c">Certifications</a></nav>
    <main><p>${LESSON}</p></main>
    <aside>Related modules you might also like</aside>
    <footer>Privacy policy Terms of use Trademarks Cookie preferences</footer>
  `);

  expect(response.content).toContain('write effective prompts');
  expect(response.content).not.toContain('Contact sales');
  expect(response.content).not.toContain('Certifications');
  expect(response.content).not.toContain('Related modules');
  expect(response.content).not.toContain('Privacy policy');
});

test('a cookie dialog is not mistaken for the page', async ({ page }) => {
  const response = await extract(page, `
    <div role="dialog"><p>We use optional cookies to improve your experience on our websites, such as through social media connections, and to display advertising based on your online activity.</p></div>
    <main><p>${LESSON}</p></main>
  `);

  expect(response.content).toContain('foundation models');
  expect(response.content).not.toContain('optional cookies');
});

test('block boundaries survive as line breaks', async ({ page }) => {
  const response = await extract(page, `
    <main><h1>Understand Microsoft Copilot Chat</h1><p>${LESSON}</p>
    <ul><li>Write effective prompts</li><li>Iterate on a response</li></ul></main>
  `);

  expect(response.content).toContain('\n');
  expect(response.content).toMatch(/Write effective prompts\s*\n\s*Iterate on a response/);
});

test('a short page still yields its content rather than nothing', async ({ page }) => {
  const response = await extract(page, '<main><p>A brief note about the release.</p></main>');

  expect(response.content).toContain('A brief note about the release.');
});

test('hidden content is not captured', async ({ page }) => {
  const response = await extract(page, `
    <main><p>${LESSON}</p><div aria-hidden="true">Screen reader only announcement text</div></main>
  `);

  expect(response.content).not.toContain('Screen reader only');
});
