# Tasks — align-specs-with-shipped-ui

This change edits documentation only. No file under `src/`, `tests/`, or the build
scripts is touched, so `npm run test:unit` passes unchanged after **every** group
below — that invariant is itself the safety property being maintained, and task
5.1 checks it explicitly rather than assuming it.

## 1. Establish the oracle

- [x] 1.1 Confirm the working tree is clean and on the merge commit of #14, so the specs are being written against exactly what shipped
- [x] 1.2 Run `npm run test:unit` and record that all 13 unit tests pass before any edit — this is the baseline every requirement is derived from
- [x] 1.3 Run `npx openspec validate --all --strict` and record that all 5 existing specs already pass structurally, so any later failure is caused by this change
- [x] 1.4 Read `tests/unit/square-corners.test.js`, `tests/unit/tailwind-build.test.js`, `tests/unit/appearance.test.js`, and `tests/unit/appearance-css.test.js` and extract the assertions that contradict the current specs

## 2. Correct the `extension-page-styling` capability

- [x] 2.1 Write the delta at `openspec/changes/align-specs-with-shipped-ui/specs/extension-page-styling/spec.md`
- [x] 2.2 REMOVE `Square corners remain enforced`, recording the reason (superseded by selectable shapes) and the migration target, rather than silently rewording it — the heading itself asserts something now false
- [x] 2.3 ADD `Radius utilities resolve through the selectable shape contract`, derived from the `--radius-*: initial` clearing, the nine scale mappings, and the "token reference or literal `0`" rule in `tailwind-build.test.js`
- [x] 2.4 MODIFY `No global CSS reset is emitted` so the reset is located in `src/styles/<page>.css`, and add the scenario that pages carry no `<style>` block or `style="…"` attribute
- [x] 2.5 MODIFY `Cascade order preserves both the reset and hand-written CSS` so the layered reset and the link order describe `appearance.css` → `tailwind.css` → `<page>.css`
- [x] 2.6 MODIFY `Utility theme is bound to appearance tokens` to drop the frozen-file scenario, add `data-ui-shape` to the live-switching scenario, and state the one-way consumer relationship
- [x] 2.7 MODIFY `JavaScript behavior is unaffected` to permit a bundler for stylesheets while forbidding one for the extension's JavaScript, phrased against the emitted `dist/*.js` shape rather than the installed toolchain
- [x] 2.8 Verify every carried-forward requirement is reproduced in full, since a MODIFIED block replaces the whole requirement

## 3. Add the `appearance-preferences` capability

- [x] 3.1 Write the delta at `openspec/changes/align-specs-with-shipped-ui/specs/appearance-preferences/spec.md`
- [x] 3.2 Specify the three preferences with their storage keys, enumerations, and defaults (`dark` / `current` / `subtle`), and record that `current` is displayed as "Modern" without the stored value changing
- [x] 3.3 Specify normalization of absent, `null`, and out-of-enumeration values, including the corrupt-profile case asserted in `appearance.test.js`
- [x] 3.4 Specify the `data-*` projection onto the appearance root, including the resolved-vs-raw theme split and `color-scheme`
- [x] 3.5 Specify `system` theme resolution through `prefers-color-scheme`, live tracking, and listener teardown on both explicit selection and disposal
- [x] 3.6 Specify `chrome.storage.sync` persistence, live cross-surface propagation, the non-`sync` area filter, and the late-read-never-clobbers-a-newer-change guarantee
- [x] 3.7 Specify that only the popup and options page write, and that the side panel and content script are read-only consumers
- [x] 3.8 Specify the per-shape radius scale table, `square` as the base scale, and the rule that authored stylesheets consume the tokens instead of hard-coding `0`
- [x] 3.9 Specify complete palettes for all 5 styles x 2 themes, the required token list, and the reduced-motion and forced-colors blocks

## 4. Fold the deltas into the main specs

- [x] 4.1 Run `npx openspec validate align-specs-with-shipped-ui --strict` and resolve any structural error
- [x] 4.2 Archive the change so the deltas are applied to `openspec/specs/`
- [x] 4.3 Confirm `openspec/specs/extension-page-styling/spec.md` no longer contains the square-corners requirement and does contain the radius-contract requirement
- [x] 4.4 Confirm `openspec/specs/appearance-preferences/spec.md` was created with all eight requirements
- [x] 4.5 Replace the `TBD - created by archiving change …` placeholder Purpose in all six capability specs with a purpose that states what the capability governs and where its boundary lies

## 5. Correct `openspec/config.yaml`

- [x] 5.1 Rewrite the stack description: Preact + htm rendering, Tailwind v4 compiled through Vite, and the real devDependency list, replacing "no framework, no runtime dependencies, only devDependency is `@playwright/test`"
- [x] 5.2 Rewrite the build description so it states both halves — `build.mjs` concatenates JavaScript, and it spawns Vite to emit `dist/{tailwind,popup,options,sidepanel}.css`
- [x] 5.3 Rewrite hard constraint 4 to state the actual radius policy enforced by `square-corners.test.js`: authored CSS consumes `var(--appearance-radius-*)` and must not hard-code `border-radius: 0`
- [x] 5.4 Add the component-shape dimension to the appearance description, so it reads 3 themes x 5 visual styles x 4 shapes
- [x] 5.5 Correct the source line counts for `src/content-script/index.mjs` and `src/background/index.mjs` to 2703 and 2756
- [x] 5.6 Re-read the whole `context` block and confirm no other sentence is contradicted by the tree

## 6. Verification

- [x] 6.1 Run `npm run build` and confirm it succeeds, proving no documentation edit disturbed the pipeline
- [x] 6.2 Run `npm run test:unit` and confirm all 13 tests still pass, unmodified — in particular `square-corners.test.js`, `tailwind-build.test.js`, and `policy-compliance.test.js`
- [x] 6.3 Run `npx openspec validate --all --strict` and confirm all 6 specs pass
- [x] 6.4 Confirm `git status` shows changes only under `openspec/`, proving the change is documentation-only as scoped
- [x] 6.5 Grep the specs for the placeholder text `TBD` and confirm there are no remaining occurrences
