## Why

The OpenSpec artifacts no longer describe the codebase they are supposed to govern. Two UI changes shipped straight to `main` without a proposal — `feat: add selectable component shapes` (1465c0a) and `feat: polish extension surfaces and default to subtle corners` (#14, d5bd04c) — and they invalidated assumptions that are still written down as fact.

The drift is not cosmetic. It is load-bearing:

- `openspec/config.yaml` states as **hard constraint 4** that `tests/unit/square-corners.test.js` "forbids ANY nonzero `border-radius` in authored UI sources and requires `--appearance-radius-*` / `--op-radius-*` tokens to stay `0`. Square corners are a deliberate product decision." That test now asserts the exact opposite: authored CSS must **not** contain `border-radius: 0`, and must consume `var(--appearance-radius-*)`, which resolve to `2/4/6/8px` (subtle), `4/8/12/16px` (rounded), and `6/12/18/9999px` (pill).
- `openspec/specs/extension-page-styling/spec.md` carries a requirement titled **"Square corners remain enforced"** whose scenario demands every `border-radius` in `dist/tailwind.css` be `0`. Radius utilities now deliberately resolve through the shape contract.
- The same spec asserts that the three pages declare their resets in `src/*/index.html`. The Vite migration moved every page's CSS into `src/styles/<page>.css`, and `tests/unit/tailwind-build.test.js` now forbids an inline `<style>` block or a `style="…"` attribute in those HTML files.
- `config.yaml` still describes the project as "Vanilla JavaScript ES modules. No framework, no runtime dependencies. Only devDependency is `@playwright/test`", and the build as "a hand-written CONCATENATION build, not a bundler". The tree now ships Preact, htm, Tailwind v4, Vite, and `@tailwindcss/vite`, and `build.mjs` spawns Vite to compile four stylesheets.
- Every one of the five capability specs still carries the literal placeholder `TBD - created by archiving change <name>. Update Purpose after archive.`
- The appearance system — 3 color themes x 5 visual styles x **4 component shapes**, its storage keys, its normalization rules, and its live cross-surface propagation — is implemented, enforced by four test files, and specified nowhere.

An agent reading these artifacts today would refuse a correct change for violating a constraint that no longer exists, and would have no specification at all for the appearance capability it is most likely to be asked to touch.

## What Changes

- **Replace** the `Square corners remain enforced` requirement in `extension-page-styling` with `Radius utilities resolve through the selectable shape contract`, matching what `tests/unit/tailwind-build.test.js` actually asserts: the `--radius-*` namespace is cleared, every scale resolves through `var(--appearance-radius-*)`, and any literal radius value must still be `0`.
- **Correct** three `extension-page-styling` requirements whose scenarios point at the pre-Vite file layout: the reset now lives in `src/styles/<page>.css` inside `@layer base`, pages carry no inline `<style>` block, and the link order is `appearance.css` → `tailwind.css` → `<page>.css`.
- **Correct** the `Utility theme is bound to appearance tokens` requirement so it states a durable contract (utilities resolve through `--appearance-*`, and all three appearance dimensions re-render live) instead of a frozen-file assertion that was only meaningful inside its originating change.
- **Correct** the `JavaScript behavior is unaffected` requirement to describe the real boundary: Vite compiles CSS, and the extension's JavaScript is still never bundled, wrapped, or module-scoped.
- **Add** a new `appearance-preferences` capability specifying the three preferences, their enumerations and defaults, normalization of unknown values, the `data-*` projection onto the appearance root, `chrome.storage.sync` persistence, live propagation to every surface, and which surfaces may write.
- **Rewrite** the stale sections of `openspec/config.yaml`: dependency list, build pipeline, the appearance dimensions, hard constraint 4, and the two source line counts.
- **Replace** the `TBD` Purpose placeholder in all five existing capability specs and in the newly created one.

No product behavior changes. No source file under `src/`, no test, and no build script is modified by this change.

## Non-goals

Deliberately left untouched:

- **All of `src/`.** This change rewrites documentation to match shipped code, never the reverse. If a spec and the code disagree, the code wins.
- **All of `tests/`.** No assertion is added, removed, or relaxed. The tests are the evidence this change is written against.
- **`build.mjs`, `vite.config.mjs`, `pack.mjs`, `manifest.json`, `package.json`.** No pipeline or packaging change.
- **The `current` visual style identifier.** #14 relabeled it "Modern" in the UI copy only; the stored value and the `data-visual-style="current"` selector are unchanged, and this change does not rename them.
- **The content script's fixed appearance at mount.** It pins `dark` / `current` / `subtle` before its controller reads storage. That is existing behavior; it is documented as-is, not redesigned.
- **The archived changes under `openspec/changes/archive/`.** History is immutable; only the main specs are corrected.
- **Retroactive change proposals for 1465c0a and #14.** Their outcomes are folded into the main specs here rather than fabricating dated proposals that were never reviewed.

## Hard-constraint compliance

| # | Constraint | How this change complies |
|---|---|---|
| 1 | No IIFE / module-scoped output; unit tests read top-level declarations via `vm.runInContext` | No JavaScript is touched. `build.mjs` is not modified, so the concatenation path and every top-level declaration are bit-identical. |
| 2 | Content script UI lives in an open Shadow DOM; hit-test with `composedPath()` | Not touched. The change adds no code. The existing isolation requirements in `extension-page-styling` are carried forward verbatim. |
| 3 | MV3 CSP — no remote assets, no `eval`, no runtime JIT | Not touched. No asset, dependency, or build step is added. |
| 4 | `square-corners.test.js` radius policy | **This is the constraint being corrected.** The test's real contract — authored CSS consumes `var(--appearance-radius-*)` and must not hard-code `border-radius: 0` — is restated in `config.yaml` and in the spec. The test itself is unmodified and must keep passing. |
| 5 | `policy-compliance.test.js` — version sync, no `tabs` permission, pinned `pack.mjs` ENTRIES | Not touched. No version, permission, or packaging entry changes; the test must keep passing untouched. |
| 6 | Functional logic in `content-script/index.mjs` and `background/index.mjs` is frozen | Honored absolutely. Neither file is opened for edit. Their line counts are corrected in `config.yaml` (2703 and 2756) purely as documentation. |

## Capabilities

### New Capabilities

- `appearance-preferences`: the theme / visual style / component shape preference model — enumerations, defaults, normalization, the `data-*` contract on the appearance root, `chrome.storage.sync` persistence, live propagation across surfaces, and the radius token scale each shape selects.

### Modified Capabilities

- `extension-page-styling`: the radius requirement is replaced, and the reset-location, link-order, token-binding, and no-bundler requirements are corrected to describe the post-Vite layout.

## Impact

**Specs**
- `openspec/specs/extension-page-styling/spec.md` — one requirement removed, one added, four modified.
- `openspec/specs/appearance-preferences/spec.md` — new.
- All six capability specs — `Purpose` filled in.

**Configuration**
- `openspec/config.yaml` — `context` block corrected (stack, build, appearance dimensions, line counts) and hard constraint 4 rewritten.

**Code / tests / build**
- None.

**Risk**
- Low, and one-directional. Every assertion introduced here is copied from a test that already passes on `main`, so `npm run test:unit` and `openspec validate --all --strict` are the complete verification.
