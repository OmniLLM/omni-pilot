# extension-page-styling Specification

## Purpose
TBD - created by archiving change adopt-tailwind-extension-pages. Update Purpose after archive.
## Requirements
### Requirement: Build-time utility CSS compilation

The build SHALL compile a utility-first CSS framework into a static stylesheet at build time and emit it into the packaged `dist/` directory. The extension SHALL NOT load any stylesheet or script from a remote origin, and SHALL NOT run a CSS compiler in the browser.

#### Scenario: Build emits a static utility stylesheet

- **WHEN** `npm run build` completes
- **THEN** `dist/tailwind.css` exists and is non-empty

#### Scenario: No remote asset references

- **WHEN** the built extension pages in `dist/` are inspected
- **THEN** no `<link>` or `<script>` element references an `http://` or `https://` origin

#### Scenario: Packaged artifact includes the stylesheet

- **WHEN** `pack.mjs` packages the extension
- **THEN** `dist/tailwind.css` is included, and `pack.mjs` ENTRIES remains `['manifest.json', 'PRIVACY.md', 'icons', 'dist']`

### Requirement: Utility classes are namespaced

Every utility class produced by the CSS framework SHALL carry the `op` namespace prefix (authored as `op:flex`, compiled to the escaped selector `.op\:flex`), so that extension styling cannot collide with class names authored elsewhere in the codebase or in third-party page content. Every theme custom property the framework emits SHALL likewise be prefixed (`--op-*`).

#### Scenario: Generated utilities are prefixed

- **WHEN** `dist/tailwind.css` is inspected
- **THEN** every generated utility class selector begins with `.op\:`

#### Scenario: Generated theme variables are prefixed

- **WHEN** `dist/tailwind.css` is inspected
- **THEN** every custom property the framework declares in its theme layer begins with `--op-`

#### Scenario: Unprefixed utilities are absent

- **WHEN** `dist/tailwind.css` is searched for common unprefixed Tailwind selectors such as `.flex{`, `.hidden{`, or `.block{`
- **THEN** no match is found

### Requirement: No global CSS reset is emitted

The compiled stylesheet SHALL NOT contain a global CSS reset (Tailwind Preflight). No bare element-selector rule and no universal-selector rule may set any inherited or box-model property. The per-page `*, *::before, *::after` resets already authored in the extension pages remain the single source of reset behavior.

Note: Tailwind v4 emits a universal-selector rule inside an `@supports` guard in its `properties` layer to polyfill `@property` fallbacks. That rule assigns only `--tw-*` custom properties and is therefore not a reset; it is permitted.

#### Scenario: Preflight is absent

- **WHEN** `dist/tailwind.css` is inspected
- **THEN** it contains no bare `html` or `body` selector rule

#### Scenario: No box-model or typographic reset

- **WHEN** every universal-selector rule in `dist/tailwind.css` is inspected
- **THEN** none of them declares `margin`, `padding`, `box-sizing`, `border`, `font`, or `line-height`; they assign only `--tw-*` custom properties

#### Scenario: Existing page resets are preserved

- **WHEN** `src/popup/index.html`, `src/options/index.html`, and `src/sidepanel/index.html` are inspected
- **THEN** each still declares its own universal reset setting `box-sizing: border-box`, `margin: 0`, and `padding: 0` (popup and options use the `*, *::before, *::after` form; sidepanel uses the `*` form)

### Requirement: Utility theme is bound to appearance tokens

The utility framework's color, spacing, typography, and shadow scales SHALL be defined in terms of the existing `--appearance-*` custom properties from `src/styles/appearance.css`, so that all supported color themes and visual styles continue to apply without any change to the token contract.

#### Scenario: Colors resolve through appearance tokens

- **WHEN** a color utility such as `op-bg-surface` or `op-text-muted` is emitted
- **THEN** its declaration resolves to a `var(--appearance-*)` reference rather than a hard-coded color literal

#### Scenario: Theme switching still works

- **WHEN** the `data-theme` or `data-visual-style` attribute on the appearance root changes
- **THEN** elements styled with utility classes re-render with the new theme's token values, with no rebuild required

#### Scenario: Token contract is unmodified

- **WHEN** `src/styles/appearance.css` is compared against its pre-change contents
- **THEN** no `--appearance-*` token is added, removed, or redefined by this change

### Requirement: Square corners remain enforced

The utility framework's border-radius scale SHALL be overridden so that every radius value is `0`. It SHALL be impossible to introduce a rounded corner by applying a utility class.

#### Scenario: Radius utilities are zero

- **WHEN** `dist/tailwind.css` is searched for `border-radius` declarations
- **THEN** every matched value is `0` or `0px`

#### Scenario: Existing square-corner policy still passes

- **WHEN** `tests/unit/square-corners.test.js` runs
- **THEN** it passes without modification to its assertions

### Requirement: Utility CSS is confined to extension pages

The utility framework SHALL apply only to the popup, options, and sidepanel surfaces. It SHALL NOT be scanned from, linked into, or emitted for the content script, which is injected into arbitrary third-party pages without Shadow DOM isolation.

#### Scenario: Content stylesheet is free of utilities

- **WHEN** `dist/styles.css` is inspected after a build
- **THEN** it contains no `.op\:` utility selector and its contents match the concatenation of the transformed appearance CSS and `src/content-script/styles.css`

#### Scenario: Content script markup is untouched

- **WHEN** `src/content-script/index.mjs` is compared against its pre-change contents
- **THEN** no `op:` utility class is introduced

#### Scenario: Only extension pages link the stylesheet

- **WHEN** the built HTML pages are inspected
- **THEN** `popup.html`, `options.html`, and `sidepanel.html` each link `tailwind.css`, and no other surface references it

### Requirement: Cascade order preserves both the reset and hand-written CSS

The utility stylesheet SHALL declare an explicit cascade layer order of `base`, then `theme`, then `utilities`. Each extension page SHALL wrap its universal reset — and only its reset — in `@layer base`, leaving its remaining hand-written rules unlayered.

This yields the ordering `base < theme < utilities < unlayered page CSS`, so a utility can override the zero-specificity reset while hand-written page rules still take precedence over utilities during incremental migration. Without it, unlayered page CSS would beat all layered utilities regardless of specificity, and the reset would silently cancel every utility margin and padding.

#### Scenario: Layer order is declared

- **WHEN** `dist/tailwind.css` is inspected
- **THEN** it declares `@layer base, theme, utilities`

#### Scenario: Each page layers only its reset

- **WHEN** `src/popup/index.html`, `src/options/index.html`, and `src/sidepanel/index.html` are inspected
- **THEN** each wraps its universal reset in `@layer base { ... }`, and no other rule in the page is placed in a layer

#### Scenario: Utilities override the reset

- **WHEN** an element carries a spacing utility such as `op:mb-3` or `op:py-2.5`
- **THEN** its computed `margin-bottom` is `12px` and its computed `padding-block` is `10px`, not the `0` set by the reset

#### Scenario: Hand-written rules still win over utilities

- **WHEN** an unlayered page rule and a utility class both set the same property on an element
- **THEN** the unlayered page rule's value is the computed value

#### Scenario: Link ordering

- **WHEN** an extension page's `<head>` is inspected
- **THEN** the `tailwind.css` `<link>` appears after `appearance.css` and before the page's inline `<style>` block

#### Scenario: Visual parity after migration

- **WHEN** the popup markup has been migrated to utility classes
- **THEN** every migrated element's computed layout, spacing, typography, and color values match the values produced by the pre-migration hand-written CSS

### Requirement: JavaScript behavior is unaffected

Adopting the CSS framework SHALL NOT alter any JavaScript control flow, event handling, storage access, or message passing. The styling pipeline SHALL NOT introduce a bundler, a module system, or any wrapper around built scripts.

This requirement is restated because vendoring a component runtime adds a build-time inline step. The guarantee that actually matters — no bundler, no module-scoped output, no IIFE around our own code, so that `vm.runInContext` still observes top-level declarations — is unchanged and is now stated directly rather than by freezing the build file. Build-time inlining of pre-built runtime source is permitted; it is the same mechanism already used for the shared utility modules.

#### Scenario: Unit tests keep loading built scripts

- **WHEN** `npm run test:unit` runs
- **THEN** all existing unit tests pass, including those that load `dist/*.js` through `vm.runInContext` and assert on top-level declarations

#### Scenario: Element identifiers are preserved

- **WHEN** an extension page's rendered DOM is inspected
- **THEN** every element `id` that the page's script or stylesheet depends on resolves to exactly one element, whether that element is authored in the page markup or produced by rendering

#### Scenario: Styling changes add no bundler

- **WHEN** `build.mjs` is inspected
- **THEN** its `export`-stripping and concatenation helpers are driven by the same per-entry mechanism as before, and no bundler, module registry, or IIFE wraps the concatenated entry source

#### Scenario: Utility classes are discoverable wherever markup lives

- **WHEN** utility classes are authored in a page's markup or in its entry module
- **THEN** the `@source` globs scan both, so every used utility appears in the compiled stylesheet

