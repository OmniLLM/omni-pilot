# Floating Panel GitHub Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clicking the OmniPilot title in the in-page floating panel open `https://github.com/OmniLLM/omni-pilot`.

**Architecture:** The extension popup already uses a normal anchor for the repository link. The content-script floating panel should match that behavior by rendering the panel title as an anchor and excluding title clicks from header dragging. The content script runs on arbitrary pages, so tests will stub `window.open` and assert the exact URL and options.

**Tech Stack:** Chrome extension Manifest V3, plain JavaScript content script, Node.js unit tests with `vm` and `assert`.

---

## File Structure

- Modify `content-language.test.js`: add a focused regression test that opens the floating panel, clicks the title link, and verifies the repository URL opens in a new tab.
- Modify `content.js`: add a repository URL constant, render `.omnipilot-panel-title` as an anchor, and stop title clicks from starting panel drag.
- Modify `styles.css`: keep the anchor visually consistent with the existing title and add accessible focus/hover affordances.

---

### Task 1: Add Regression Test

**Files:**
- Modify: `content-language.test.js`

- [ ] **Step 1: Add `window.open` capture to `createContentContext`**

In `content-language.test.js`, add `openedUrls` next to `sendMessageCalls`, add `open()` to the fake `window`, and return `openedUrls` from `createContentContext`:

```js
const sendMessageCalls = [];
const openedUrls = [];
```

```js
window: {
  innerWidth: 1024,
  innerHeight: 768,
  open(url, target, features) {
    openedUrls.push({ url, target, features });
  },
  getSelection() {
```

```js
return {
  documentRef,
  storageListeners,
  context,
  sendMessageCalls,
  openedUrls,
  syncWrites,
```

- [ ] **Step 2: Add the failing test**

Add this function before `testOpenPanelAppendsNewSelectionContext()`:

```js
async function testPanelTitleOpensRepository() {
  const { documentRef, openedUrls, setSelectionText } = await createContentContext({ apiKey: 'test-key', languagePreference: 'en' });

  await selectText(documentRef, setSelectionText, 'selected text');
  documentRef.getElementById('omnipilot-bubble').listeners.click({ preventDefault() {}, stopPropagation() {} });
  documentRef.getElementById('omnipilot-dropdown').children[0].listeners.click({ preventDefault() {}, stopPropagation() {} });

  const title = documentRef.getElementById('omnipilot-panel').querySelector('.omnipilot-panel-title');
  assert.ok(title, 'panel title should be rendered');

  title.listeners.click({ preventDefault() {}, stopPropagation() {} });

  assert.deepStrictEqual(openedUrls, [{
    url: 'https://github.com/OmniLLM/omni-pilot',
    target: '_blank',
    features: 'noopener,noreferrer'
  }]);
}
```

Call it from `main()` before the existing open-panel tests:

```js
await testPanelTitleOpensRepository();
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
node content-language.test.js
```

Expected: FAIL because `.omnipilot-panel-title` has no click listener yet, so `openedUrls` remains empty or the test cannot call the missing listener.

---

### Task 2: Implement Link Behavior

**Files:**
- Modify: `content.js`
- Modify: `styles.css`

- [ ] **Step 1: Add the repository URL constant**

In `content.js`, near the other top-level constants after `selectionContextSeq`, add:

```js
const REPOSITORY_URL = 'https://github.com/OmniLLM/omni-pilot';
```

- [ ] **Step 2: Render the panel title as a link**

In `showPanel()`, replace the current title span in `header.innerHTML`:

```js
header.innerHTML = `<a class="omnipilot-panel-title" href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer" title="Open OmniPilot on GitHub">✦ OmniPilot</a>
```

Keep the rest of the header markup unchanged.

- [ ] **Step 3: Add the title click handler**

After `header.innerHTML = ...`, add:

```js
const titleLink = header.querySelector('.omnipilot-panel-title');
titleLink.addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  window.open(REPOSITORY_URL, '_blank', 'noopener,noreferrer');
});
```

- [ ] **Step 4: Exclude the title from drag start**

Update the header `mousedown` guard to include `.omnipilot-panel-title`:

```js
if (e.target === closeBtn || e.target.closest('.omnipilot-panel-title') || e.target.closest('.omnipilot-meta-action-wrap') || e.target.closest('.omnipilot-meta-provider-wrap') || e.target.closest('.omnipilot-meta-model-wrap')) return;
```

- [ ] **Step 5: Preserve title styling for an anchor**

In `styles.css`, extend `.omnipilot-panel-title`:

```css
.omnipilot-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--op-accent);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-decoration: none;
  cursor: pointer;
  border-radius: var(--op-radius-xs);
  outline: none;
}

.omnipilot-panel-title:hover,
.omnipilot-panel-title:focus-visible {
  text-decoration: underline;
}
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```powershell
node content-language.test.js
```

Expected: PASS.

---

### Task 3: Verify Full Unit Test Suite

**Files:**
- No new edits expected.

- [ ] **Step 1: Run unit tests**

Run:

```powershell
npm run test:unit
```

Expected: all unit tests pass with no unexpected errors.

- [ ] **Step 2: Review git diff**

Run:

```powershell
git diff -- content.js styles.css content-language.test.js docs/superpowers/plans/2026-07-03-floating-panel-github-link.md
```

Expected: diff only contains the title-link behavior, styling, regression test, and this plan.

---

## Self-Review

- Spec coverage: The plan covers the requested exact URL, the floating panel title click, drag conflict avoidance, and regression testing.
- Placeholder scan: No placeholders remain.
- Type/property consistency: The test and implementation both use `.omnipilot-panel-title`, `REPOSITORY_URL`, and `window.open(url, '_blank', 'noopener,noreferrer')` consistently.
