# Design — align-specs-with-shipped-ui

## Context

This is a documentation-only correction. The unusual property of the change is that it has an **authoritative oracle**: the test suite. Every requirement written here is derived from an assertion that already passes on `main`, so there is no design freedom about *what* is true — only about where each truth belongs and how it is phrased so it does not rot again.

## D1. Direction of reconciliation: code wins

Two shipped commits contradicted the specs. There are two ways to reconcile:

1. Change the code back to match the specs.
2. Change the specs to match the code.

(1) is wrong here. Both commits are merged, released behavior; selectable component shapes are a deliberate product decision that superseded the earlier square-corners decision, and reverting would be a product regression disguised as a compliance fix. This change therefore takes direction (2) exclusively, and the Non-goals section of the proposal states it as a hard rule: **if a spec and the code disagree, the code wins.**

The consequence is a self-check for every requirement written here: it must be traceable to a passing assertion or to observable shipped behavior. Requirements that cannot be traced are not written.

## D2. Impact on `build.mjs`

**None. The file is not opened.**

This matters more than it appears, because the specs being corrected are the *styling* specs, and the instinct when correcting them is to "tidy" the build. Resisting that keeps the change's risk at zero:

- The JavaScript path in `build.mjs` — `inlineModule`, `stripExports`, `stripUtilityImports`, `concatAgentPrimitives`, `concatBackgroundProviders`, and the `entries` loop — is untouched, so all five `dist/*.js` outputs are byte-identical before and after.
- `buildTailwind()` is untouched. It still resolves `node_modules/vite/bin/vite.js` directly rather than shelling out to `npx`, and still fails the whole build on a non-zero exit.
- The content-script CSS inlining that produces `OMNIPILOT_CONTENT_CSS` is untouched, so `tests/unit/tailwind-build.test.js`'s byte-equality assertion against the transformed appearance CSS keeps holding.

The spec text is updated to *describe* this pipeline accurately, which is the actual defect: the current spec says the styling pipeline introduces no bundler, written when Tailwind ran through its standalone CLI. Vite is now in the tree. The guarantee that was always meant is narrower and still exactly true, so the requirement is restated as: **Vite compiles CSS only; the extension's JavaScript is never bundled, wrapped, or module-scoped.**

## D3. Impact on the `vm.runInContext` unit-test strategy

**None, and this is the load-bearing invariant of the whole repository.**

Thirteen Node unit tests load `dist/*.js` through `vm.runInContext` and assert on *top-level* declarations. Any construct that introduces a module scope — an IIFE, a bundler's module registry, an ESM wrapper — makes those declarations invisible and breaks every one of them at once.

Because this change emits no JavaScript and modifies no build step, the observable surface those tests read is unchanged. `npm run test:unit` is therefore a complete regression check: if it passes, the invariant is intact.

The invariant is also the reason the corrected `JavaScript behavior is unaffected` requirement is phrased around *`dist/` output shape* rather than around *which tools are installed*. Pinning the requirement to a tool list is what let it go stale when Vite arrived; pinning it to "no bundler, module registry, or IIFE wraps the concatenated entry source" survives any future toolchain swap, because that is the property the tests actually depend on.

## D4. Where the appearance capability belongs

The appearance system could plausibly be folded into `extension-page-styling`. It is kept separate because the two capabilities answer different questions and change for different reasons:

| | `extension-page-styling` | `appearance-preferences` |
|---|---|---|
| Question | How is CSS compiled, namespaced, and confined? | What can the user choose, and how does the choice reach every surface? |
| Surfaces | popup, options, sidepanel (content script explicitly excluded) | popup, options, sidepanel **and** content script |
| Changes when | the CSS toolchain changes | the preference model changes |
| Evidence | `tailwind-build.test.js` | `appearance.test.js`, `appearance-css.test.js`, `square-corners.test.js`, `popup.spec.js`, `settings-page.spec.js`, `sidepanel.spec.js` |

Folding them together would produce a capability that spans every surface *and* the build, and that no single test file covers — the shape most likely to drift again. The seam is drawn where the surface list and the evidence differ.

The radius scale is the one place the two capabilities touch: `appearance-preferences` **defines** `--appearance-radius-*` per shape, and `extension-page-styling` **consumes** those tokens for its `--radius-*` utility namespace. This is stated as a consumer relationship in the styling spec so the direction of dependency is unambiguous.

## D5. Replace-and-add rather than rename the radius requirement

`Square corners remain enforced` could be edited in place under `## MODIFIED Requirements`, keeping its heading. That is rejected: the heading is the requirement's identity, and this heading now asserts something false. Anyone grepping the specs for the project's corner policy must not find "square corners enforced" as a live requirement.

The delta therefore uses `## REMOVED Requirements` for the old heading and `## ADDED Requirements` for `Radius utilities resolve through the selectable shape contract`. The archive step records both moves, so the history shows the policy was replaced rather than quietly reworded.

## D6. Existing test files that must be updated

**None.** Every test file is deliberately left byte-identical, and each is named here with the justification for leaving it alone:

| Test file | Why it is not updated |
|---|---|
| `tests/unit/square-corners.test.js` | It is the oracle for the new radius requirement. Editing it would destroy the evidence the requirement is derived from. |
| `tests/unit/tailwind-build.test.js` | Oracle for every corrected `extension-page-styling` scenario — layer order, reset location, link order, `@source` scoping, radius token resolution. |
| `tests/unit/appearance.test.js` | Oracle for the enumerations, defaults, normalization, and storage-vs-initial-read precedence in `appearance-preferences`. |
| `tests/unit/appearance-css.test.js` | Oracle for the per-style x per-theme palette coverage and the required token list. |
| `tests/unit/policy-compliance.test.js` | Guards constraint 5. This change alters no version, permission, or pack entry, so it must keep passing untouched — that is the assertion. |
| `tests/popup.spec.js`, `tests/settings-page.spec.js`, `tests/sidepanel.spec.js` | Oracles for live application, persistence, cross-surface propagation, and the side panel's read-only role. |
| All remaining unit and Playwright specs | Out of scope; no behavior changes. |

If any of these needed an edit to make this change pass, that would prove the change had stopped being documentation-only.

## D7. Guarding against the next drift

Two phrasing rules are applied throughout, both derived from how the current specs failed:

1. **No frozen-file scenarios in main specs.** The existing `Token contract is unmodified` scenario reads "`src/styles/appearance.css` is compared against its **pre-change** contents". That sentence is meaningful inside a change proposal and meaningless once archived into a main spec — it silently became false the moment the shapes commit added radius overrides. Such scenarios are rewritten as durable properties.
2. **Reference file *roles*, not incidental locations, where the role is what matters.** The reset requirement broke because it named `src/popup/index.html`. It is rewritten around "each page's component stylesheet", with current paths given as the concrete instance.

## Open questions

None. Every claim in this change is backed by a passing assertion; nothing here required a judgement call that the test suite could not settle.
