# Design — Preact on the popup and side panel

## Context

The build (`build.mjs`) is hand-written file concatenation, not a bundler. Every unit test loads `dist/*.js` through `vm.runInContext` and reads top-level declarations off the context object. That single fact rules out every mainstream framework toolchain, because they all emit module-scoped or IIFE-wrapped output, which would make those declarations invisible and break the entire unit suite at once.

So the question is not "which framework is best" but "which framework can be delivered through plain concatenation, with no bundler, no transpiler, and no CSP violation." That narrows the field to essentially one option.

## Goals

- Replace imperative DOM construction with a state-driven component model on the two smallest surfaces.
- Keep the side panel's stream protocol behaviorally identical, down to error strings and history ordering.
- Leave the background worker, content script, and options page byte-identical.
- Add no runtime dependency and no packaged file.

## Non-goals

- Migrating the content script (needs Shadow DOM isolation first — Tier 3).
- Migrating the options page (next tier; far larger and heavily unit-tested).
- Introducing JSX, TypeScript, a bundler, or a dev server.
- Changing any storage key, message shape, or port name.

---

## Decisions

### D1 — Preact + htm, delivered as the prebuilt `standalone.umd.js`

**Decision.** Vendor `node_modules/htm/preact/standalone.umd.js` (13,296 bytes) — one file bundling Preact, its hooks, and htm.

**Why not React.** React plus ReactDOM is ~140 KB minified and its ecosystem assumes JSX and a bundler. Neither is available here.

**Why not Vue/Angular/Svelte/Solid.** Vue's runtime is ~34 KB and its ergonomic path is SFCs, which require a compiler. Angular requires a compiler and DI framework. Svelte and Solid are *compilers* — their entire value proposition is a build step that emits module-scoped output, which is precisely what constraint #1 forbids. Adopting any of them means adopting a bundler and rewriting the test strategy — that is Tier 3, not Tier 2.

**Why Preact.** ~4 KB gzipped, ships as prebuilt plain JavaScript, and has a UMD distribution that needs no module loader. Paired with htm it gives components, hooks, and declarative templates with **zero** build tooling.

**Why the `standalone` build specifically.** Combining `preact`, `preact/hooks`, and `htm` separately would mean concatenating three UMD files and manually wiring `htm.bind(h)`. The standalone build does that internally and exposes one global, `htmPreact`, carrying `h, html, render, Component, useState, useEffect, useRef, useMemo, ...` — verified by inspecting the built exports.

### D2 — Inline through the existing per-entry flag mechanism

**Decision.** Add `needsPreact` to the `entries` array in `build.mjs` and push the runtime source into `parts` ahead of the entry source.

The build already inlines shared modules per entry via `needsI18n`, `needsAppearance`, and `needsAgent`. Preact uses the identical pattern, so the change is a new flag plus a file read — no restructuring.

One difference: the shared modules are ESM and go through `inlineModule`/`stripExports`. The UMD is **not** ESM and must be read raw, with no stripping. It gets its own read, kept separate from the ESM helpers so their behavior is provably unchanged for the other three entries.

**ASI hazard.** The UMD begins with `!function(e,n){...}(...)`. If the preceding concatenated chunk ends with `}` or an expression, a newline alone will not terminate the statement and `!` would be parsed as a continuation. The runtime source is therefore prefixed with `;`.

**Ordering.** The runtime is inlined *before* the entry source, since the entry references `htmPreact` at its top level.

### D3 — Tagged templates, never JSX

**Decision.** Author markup with htm's `html\`` \`` tagged templates.

JSX is not valid JavaScript and would require a transpiler, which would reintroduce a build toolchain and, with it, module-scoped output. htm uses native tagged template literals — the browser parses them directly.

Critically, **htm does not use `eval` or `new Function`**. It parses the template's static string parts and caches the result on the template object's identity. This is what makes it MV3-CSP-safe; most runtime template compilers are not.

### D4 — Confirmed: the runtime does not break `vm.runInContext`

This was the single assumption capable of invalidating the whole tier, so it was tested before any design work rather than assumed.

Findings:

1. The UMD's global branch assigns `htmPreact` onto `this`, which inside `vm.runInContext` is the context object. `ctx.htmPreact` is populated with the full export set.
2. A top-level `function` declaration appearing *after* the UMD is still visible as a context property. The IIFE hides only its own internals; it does not create a scope around what follows.
3. The UMD prefers `exports`/`module` when they exist. **No test context defines either** — all ten `vm.createContext` call sites pass a plain object without them — so the global branch is always taken. The new build test must not introduce them.

Conclusion: constraint #1 holds. Our code stays top-level; only the vendored runtime's internals are enclosed, which is exactly what we want.

4. Separately observed: a top-level `const` is **not** visible on a vm context, since `const` creates a lexical binding rather than a global property. This is standard JavaScript, unrelated to Preact, but it constrains how testable code must be declared — anything a unit test needs to reach must be a `function` declaration.

### D5 — Side panel: state model, with protocol fidelity as the hard rule

**Decision.** The transcript becomes `messages: Array<{ role, content, streaming?, error? }>`. The four DOM helpers (`clearEmpty`, `addUserMsg`, `createStreamingMsg`, `addErrorMsg`) become state updates. `sendMessage` keeps its exact control flow; only its render side effects change.

The mapping is deliberately mechanical, so fidelity is auditable line by line:

| Today | After |
|---|---|
| `clearEmpty()` removes `.sp-empty` | empty state rendered only when `messages.length === 0` |
| `addUserMsg(text)` | push `{ role:'user', content:text }` |
| `createStreamingMsg()` | push `{ role:'assistant', content:'', streaming:true }` |
| `msgDiv.textContent = accumulated` | update that record's `content` |
| `msgDiv.classList.remove('sp-streaming')` | set `streaming:false` |
| `msgDiv.remove()` | drop that record |
| `addErrorMsg(text)` | push `{ role:'error', content:text }` |
| `body.querySelector('.sp-error')` | `messages.some(m => m.role === 'error')` |

**Preserved quirk, deliberately.** The current "no response received" guard checks the *entire* transcript for a pre-existing `.sp-error`, not just the current turn. So an error in an earlier turn suppresses the message in a later one. This is arguably a bug, but it is existing behavior and this change is explicitly not a behavior change — `messages.some(...)` reproduces it exactly. If it should change, that belongs in its own proposal with its own scenario.

**What must not move.** `accumulated`, `settled`, `msgDiv`-equivalence, and the watchdog remain per-send local state inside `sendMessage`'s closure, exactly as today. Lifting them into component state would change re-entrancy and timing. The watchdog keeps reading `streamWatchdogMs`, which is seeded from `RESPONSE_TIMEOUT_DEFAULT_MS` and refreshed from storage — untouched.

**Why the side panel is worth it.** Nine DOM mutation sites and three shadow-state variables collapse into one array. This is where the imperative approach hurts most and where a data model pays for itself.

### D6 — Popup: translate at render time, not by mutating the DOM afterwards

**Decision.** Popup components resolve labels through `t(key, currentLanguage)` during render. `applyTranslations` is no longer used on this surface.

This is forced, not stylistic. `applyTranslations(document, lang)` walks `[data-i18n]` elements and overwrites `textContent`. Against a renderer this is a direct conflict: either the renderer overwrites the translation on its next render, or the mutation writes into nodes the renderer believes it owns and their virtual/real state diverge. Rendering the translated string in the first place removes the conflict entirely.

`applyTranslations` stays exported and unchanged — the options page and content script still rely on it, and both are out of scope. It simply becomes unused by the popup (still inlined via `needsI18n`, which is harmless and keeps `i18n.mjs` untouched).

`data-i18n` attributes are still emitted on rendered elements. They cost nothing and keep the markup greppable against the translation catalogue.

### D7 — Markup moves into the modules; Tailwind already handles that

Migrating means static markup relocates from `index.html` into the component modules. Tier 1's `@source` globs were already written as `**/*.{html,mjs}`, so utility classes authored in `.mjs` are scanned with no config change.

Consequence for tests: three assertions in `tests/unit/tailwind-build.test.js` currently read popup markup out of `index.html` — the `class="dot` check, the "popup actually uses utilities" check, and the `getElementById` → `id="..."` cross-check. They must read `src/popup/index.mjs` instead. The guarantees are identical; only the file moves. The `getElementById` cross-check in particular would otherwise pass *vacuously* once the calls disappear, which would be a silent loss of coverage — so it is re-pointed rather than deleted.

`.dot` / `.dot.ok` stays a CSS state pair toggled by class, exactly as Tier 1 requires. The `<style>` blocks and the `@layer base` reset stay in the HTML, untouched.

### D8 — The popup shell must render before any `chrome` access

**Decision.** The popup renders its full markup synchronously with default state on `DOMContentLoaded`, and performs all `chrome` access afterwards, inside an effect.

This is not a stylistic preference — it is forced by the existing test harness. `tests/popup-visual-parity.spec.js` loads `dist/popup.html` over `file://` and stubs **no** `chrome` object at all. Today that works because the markup is static HTML: `popup.js` throws immediately on `chrome.storage`, the error is irrelevant, and the 36 computed-style pins still find their elements.

Once markup lives in the component, that same throw would happen *before* anything rendered, leaving an empty document and failing all 36 pins. Rendering first inverts the order: the DOM is committed with default state, and only then does the effect touch `chrome` and possibly throw. The pins keep finding their elements, and the spec stays unmodified — which is what makes it trustworthy as a parity oracle.

This also produces genuinely better behavior. The popup currently shows nothing meaningful until storage answers; rendering a default shell first means it paints immediately and then fills in.

Practical consequences:
- `render()` is called with default state (`hasApiKey: false`, `providerType: 'custom-provider'`, `authMethod: 'api-key'`, language `en`) before any `chrome` reference is evaluated.
- `createAppearanceController` and `chrome.storage.sync.get` move into an effect that runs after the first commit.
- Playwright's `page.goto` waits for `load`, which follows `DOMContentLoaded`, so the markup is guaranteed present when the pins are read.

### D9 — Test strategy: move to the browser, and pin behavior *before* rewriting

**Decision.** Delete `tests/unit/popup.test.js` and `tests/unit/sidepanel.test.js`; replace them with Playwright specs. Write the side panel's specs **against the current implementation, before the rewrite**.

The two unit tests drive hand-built fake DOM objects. A renderer needs `createTextNode`, `insertBefore`, `removeChild`, `ownerDocument`, and more; the stubs implement almost none of it. Expanding them means writing a DOM implementation — strictly worse than using the real one that Playwright already provides and that 19 existing specs already use.

`jsdom` was considered and rejected: it is a heavyweight new devDependency for a project that currently has none at runtime and very few in development, and it would still be a DOM *approximation* while a real browser is already in the harness.

Sequencing matters here. The side panel today has **no** end-to-end coverage — its only test asserts appearance attributes. Rewriting stream handling with no behavioral safety net is the main risk in this change, so the new specs are written and made green against the *existing* code first. They then serve as the regression oracle for the rewrite. This is the single most important ordering constraint in the task list.

For the popup, `tests/popup-visual-parity.spec.js` already pins 36 computed-style values and is kept **unmodified**, giving free proof that the rendered output is visually identical.

### D10 — Byte-identity as the containment proof

`dist/background.js`, `dist/content.js`, and `dist/options.js` must hash identically before and after. This is the cheapest possible proof that a change touching the shared build did not leak into the three surfaces that carry the overwhelming majority of functional logic and test weight. Hashes are recorded before implementation begins, as was done in Tier 1.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Stream-handling regression in the side panel | **High** — it is the real functional logic here | Write end-to-end specs against current behavior *first*; keep `accumulated`/`settled`/watchdog as closure locals; mechanical one-to-one mapping table above |
| Runtime leaks into the content script | High — no style/DOM isolation there | Opt-in flag; explicit test asserting `dist/content.js` contains no runtime |
| Losing coverage when the two unit tests are deleted | Medium | Replace before delete; side panel gains strictly more coverage than it had |
| Parity spec breaks because it stubs no `chrome` | Medium — would fail 36 tests at once | Render the shell before any `chrome` access (D8) |
| `tailwind-build.test.js` passing vacuously after markup moves | Medium — silent, not loud | Re-point the assertions at `index.mjs` rather than removing them |
| Bundle growth | Low | +13 KB uncompressed on two extension pages only; never on injected content |
| CSP rejection | Low | No `eval`/`new Function` in Preact or htm; verified by inspection and asserted in the build test |

## Rejected alternatives

- **A bundler (esbuild/Vite/Rollup) with any framework.** Breaks constraint #1 for all five entries simultaneously and invalidates ~300 KB of unit tests. This is the defining reason Tier 3 is a separate, much larger effort.
- **React + ReactDOM UMD.** Technically loadable without a bundler, but ~35× the size and unusable without JSX, whose transpiler reintroduces the bundler problem.
- **Svelte / SolidJS.** Compiler-first by design; incompatible with a concatenation build.
- **`preact` + `preact/hooks` + `htm` as three separate UMDs.** Three files and manual `htm.bind(h)` wiring for no benefit over the standalone build.
- **Web Components / lit.** lit relies on advanced template features and its own build story; plain custom elements would be a second ad-hoc rendering idiom rather than a framework.
- **Converting the whole extension at once.** The content script has no Shadow DOM, so utility CSS and framework-rendered markup would leak into every website. Isolation must land first.
