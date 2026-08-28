# Tasks — Preact on the popup and side panel

## 1. Baseline and safety net

- [x] 1.1 Run `npm run test:unit` and `npx playwright test`; record that all tests pass before any change.
- [x] 1.2 Run `node build.mjs` and record SHA-256 hashes of every `dist/*` file. These are the containment baseline.
- [x] 1.3 Write `tests/sidepanel.spec.js` against the **current** implementation, covering: empty state; send via click and via Enter (and that Shift+Enter does not send); whitespace-only input is ignored; input clears and its height resets; streaming chunks accumulate into one bubble; the streaming class is present while streaming and removed on `done`; `status` shows a placeholder only when no text has accumulated; `error` renders only when no text has accumulated; `done` with no text renders "No response received."; `done` with no text does **not** add a second error when one already exists; disconnect with partial text keeps the text; disconnect with no text renders the error.
- [x] 1.4 Confirm 1.3 passes against unmodified code. **Do not proceed until it does** — this is the regression oracle for step 4.
- [x] 1.5 Write `tests/popup.spec.js` against the **current** implementation, covering: ready vs not-configured status for each of the three readiness conditions; the `.ok` class toggling; theme, visual-style, and language selects reflecting stored values; changes persisting to storage; external storage changes updating the view; the settings button opening the options page.
- [x] 1.6 Confirm 1.5 passes against unmodified code.

## 2. Vendor the runtime

- [x] 2.1 Confirm `preact` and `htm` are in `devDependencies` only, and that `dependencies` stays empty.
- [x] 2.2 In `build.mjs`, read `node_modules/htm/preact/standalone.umd.js` raw — no `stripExports`, no `stripUtilityImports` — and prefix it with `;` to defuse the ASI hazard.
- [x] 2.3 Add `needsPreact` to the `entries` array, `true` for `popup` and `sidepanel` only, and push the runtime into `parts` **before** the entry source.
- [x] 2.4 Run the build; confirm `dist/background.js`, `dist/content.js`, and `dist/options.js` still match their 1.2 hashes exactly.
- [x] 2.5 Write `tests/unit/preact-build.test.js`: the runtime and `htmPreact` are present in `dist/popup.js` and `dist/sidepanel.js`; absent from `dist/background.js` and `dist/content.js`; loading both bundles with `vm.runInContext` exposes `htmPreact` **and** a top-level `function` declared after it; no `eval(` or `new Function(` introduced; no `type="module"` on any built script tag. Do **not** define `module` or `exports` on the test context.
- [x] 2.6 Register the new test in the `test:unit` script and confirm the whole unit suite passes.

## 3. Convert the popup

- [x] 3.1 Rewrite `src/popup/index.mjs` as components rendering the status row, appearance controls, language row, and settings button, driven by state from a single `chrome.storage.sync.get` with the same keys and defaults.
- [x] 3.2 Resolve every label through `t(key, currentLanguage)` at render time; keep `data-i18n` attributes on the output; keep setting `document.documentElement.lang`. Do not call `applyTranslations` here.
- [x] 3.3 Reproduce the existing markup exactly: same element `id`s, same `op:` utility classes, same `.dot` / `.ok` state class, same `aria-live` on the status text, same GitHub link attributes.
- [x] 3.4 Preserve the appearance-controller wiring, including `onApply` updating the selects and disposal on unload; keep the storage-change listener and its removal on unload.
- [x] 3.4a Render the shell synchronously from default state **before** any `chrome` access, moving the appearance controller and storage read into an effect that runs after the first commit. Verify by loading `dist/popup.html` over `file://` with no `chrome` stub and confirming the markup is present.
- [x] 3.5 Reduce `src/popup/index.html` body to a mount root, leaving `<head>`, both `<link>` tags, the `<style>` block, and the `@layer base` reset untouched.
- [x] 3.6 Re-point the three markup assertions in `tests/unit/tailwind-build.test.js` at `src/popup/index.mjs`, keeping the `getElementById`/`id` cross-check meaningful rather than vacuous.
- [x] 3.7 Confirm `tests/popup.spec.js` (from 1.5) passes unmodified.
- [x] 3.8 Confirm `tests/popup-visual-parity.spec.js` passes **unmodified** — the proof of visual identity.

## 4. Convert the side panel

- [x] 4.1 Rewrite `src/sidepanel/index.mjs` with a `messages` state array of `{ role, content, streaming, error }`, rendering the empty state when it is empty and the transcript otherwise, with the same class names (`sp-msg`, `sp-msg-user`, `sp-msg-assistant`, `sp-streaming`, `sp-error`, `sp-empty`).
- [x] 4.2 Keep `sendMessage`'s control flow identical: same guard on empty input, same history push order, same port name and message type, same `try`/`catch` around `connect` and `postMessage`, same extension-context-invalidated detection and message.
- [x] 4.3 Keep `accumulated`, `settled`, the streaming-message reference, and the watchdog as per-send closure locals. Keep watchdog re-arming on every message and the `streamWatchdogMs` storage wiring.
- [x] 4.4 Map each DOM mutation to its state update per the design's mapping table, including reproducing the whole-transcript error check with `messages.some(m => m.role === 'error')`.
- [x] 4.5 Preserve auto-scroll on append and on streaming growth, and the textarea auto-resize capped at 120px.
- [x] 4.6 Reduce `src/sidepanel/index.html` body to the header plus a mount root, keeping `<head>`, both `<link>` tags, the `<style>` block, and the `@layer base` reset untouched.
- [x] 4.7 Confirm `tests/sidepanel.spec.js` (from 1.3) passes **unmodified**. Any change needed there means behavior drifted — fix the code, not the test.

## 5. Retire the fake-DOM tests

- [x] 5.1 Confirm every behavior asserted by `tests/unit/popup.test.js` and `tests/unit/sidepanel.test.js` is now covered by the Playwright specs, including the sidepanel's appearance-controller theme attributes.
- [x] 5.2 Delete both files and remove them from the `test:unit` script.

## 6. Verify and archive

- [x] 6.1 Run `node build.mjs`; confirm `dist/background.js`, `dist/content.js`, `dist/options.js`, `dist/styles.css`, and `dist/tailwind.css` all still match their 1.2 hashes.
- [x] 6.2 Run `npm run test:unit` — all green, including the unmodified background, content, options, square-corners, and policy-compliance tests.
- [x] 6.3 Run `npx playwright test` — all green, including the pre-existing specs.
- [x] 6.4 Run `node pack.mjs`; confirm `ENTRIES` is unchanged and no new file entered the archive.
- [x] 6.5 Render both pages headless with a scripted `chrome.*` stub and confirm each mounts into its root with zero console errors and zero page errors (no CSP rejection, no runtime failure).
- [x] 6.6 Run `openspec validate adopt-preact-popup-sidepanel --strict`.
- [x] 6.7 Archive the change and commit as `James Zhu <zhujian0805@gmail.com>`.
