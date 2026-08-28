## 1. Dependencies and baseline

- [x] 1.1 Add `tailwindcss@4` and `@tailwindcss/cli@4` to `devDependencies` (already installed; confirm they are recorded in `package.json` and `package-lock.json`)
- [x] 1.2 Capture a baseline: run `npm run build` and record SHA-256 hashes of `dist/background.js`, `dist/content.js`, `dist/popup.js`, `dist/options.js`, `dist/sidepanel.js`, and `dist/styles.css`
- [x] 1.3 Run `npm run test:unit` and confirm all 13 existing tests pass before any source change

## 2. Tailwind entry stylesheet

- [x] 2.1 Create `src/styles/tailwind.css` declaring `@layer theme, utilities;` then importing only `tailwindcss/theme.css` and `tailwindcss/utilities.css` with `prefix(op)` — deliberately omitting `preflight.css`
- [x] 2.2 Add explicit `@source` directives limited to `../popup/`, `../options/`, and `../sidepanel/` (`*.html` and `*.mjs`), so v4 auto-detection cannot sweep in `src/content-script/`
- [x] 2.3 In `@theme`, clear the radius namespace with `--radius-*: initial` and redefine every scale value (`none`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl`, `full`) as `0`
- [x] 2.4 In `@theme`, bridge color utilities to the token contract (`--color-canvas`, `--color-surface`, `--color-surface-raised`, `--color-ink`, `--color-ink-muted`, `--color-ink-subtle`, `--color-line`, `--color-accent`, `--color-on-accent`, `--color-success`, `--color-danger`, `--color-warning`) as `var(--appearance-*)` references — no color literals
- [x] 2.5 In `@theme`, bridge font families (`--font-body`, `--font-display`, `--font-mono`), font sizes (`xs`/`sm`/`md`/`lg`), and shadows (`--shadow-1`..`--shadow-4`) to their `--appearance-*` equivalents
- [x] 2.6 Verify by hand-running the CLI that the output contains no `html{`, `body{`, or `*,::before,::after{` reset rule

## 3. Build pipeline

- [x] 3.1 In `build.mjs`, resolve the local CLI entry `node_modules/@tailwindcss/cli/dist/index.mjs` (do not shell out to `npx`, which can trigger a registry lookup and make the build network-dependent)
- [x] 3.2 `spawnSync` the CLI with `-i src/styles/tailwind.css -o dist/tailwind.css --minify`, appended after the existing CSS copy logic
- [x] 3.3 Throw with the CLI's stderr on any non-zero exit, so a broken stylesheet can never reach `pack.mjs`
- [x] 3.4 Log the emitted size in the same format as the existing `dist/<name>.js  <n>kb` lines
- [x] 3.5 Confirm `inlineModule`, `stripExports`, `stripUtilityImports`, `concatAgentPrimitives`, `concatBackgroundProviders`, the `entries` loop, and the `dist/styles.css` construction are all unmodified
- [x] 3.6 Re-run `npm run build` and assert the five `dist/*.js` hashes and the `dist/styles.css` hash match the 1.2 baseline exactly

## 4. Link the stylesheet into extension pages

- [x] 4.1 Add `<link rel="stylesheet" href="tailwind.css">` to `src/popup/index.html`, positioned after `appearance.css` and before the inline `<style>` block
- [x] 4.2 Add the same link, in the same position, to `src/options/index.html`
- [x] 4.3 Add the same link, in the same position, to `src/sidepanel/index.html`
- [x] 4.4 Confirm no link is added to any content-script asset and that `dist/styles.css` still never references `tailwind.css`
- [x] 4.5 Rebuild and confirm all three pages render identically to the baseline (no markup changed yet, so this must be a visual no-op)

## 4b. Cascade layers (emerged during implementation)

Discovered by the computed-style parity check: Tailwind v4 emits everything
inside `@layer`, and unlayered CSS beats layered CSS regardless of specificity.
Each page's unlayered `*` reset was therefore cancelling every utility margin
and padding (`op:mb-3` computed to `0px`).

- [x] 4b.1 Declare `@layer base, theme, utilities;` in `src/styles/tailwind.css` so the reset can sit below utilities
- [x] 4b.2 Wrap **only** the universal reset of each of the three pages in `@layer base { ... }`, leaving all other hand-written rules unlayered so they keep precedence over utilities
- [x] 4b.3 Confirm `src/styles/appearance.css` declares no `margin`, `padding`, or `box-sizing`, so moving the reset into a layer cannot change how it interacts with the unlayered appearance stylesheet
- [x] 4b.4 Verify the resulting cascade is `base < theme < utilities < unlayered page CSS`
- [x] 4b.5 Record the corrected decision in `design.md` (D7) and add the requirement to the capability spec

## 5. Migrate the popup surface

- [x] 5.1 Map each existing popup class (`.header`, `.header-left`, `.logo`, `.title`, `.divider`, `.desc`, `.status-row`, `.theme-row`, `.theme-copy`, `.theme-label`, `.theme-value`, `.dot`, `.preference-row`, `.settings-btn`) to its equivalent `op:` utility set
- [x] 5.2 Rewrite `src/popup/index.html` markup to use the utilities, preserving **every** `id` referenced by `getElementById` in `src/popup/index.mjs` (`statusDot`, `statusText`, `themePreferenceSelect`, `visualStylePreferenceSelect`, `languageSelect`, `settingsBtn`, `desc`, `appearanceLabel`, `languageLabel`, `settingsLabel`)
- [x] 5.3 Preserve every `data-i18n` attribute so the i18n pass keeps resolving the same nodes
- [x] 5.4 Preserve the `.dot.ok` state hook that `src/popup/index.mjs` toggles via `classList`, and keep `src/popup/index.mjs` otherwise byte-identical
- [x] 5.5 Trim the popup's inline `<style>` block to only the rules utilities cannot express (the `*` reset, `:root` local aliases, hover/focus-visible states, and the status-dot state rule)
- [x] 5.6 Verify square corners are preserved and that no `border-radius` other than `0` was introduced

## 6. Tests

- [x] 6.1 Create `tests/unit/tailwind-build.test.js` asserting `dist/tailwind.css` exists and is non-empty
- [x] 6.2 Assert every generated utility selector begins with `.op\:` and no unprefixed `.flex{` / `.hidden{` / `.block{` selector exists
- [x] 6.3 Assert every framework-declared theme custom property begins with `--op-`
- [x] 6.4 Assert the output contains no Preflight reset (no bare `html{`, `body{`, or `*,::before,::after{` rule)
- [x] 6.5 Assert every `border-radius` declaration in the output resolves to `0` (tolerant of minified output)
- [x] 6.6 Assert `dist/styles.css` contains no `.op\:` selector, proving the content-script surface is unstyled by utilities
- [x] 6.7 Assert each of `popup.html`, `options.html`, and `sidepanel.html` links `tailwind.css` after `appearance.css` and before its `<style>` block
- [x] 6.8 Assert the compiled layer order is `base < theme < utilities`, and that each page layers **only** its reset
- [x] 6.9 Add `tests/popup-visual-parity.spec.js` pinning the popup's computed layout, spacing, typography, and token-resolved colors, plus the `.dot`/`.dot.ok` state hook and an explicit reset-vs-utility regression guard
- [x] 6.10 Register the new unit test in the `test:unit` script in `package.json`

## 7. Verification

- [x] 7.1 Run `npm run test:unit` and confirm all tests pass, including the 13 pre-existing ones
- [x] 7.2 Confirm `tests/unit/square-corners.test.js`, `tests/unit/policy-compliance.test.js`, and `tests/unit/popup.test.js` pass **without any modification to their assertions**
- [x] 7.3 Run `npx playwright test` and confirm no regression in the end-to-end suite
- [x] 7.4 Load the unpacked extension and visually confirm the popup across all 3 color themes x 5 visual styles
- [x] 7.5 Confirm on a content-heavy third-party page that the injected content-script UI is visually unchanged and the host page is unaffected
- [x] 7.6 Run `node pack.mjs` and confirm `dist/tailwind.css` is included and ENTRIES is still `['manifest.json', 'PRIVACY.md', 'icons', 'dist']`

