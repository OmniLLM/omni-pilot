# Isolate the content script UI in a Shadow DOM

## Why

Constraint #2 of this repo has been, until now, a hard blocker:

> The content script has NO Shadow DOM. `dist/styles.css` is injected into every website the user visits.

That single fact is what kept Tier 3 from ever reaching the content script. Two problems follow from it, and both are real today:

1. **We leak into every page on the web.** The manifest injects `dist/styles.css` into every document matching `<all_urls>`. Even though every rule is namespaced under `#omnipilot-extension-root-7f3a9c` or an `#omnipilot-*` id, the stylesheet is still parsed and applied on every site the user visits — a permanent, unbounded surface for visual regressions on pages we have never seen.

2. **Every page on the web leaks into us.** This is the worse direction, and it is not hypothetical. A site shipping `* { font-family: … !important }` or `div { border-radius: 33px !important }` — ordinary, widely-deployed CSS — restyles our bubble and panel, and we have no defence. Specificity cannot beat `!important` from the host.

Because of (2), *no* styling approach for the content script is safe while it shares a cascade with the host page. Adopting a CSS framework there would multiply the exposure, not reduce it. So isolation has to land first, on its own, with the existing behavioural suites as the oracle.

## What Changes

The content script mounts its UI inside an **open** shadow root and carries its own stylesheet inside it.

- **ADDED** a shadow host `<div id="omnipilot-extension-host-7f3a9c">` appended to `document.body`. `attachShadow({ mode: 'open' })` is called on it, and the existing `#omnipilot-extension-root-7f3a9c` element is moved inside that shadow root.
- **ADDED** build-time inlining of the content stylesheet into `dist/content.js` as a single `OMNIPILOT_CONTENT_CSS` string constant, injected as a `<style>` element into the shadow root at mount time.
- **REMOVED** `content_scripts[0].css` from `manifest.json`. Nothing is injected into host documents any more.
- **REMOVED** `dist/styles.css` as a build output — it no longer has a consumer.
- **MODIFIED** the `extension-page-styling` guarantees that were phrased in terms of `dist/styles.css`, to be phrased in terms of the inlined stylesheet, plus a new guarantee that no CSS is injected into host pages at all.

Explicitly **not** in scope: applying Preact or Tailwind to the content script's ~161 DOM mutation sites. This change only removes the blocker. Framework adoption there is a separate, much larger change, and bundling the two would make the behavioural oracle useless — a regression could no longer be attributed to isolation or to the rewrite.

## Impact

- Affected specs: `extension-page-styling`, `extension-page-rendering`
- Affected code: `src/content-script/index.mjs` (`ensureOmniPilotRoot` only), `build.mjs`, `manifest.json`, `Makefile`, `tests/unit/tailwind-build.test.js`, and the three content-script browser harnesses
- `dist/content.js` grows from 117.8 KB to 173.4 KB. This is the stylesheet moving, not new code — the same ~52 KB previously shipped as `dist/styles.css`. The packaged zip goes from 143.5 KB to 144.0 KB; the 0.5 KB delta is JSON string-escaping overhead.

### Constraint compliance

| # | Constraint | How this change satisfies it |
|---|-----------|------------------------------|
| 1 | No IIFE / module-scoped output | `OMNIPILOT_CONTENT_CSS` is a top-level `const` in the concatenated bundle, following the existing inlining pattern. No wrapper is introduced. |
| 2 | Content script has no Shadow DOM | **This constraint is what the change retires.** It is rewritten in `openspec/config.yaml`. |
| 3 | MV3 CSP | The stylesheet is a build-time string literal injected via `style.textContent`. No `eval`, no CDN, no runtime compilation. |
| 4 | Square corners | `src/content-script/styles.css` is byte-for-byte unchanged, so `square-corners.test.js` is unaffected. |
| 5 | Policy compliance | No permission changes; removing `content_scripts.css` only narrows what we touch. `pack.mjs` ENTRIES are unchanged. |
| 6 | UI interleaved with functional logic | Only `ensureOmniPilotRoot` is touched. Every call site uses the `getUiMount()` accessor and is unmodified. |
