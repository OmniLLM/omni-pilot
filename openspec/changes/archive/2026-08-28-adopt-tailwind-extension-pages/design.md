## Context

OmniPilot is a Manifest V3 Chrome extension built without any framework or bundler. `build.mjs` concatenates `.mjs` sources into flat, non-IIFE scripts specifically so that the 13 Node unit tests can load `dist/*.js` through `vm.runInContext` and assert on top-level declarations.

Styling today is entirely hand-written: a shared token contract in `src/styles/appearance.css` (`--appearance-*`, 3 color themes x 5 visual styles) consumed by per-page `<style>` blocks — 790 lines in `src/options/index.html`, 226 in `src/popup/index.html`, 154 in `src/sidepanel/index.html`, plus 1,180 lines in `src/content-script/styles.css`.

The content script is the dangerous surface: `dist/styles.css` is injected into **every website the user visits**, with no Shadow DOM isolation. Any global reset or unprefixed class shipped there would visually corrupt third-party pages.

This design covers Tier 1 of a three-tier UI modernization. It is deliberately the CSS-only tier, because Tiers 2 and 3 depend on a working build-time asset pipeline existing first.

## Goals / Non-Goals

**Goals:**

- Introduce a utility-first CSS framework that runs entirely at build time and ships static CSS.
- Guarantee by construction that the framework cannot leak into the content script or into third-party pages.
- Preserve the `--appearance-*` token contract verbatim so all 15 theme/style combinations keep working.
- Mechanically enforce the square-corner product decision through the framework's own theme, not merely through review.
- Leave `build.mjs`'s JavaScript path and the `vm.runInContext` test strategy completely untouched.
- Prove the pipeline end-to-end by migrating one real surface (the popup).

**Non-Goals:**

- No JavaScript framework, no bundler, no IIFE output (that is Tier 2 / Tier 3).
- No migration of the options or sidepanel markup — they only gain the `<link>` in this change.
- No changes to the content script, background worker, or any functional logic.
- No redesign. Visual output must be equivalent before and after.
- No new runtime dependency.

## Decisions

### D1. Tailwind CSS v4.3.3, not v3

**Chosen:** `tailwindcss@4` + `@tailwindcss/cli@4` as devDependencies.

**Rationale:** v4 is the current release line (`latest` = 4.3.3; v3 is `v3-lts` maintenance only). v4's CSS-first configuration means the entire configuration lives in one authored CSS file with no `tailwind.config.js`, no PostCSS pipeline, and no `autoprefixer` — which suits a repo that prizes a minimal dependency surface.

**Alternatives considered:**
- *Tailwind v3* — familiar `tailwind.config.js` with `prefix: 'op-'` and `corePlugins.preflight: false`. Rejected: adopting a legacy line for a greenfield integration incurs an immediate migration debt.
- *Bootstrap* — component-oriented and ships a mandatory global reset (Reboot) plus its own opinionated color/radius system. It would fight the `--appearance-*` token contract and the square-corner rule.
- *Open Props / plain CSS custom properties* — no utility classes, so it would not reduce the 1,150 lines of hand-written layout CSS.

**Verified empirically** before committing to this design (probe run against v4.3.3, output inspected).

### D2. Prefix via `prefix(op)` — accept `op:` colon syntax

v4's prefix is a namespace segment, not a hyphen: authored as `op:flex`, compiled to the escaped selector `.op\:flex`. Theme variables become `--op-*`.

This differs from v3's `op-flex`. The proposal and spec were corrected to match the verified behavior rather than the assumed behavior.

**Why prefix at all:** the codebase already uses `--op-radius-*` tokens and `omnipilot-`-prefixed identifiers; an unprefixed `.flex` in a shared `dist/` directory is an accident waiting to happen if the stylesheet is ever mis-linked.

**Verified output:**
```
.op\:flex { display: flex; }
.op\:bg-surface { background-color: var(--op-color-surface); }
```

### D3. Exclude Preflight by importing layers granularly

Rather than `@import "tailwindcss"` (which pulls theme + preflight + utilities), the entry file imports only the two layers it wants:

```css
@layer theme, utilities;
@import "tailwindcss/theme.css" layer(theme) prefix(op);
@import "tailwindcss/utilities.css" layer(utilities) prefix(op);
```

Preflight is not merely disabled by a flag — it is never referenced. This is the strongest available guarantee against a global reset reaching a page.

**Verified:** the probe output contained no `html{`, `body{`, or `*,::before,::after{` rule.

**Alternative considered:** import everything and override Preflight afterwards. Rejected — override order is fragile and the reset would still ship bytes.

### D4. Zero the entire radius namespace, don't patch individual values

```css
@theme {
  --radius-*: initial;
  --radius-none: 0; --radius-xs: 0; --radius-sm: 0; --radius-md: 0;
  --radius-lg: 0;   --radius-xl: 0; --radius-2xl: 0; --radius-3xl: 0;
  --radius-4xl: 0;  --radius-full: 0;
}
```

The initial probe overrode only `sm` and `md`, and `--op-radius-xs: 0.125rem` still leaked into the output. Clearing the namespace with `--radius-*: initial` first makes it impossible for an unlisted scale value to survive.

**Verified:** with the namespace cleared, `op:rounded-md`, `op:rounded-3xl`, and `op:rounded-full` all compiled to `border-radius: 0`.

### D5. Invoke the CLI binary directly from `build.mjs`, not via `npx`

`build.mjs` will `spawnSync` the resolved local entry point `node_modules/@tailwindcss/cli/dist/index.mjs`.

**Rationale:** `npx` may attempt a registry lookup, which would make the build network-dependent and slow — unacceptable because `npm run test:unit` invokes the build on every run. Spawning the resolved local file is deterministic and offline.

**Alternatives considered:**
- *Programmatic API* (`@tailwindcss/node` + `@tailwindcss/oxide`) — not a stable public surface; couples the build to internals.
- *A separate `build:css` npm script* — would let a developer run `npm run build` and silently get a stale stylesheet. Keeping it inside `build.mjs` means one build command remains the single source of truth.

**Failure handling:** if the CLI exits non-zero, `build.mjs` must fail loudly with the CLI's stderr. A silent fallback to an empty stylesheet would let a broken build reach `pack.mjs`.

### D6. Scope content detection with explicit `@source`, and assert the exclusion

v4 auto-detects source files by walking up from the CSS file, which would sweep in `src/content-script/`. That auto-detection is neutralized by declaring explicit sources:

```css
@source "../popup/**/*.{html,mjs}";
@source "../options/**/*.{html,mjs}";
@source "../sidepanel/**/*.{html,mjs}";
```

Scoping alone is a *convention*; the constraint is enforced by a test asserting `dist/styles.css` contains no `.op\:` selector. Defense in depth: the content script cannot be styled by utilities even if someone adds an `@source` line later, because the stylesheet is never linked there.

### D7. Cascade layers — `base` < `theme` < `utilities` < unlayered page CSS

**Initially assumed (and wrong):** that linking `tailwind.css` before each page's `<style>` block would make hand-written CSS win specificity ties while utilities still applied elsewhere.

**What actually happens:** Tailwind v4 emits everything inside `@layer`. In the CSS cascade, **unlayered styles always beat layered styles regardless of specificity**. Each page's `<style>` block is unlayered, so its zero-specificity `*, *::before, *::after { margin: 0; padding: 0 }` reset silently cancelled *every* utility margin and padding. A computed-style parity check caught this: `op:mb-3` resolved to `margin-bottom: 0px`, `op:py-2.5` to `padding: 0px`.

**Chosen fix:** declare the layer order explicitly in `src/styles/tailwind.css`:

```css
@layer base, theme, utilities;
```

and have each page wrap **only its reset** in `@layer base { ... }`, leaving all other hand-written rules unlayered. The resulting cascade is:

```
base (the * reset)  <  theme  <  utilities  <  unlayered page CSS
```

This preserves both intents simultaneously — the reset stays beatable by anything (its original purpose), and hand-written page rules still override utilities during incremental migration.

**Alternatives considered:**
- *Strip `@layer` from Tailwind's output.* Would make utilities unlayered and fight page CSS on raw specificity — fragile and would break the migration story.
- *Put page CSS in a layer after `utilities`.* Does not help: the reset would move into that same layer and keep beating utilities.
- *Remove `margin: 0; padding: 0` from the resets.* Rejected — it would change rendering across all three pages far beyond this change's scope.

**Enforced by:** a test asserting `dist/tailwind.css` declares `@layer base, theme, utilities` and that each page wraps its reset in `@layer base`.

### D8. Migrate only the popup in this change

The popup is 226 lines of HTML and 84 lines of JS with a single `class` touchpoint — the smallest surface that still exercises layout, color, spacing, and typography utilities. `tests/unit/popup.test.js` asserts on element IDs and text content, never class names, so it should pass unmodified. That makes the popup a genuine end-to-end proof with a near-zero blast radius.

Options (790 lines of CSS) and sidepanel are deferred to follow-up changes so this one stays reviewable.

## Impact on `build.mjs` and the unit-test strategy

**`build.mjs`** gains exactly one new step, appended after the existing CSS copy logic:

1. Resolve the local Tailwind CLI entry.
2. `spawnSync` it with `-i src/styles/tailwind.css -o dist/tailwind.css --minify`.
3. Throw on non-zero exit.

Untouched: `inlineModule`, `stripExports`, `stripUtilityImports`, `concatAgentPrimitives`, `concatBackgroundProviders`, the `entries` loop, the HTML copies, and the `dist/styles.css` construction (including the content-script regex transforms of `appearance.css`).

**The `vm.runInContext` strategy is unaffected.** No JavaScript is bundled, wrapped, or scoped differently. `dist/background.js`, `dist/content.js`, `dist/popup.js`, `dist/options.js`, and `dist/sidepanel.js` are byte-identical to their pre-change output.

## Test files that must change, and why

| File | Change | Justification |
|---|---|---|
| `tests/unit/tailwind-build.test.js` | **New** | Nothing currently asserts the new pipeline's guarantees. Covers: output exists and is non-empty; every utility selector is `.op\:`-prefixed; every framework theme variable is `--op-`-prefixed; no Preflight/bare-element rules; every `border-radius` value is `0`; `dist/styles.css` contains no `.op\:` selector; each of the three page HTML files links `tailwind.css` after `appearance.css` and before its `<style>` block. |
| `package.json` (`test:unit` script) | **Modified** | The new test file must actually run. This is the only reason to touch it. |
| `tests/unit/square-corners.test.js` | **Unchanged** | It reads authored sources (`src/**`), not `dist/`. `src/styles/tailwind.css` declares radii as `0`, so it stays green. Explicitly verified rather than assumed. |
| `tests/unit/policy-compliance.test.js` | **Unchanged** | Only `devDependencies` changes. Version fields, the `tabs` permission check, and `pack.mjs` ENTRIES are untouched. Note `package-lock.json` is rewritten by `npm install`, but its `version` fields stay in sync. |
| `tests/unit/popup.test.js` | **Unchanged** | Asserts element IDs, `textContent`, and stored config. The popup migration changes only `class` attributes and preserves every `id`. |
| `tests/unit/appearance*.test.js` | **Unchanged** | `src/styles/appearance.css` is not modified. |
| Playwright specs | **Unchanged** | Selectors target IDs and roles. Re-run as a final gate. |

## Risks / Trade-offs

- **[v4's `op:` prefix syntax reads oddly and is unfamiliar]** → Documented in the spec and this design; a single `@source`-scoped codebase makes it consistent. The alternative (v3) is a legacy line.
- **[Auto-detected sources could silently pull in the content script]** → Explicit `@source` declarations, plus a test asserting `dist/styles.css` has no `.op\:` selector. Two independent guards.
- **[Build now depends on a native binary — `@tailwindcss/oxide` ships platform-specific builds]** → It is a devDependency only; CI and developer machines need it, but the shipped extension does not. `npm install` resolves the correct platform build. Noted for any future CI on an unusual architecture.
- **[`npm install` rewrote `package-lock.json`, which `policy-compliance.test.js` reads]** → That test only asserts version-field equality, which is preserved. Verified by running the suite.
- **[A future contributor could apply utilities to the content script]** → Blocked in practice: `dist/styles.css` never links `tailwind.css`, so the classes would simply have no effect, and the exclusion test fails if the utilities ever appear there.
- **[Dual styling systems coexist during incremental migration]** → Accepted deliberately. Link order (D7) guarantees hand-written CSS wins, so every intermediate state renders correctly. The cost is temporary duplication until options and sidepanel are migrated.
- **[Build time increases]** → Measured at ~210–270 ms for the CSS step in the probe. Acceptable for a command already run before every unit-test invocation.

## Migration Plan

1. Add devDependencies (already installed and verified).
2. Author `src/styles/tailwind.css` with layers, prefix, sources, and the token bridge.
3. Wire the CSS step into `build.mjs`; confirm `dist/*.js` output is byte-identical to before.
4. Add `<link>` to all three pages (no markup change yet) — pages must render identically.
5. Migrate popup markup to utilities, preserving every `id`.
6. Add `tests/unit/tailwind-build.test.js`; register it in `test:unit`.
7. Run `npm run test:unit`, then the Playwright suite.

**Rollback:** the change is additive. Removing the `<link>` tags restores the previous rendering exactly, since every page retains its full hand-written `<style>` block.

## Open Questions

- Should the bare `op:rounded` utility be defined (as `0`) for completeness? The probe showed it does not emit unless `--radius` is declared. Leaving it undefined is arguably safer — it fails visibly rather than silently. **Proposed: leave undefined.**
- Should `--minify` be used? It shrinks output but makes the `border-radius: 0` assertions marginally harder to write. **Proposed: minify, and write assertions tolerant of both forms.**
