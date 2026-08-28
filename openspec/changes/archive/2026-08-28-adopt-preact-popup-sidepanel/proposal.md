## Why

The popup and side panel build their UI imperatively. `src/sidepanel/index.mjs` interleaves stream-port protocol handling with 9 hand-rolled `document.createElement` / `appendChild` / `textContent` mutations, and tracks render state in loose local variables (`msgDiv`, `accumulated`, `settled`). The chat transcript exists only as DOM — there is no data model to inspect or test. Adding a feature such as message editing, retry, or copy-to-clipboard means more manual node surgery.

A component model fixes this by making the transcript a value and the DOM a pure function of it. Tier 1 established a build-time asset pipeline; this tier introduces the rendering layer on the two smallest surfaces, where the blast radius is contained and the payoff is immediate.

## What Changes

- Add Preact + htm as a **build-time-only** devDependency, vendored through the existing concatenation build. No bundler, no `import` at runtime, no module-type change.
  - `node_modules/htm/preact/standalone.umd.js` (~13 KB) bundles Preact, hooks, and htm's tagged-template JSX alternative into one UMD file that assigns a single `htmPreact` global.
  - `build.mjs` gains a `needsPreact` entry flag that inlines it ahead of the popup and sidepanel entry files, exactly as it already inlines `timeout.mjs`, `i18n.mjs`, and `appearance.mjs`.
  - **No JSX, therefore no transpiler.** htm uses tagged template literals, which the browser parses natively.
- Rewrite `src/sidepanel/index.mjs` to render from state:
  - The chat transcript becomes an array of `{ role, content, streaming, error }` records.
  - `addUserMsg`, `createStreamingMsg`, `addErrorMsg`, and `clearEmpty` — four DOM-mutating helpers — collapse into state updates.
  - The stream-port protocol (connect, `chunk` / `status` / `error` / `done`, watchdog re-arming, `onDisconnect` recovery, extension-context-invalidation handling) is preserved **semantically unchanged**; only its render side effects are redirected into state.
- Rewrite `src/popup/index.mjs` to render its status row, appearance controls, and language selector as components, driven by the same `chrome.storage.sync` reads and writes as today.
- Move the two affected unit tests to Playwright, where a real DOM exists.
- Add the side panel's first end-to-end coverage: send, stream, status, error, disconnect, and empty-state behavior.

**BREAKING (internal only):** `tests/unit/popup.test.js` and `tests/unit/sidepanel.test.js` are removed and replaced by Playwright specs. Their hand-written fake DOM objects cannot support a real renderer. No user-facing behavior changes.

## Non-goals

Deliberately left untouched:

- **The content script.** It stays imperative vanilla DOM. It is injected into every website with no Shadow DOM, so mounting a renderer there is Tier 3 work and requires isolation first.
- **The background service worker.** No UI.
- **The options page.** 1,162 lines of JS and 790 of CSS, covered by a 46 KB unit test and 5 Playwright specs. It is the next surface, not this one.
- **The concat build for background/content/options.** Those three entries keep their exact current pipeline, so `background.test.js` (199 KB), `options.test.js` (46 KB), and `content-language.test.js` (38 KB) keep passing unmodified.
- **Any network, storage, or message-passing contract.** Same keys, same message shapes, same port name.
- **The Tailwind layer from Tier 1.** Components emit the same `op:` utility classes.

## Hard-constraint compliance

| # | Constraint | How this change complies |
|---|---|---|
| 1 | No IIFE / module-scoped output; `vm.runInContext` must see top-level declarations | **Verified empirically.** The UMD wrapper assigns `htmPreact` onto whatever `this` is at top level — in a vm context that is the context global. Concatenated top-level `function` declarations after it remain visible as context properties. `dist/*.js` stay classic scripts; no `type="module"`, no bundler, no IIFE wrapping of our own code. The three untouched entries are byte-identical. |
| 2 | Content script has no Shadow DOM | The content script is explicitly out of scope and its bundle is unchanged. Preact is inlined only into the popup and sidepanel bundles, which are extension pages. A test asserts `dist/content.js` contains no `htmPreact`. |
| 3 | MV3 CSP — no CDN, no eval, no runtime JIT | Preact ships as plain pre-built JavaScript inside the package. htm parses tagged templates at runtime **without `eval` or `new Function`**. No JSX transpiler, so no build-time code generation either. |
| 4 | Square corners enforced | Components emit the same `op:` utilities and class names. `square-corners.test.js` reads authored sources and stays green. |
| 5 | Version sync / permissions / pack entries | Only `devDependencies` grows. Versions stay in lockstep, no new permission, `pack.mjs` ENTRIES unchanged. Preact is inlined into existing `dist/*.js` files, so no new packaged file. |
| 6 | Functional logic frozen unless explicitly scoped | This change **explicitly scopes** the sidepanel's render path. The port protocol, watchdog timing, history shape, and error strings are preserved verbatim; only their DOM side effects become state updates. The popup's storage reads/writes and appearance controller wiring are unchanged. |

## Capabilities

### New Capabilities

- `extension-page-rendering`: How the popup and side panel render — the vendored component runtime, how it reaches the bundle without a bundler, which surfaces may use it, and the state model that replaces imperative DOM mutation.

### Modified Capabilities

- `extension-page-styling`: one scenario is refined. Tier 1 froze the build with *"its JavaScript concatenation and `export`-stripping logic is unmodified, and no bundler wraps the output in an IIFE."* Vendoring a runtime requires a new inline step, so the scenario is restated to forbid what actually matters — bundlers, IIFE-wrapping of our own code, and module-scoped output — while permitting build-time inlining of a pre-built runtime.

  Everything else in that capability holds unchanged: components emit the same `op:` utilities, the `@source` globs already cover `**/*.{html,mjs}`, and the same cascade layers apply. The existing `tests/popup-visual-parity.spec.js` computed-style pins are **retained as-is** and become the primary regression proof that the re-rendered popup is visually identical.

## Impact

**Code**
- `build.mjs` — new `needsPreact` entry flag and inline step.
- `src/sidepanel/index.mjs` — rewritten as components; port logic preserved.
- `src/popup/index.mjs` — rewritten as components.
- `src/popup/index.html`, `src/sidepanel/index.html` — markup reduced to a mount root; styling stays in place.

**Dependencies**
- `preact` and `htm` added to `devDependencies`. Runtime dependency count stays zero — the code is vendored into the bundle at build time.

**Tests**
- `tests/unit/popup.test.js`, `tests/unit/sidepanel.test.js` — **removed** (fake DOM cannot host a renderer).
- `tests/popup.spec.js`, `tests/sidepanel.spec.js` — **new** Playwright coverage, including the side panel's first end-to-end tests.
- `tests/unit/preact-build.test.js` — **new**; asserts the runtime is inlined into exactly the popup and sidepanel bundles, that no bundler wrapped our code, and that the other three bundles are unaffected.
- `tests/unit/tailwind-build.test.js` — **updated**. Three assertions currently read popup *markup out of `index.html`* (`class="dot`, "uses utility classes", and the `getElementById` → `id="..."` cross-check). Once markup lives in the component module those must look at `src/popup/index.mjs` instead. The guarantees are unchanged; only the file they read moves.
- `tests/popup-visual-parity.spec.js` — **unchanged**, and deliberately so: it queries the live rendered page, so it validates the Preact output against the same computed-style pins recorded before Tier 1's migration.
- `package.json` `test:unit` script updated accordingly.

**Risk**
- Moderate, concentrated in the sidepanel's stream handling. Mitigated by writing the new Playwright coverage **before** the rewrite, so the existing behavior is pinned first.
