# Tasks

## 1. Baseline

- [x] 1.1 Confirm the whole suite is green before any edit (13 unit suites, 137 browser tests)
- [x] 1.2 Confirm the content script has exactly one UI mount point (`ensureOmniPilotRoot` / `getUiMount`) and one `document.body.appendChild`
- [x] 1.3 Confirm no `document.querySelector` in the content script targets OmniPilot UI — all five target host page content for extraction
- [x] 1.4 Confirm no test looks up OmniPilot UI via `document.querySelector` inside `page.evaluate`, so open-shadow locators will still resolve
- [x] 1.5 Identify everything pinning `dist/styles.css`: `tests/unit/tailwind-build.test.js`, `Makefile`, `manifest.json`, and three browser harnesses

## 2. Build: inline the stylesheet

- [x] 2.1 Hoist the `appearance.css` read and its three content-scoping regex transforms above the entries loop
- [x] 2.2 Build `contentStylesInlined` as a top-level `const OMNIPILOT_CONTENT_CSS = <JSON string>` chunk
- [x] 2.3 Add a `needsContentCss` flag to the entries table, set only for `content`
- [x] 2.4 Push the inlined chunk into `parts` for that entry
- [x] 2.5 Stop emitting `dist/styles.css`
- [x] 2.6 Confirm `dist/background.js`, `dist/popup.js`, `dist/options.js`, and `dist/sidepanel.js` sizes are unchanged

## 3. Content script: attach the shadow root

- [x] 3.1 Add an `omniPilotHost` module-level reference alongside `omniPilotRoot`
- [x] 3.2 Create the host element, call `attachShadow({ mode: 'open' })`, and inject `OMNIPILOT_CONTENT_CSS` as a `<style>` inside it
- [x] 3.3 Move the existing root element inside the shadow root, keeping every one of its attributes intact
- [x] 3.4 Guard against a missing `attachShadow` by falling back to a direct append
- [x] 3.5 Reset both references on the disconnected-root teardown path so no orphan host is left behind
- [x] 3.6 Confirm no other function in the file is modified

## 4. Manifest and packaging

- [x] 4.1 Remove `content_scripts[0].css` from `manifest.json`
- [x] 4.2 Remove `dist/styles.css` from the `Makefile` build outputs and add `dist/tailwind.css` in its place
- [x] 4.3 Confirm `pack.mjs` ENTRIES are unchanged and packaging still succeeds

## 5. Re-point the pinned assertions

- [x] 5.1 Parse `OMNIPILOT_CONTENT_CSS` back out of `dist/content.js` in `tests/unit/tailwind-build.test.js`
- [x] 5.2 Keep the "no `.op\:` utility selector" assertion against the extracted stylesheet
- [x] 5.3 Keep the byte-equality assertion against the transformed appearance CSS plus `src/content-script/styles.css`
- [x] 5.4 Assert no `content_scripts` entry declares `css`
- [x] 5.5 Assert `dist/styles.css` is no longer emitted
- [x] 5.6 Remove the simulated manifest CSS injection from the three browser harnesses

## 6. Prove the isolation

- [x] 6.1 Add `tests/content-shadow-isolation.spec.js` with a hostile host stylesheet using `!important` global rules
- [x] 6.2 Assert the UI root is inside an open shadow root and absent from the light DOM
- [x] 6.3 Assert the stylesheet is in the shadow root and nowhere in the host document
- [x] 6.4 Assert the bubble's computed font family, letter spacing, text transform, and opacity survive the hostile rules
- [x] 6.5 Assert the host page keeps its own computed background, radius, and color
- [x] 6.6 Assert the shadow host occupies zero layout height

## 7. Verify

- [x] 7.1 Clean rebuild from an empty `dist/`
- [x] 7.2 `npm run test:unit` — all suites pass
- [x] 7.3 Full browser suite passes, with the existing content-script specs unmodified apart from harness setup
- [x] 7.4 `node pack.mjs` succeeds and total package size is unchanged
- [x] 7.5 `openspec validate --strict` passes
- [x] 7.6 Update constraint #2 in `openspec/config.yaml`, which this change retires
