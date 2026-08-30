# extension-page-styling Specification

## Purpose

Governs how CSS is produced and where it is allowed to reach.

This capability owns the build-time utility CSS pipeline for the popup, options, and side panel — its compilation, its `op` namespacing, its deliberate omission of a global reset, its cascade-layer order, and its binding to the `--appearance-*` tokens. It also owns the isolation guarantees for the content script, whose UI is mounted in an open shadow root and styled by its own inlined stylesheet so that nothing crosses into or out of a third-party page.

Two boundaries matter. The token *values* belong to `appearance-preferences`; this capability only consumes them. And while a bundler compiles the stylesheets, it must never be applied to the extension's JavaScript, which stays flat and concatenated so the unit tests can keep reading top-level declarations out of `dist/*.js`.

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

The compiled stylesheet SHALL NOT contain a global CSS reset (Tailwind Preflight). No bare element-selector rule and no universal-selector rule may set any inherited or box-model property. Each extension page's own universal reset remains the single source of reset behavior.

Note: Tailwind v4 emits a universal-selector rule inside an `@supports` guard in its `properties` layer to polyfill `@property` fallbacks. That rule assigns only `--tw-*` custom properties and is therefore not a reset; it is permitted.

#### Scenario: Preflight is absent

- **WHEN** `dist/tailwind.css` is inspected
- **THEN** it contains no bare `html` or `body` selector rule

#### Scenario: No box-model or typographic reset

- **WHEN** every universal-selector rule in `dist/tailwind.css` is inspected
- **THEN** none of them declares `margin`, `padding`, `box-sizing`, `border`, `font`, or `line-height`; they assign only `--tw-*` custom properties

#### Scenario: Each page keeps its own reset in its component stylesheet

- **WHEN** each extension page's component stylesheet — `src/styles/popup.css`, `src/styles/options.css`, and `src/styles/sidepanel.css` — is inspected
- **THEN** each declares a universal reset setting `box-sizing: border-box`, `margin: 0`, and `padding: 0` (popup and options use the `*, *::before, *::after` form; sidepanel uses the bare `*` form)

#### Scenario: Pages carry no inline styling

- **WHEN** `src/popup/index.html`, `src/options/index.html`, and `src/sidepanel/index.html` are inspected
- **THEN** none contains a `<style>` block or a `style="…"` attribute; all page CSS is reached through linked stylesheets

### Requirement: Utility theme is bound to appearance tokens

The utility framework's color, spacing, typography, radius, and shadow scales SHALL be defined in terms of the `--appearance-*` custom properties owned by the `appearance-preferences` capability. The framework SHALL be a consumer of that contract only: it SHALL NOT declare, redefine, or shadow any `--appearance-*` token, so every supported color theme, visual style, and component shape continues to apply without a rebuild.

#### Scenario: Colors resolve through appearance tokens

- **WHEN** a color utility such as `op:bg-surface` or `op:text-ink-muted` is emitted
- **THEN** its declaration resolves to a `var(--appearance-*)` reference rather than a hard-coded color literal

#### Scenario: Every appearance dimension switches live

- **WHEN** the `data-theme`, `data-visual-style`, or `data-ui-shape` attribute on the appearance root changes
- **THEN** elements styled with utility classes re-render with the new values, with no rebuild required

#### Scenario: The framework declares no appearance token

- **WHEN** every custom property declared in `dist/tailwind.css` is inspected
- **THEN** each is prefixed `--op-` or `--tw-`; `--appearance-*` names appear only as `var()` references, never on the left-hand side of a declaration

### Requirement: Utility CSS is confined to extension pages

The utility framework SHALL apply only to the popup, options, and sidepanel surfaces. It SHALL NOT be scanned from, linked into, or emitted for the content script, which is injected into arbitrary third-party pages.

#### Scenario: Content stylesheet is free of utilities

- **WHEN** the content stylesheet inlined into `dist/content.js` is extracted and inspected after a build
- **THEN** it contains no `.op\:` utility selector and its contents match the concatenation of the transformed appearance CSS and `src/content-script/styles.css`

#### Scenario: Content script markup is untouched

- **WHEN** `src/content-script/index.mjs` is compared against its pre-change contents
- **THEN** no `op:` utility class is introduced

#### Scenario: Only extension pages link the stylesheet

- **WHEN** the built HTML pages are inspected
- **THEN** `popup.html`, `options.html`, and `sidepanel.html` each link `tailwind.css`, and no other surface references it

### Requirement: Cascade order preserves both the reset and hand-written CSS

The utility stylesheet SHALL declare an explicit cascade layer order of `base`, then `theme`, then `utilities`. Each extension page's component stylesheet SHALL wrap its universal reset — and only its reset — in `@layer base`, leaving its remaining hand-written rules unlayered.

This yields the ordering `base < theme < utilities < unlayered page CSS`, so a utility can override the zero-specificity reset while hand-written page rules still take precedence over utilities during incremental migration. Without it, unlayered page CSS would beat all layered utilities regardless of specificity, and the reset would silently cancel every utility margin and padding.

#### Scenario: Layer order is declared

- **WHEN** `dist/tailwind.css` is inspected
- **THEN** the `base`, `theme`, and `utilities` layers each appear, and their first appearance is in that order

#### Scenario: Each component stylesheet layers only its reset

- **WHEN** `src/styles/popup.css`, `src/styles/options.css`, and `src/styles/sidepanel.css` are inspected
- **THEN** each declares exactly one `@layer` block, `@layer base`, containing its universal reset; every other rule in the file is unlayered

#### Scenario: Utilities override the reset

- **WHEN** an element carries a spacing utility such as `op:mb-3` or `op:py-2.5`
- **THEN** its computed `margin-bottom` is `12px` and its computed `padding-block` is `10px`, not the `0` set by the reset

#### Scenario: Hand-written rules still win over utilities

- **WHEN** an unlayered page rule and a utility class both set the same property on an element
- **THEN** the unlayered page rule's value is the computed value

#### Scenario: Link ordering

- **WHEN** an extension page's `<head>` is inspected
- **THEN** it links `appearance.css`, then `tailwind.css`, then its own component stylesheet (`popup.css`, `options.css`, or `sidepanel.css`), in that order

#### Scenario: Visual parity after migration

- **WHEN** a surface's markup has been migrated to utility classes
- **THEN** every migrated element's computed layout, spacing, typography, and color values match the values produced by the pre-migration hand-written CSS

### Requirement: JavaScript behavior is unaffected

The styling pipeline SHALL NOT alter any JavaScript control flow, event handling, storage access, or message passing, and SHALL NOT change the shape of the emitted scripts. A bundler MAY be used to compile stylesheets; it SHALL NOT be applied to the extension's JavaScript, which SHALL continue to be emitted as flat, concatenated, non-module scripts with no IIFE, module registry, or other wrapper around them.

This boundary is what the unit tests depend on: they load `dist/*.js` through `vm.runInContext` and assert on top-level declarations, which any module scope would hide. The guarantee is stated in terms of the emitted output rather than the tools installed, so it survives a change of toolchain.

#### Scenario: Unit tests keep loading built scripts

- **WHEN** `npm run test:unit` runs
- **THEN** all existing unit tests pass, including those that load `dist/*.js` through `vm.runInContext` and assert on top-level declarations

#### Scenario: Stylesheet compilation does not reach the scripts

- **WHEN** the build's stylesheet compilation step runs
- **THEN** its inputs and outputs are stylesheets only, and every `dist/*.js` entry is produced by the concatenation path unchanged

#### Scenario: Emitted scripts are unwrapped

- **WHEN** any `dist/*.js` entry is inspected
- **THEN** no bundler preamble, module registry, or IIFE wraps the concatenated source, and its declarations remain at the top level

#### Scenario: Element identifiers are preserved

- **WHEN** an extension page's rendered DOM is inspected
- **THEN** every element `id` that the page's script or stylesheet depends on resolves to exactly one element, whether that element is authored in the page markup or produced by rendering

#### Scenario: Utility classes are discoverable wherever markup lives

- **WHEN** utility classes are authored in a page's markup or in its entry module
- **THEN** the `@source` globs scan both, so every used utility appears in the compiled stylesheet

### Requirement: Content script UI is isolated from the host page cascade

The content script's user interface SHALL be mounted inside an open shadow root, and its stylesheet SHALL be injected inside that same shadow root. Neither the host page's styles nor OmniPilot's styles SHALL cross the boundary in either direction.

#### Scenario: The UI is mounted behind a shadow boundary

- **WHEN** the content script mounts its interface on any page
- **THEN** a shadow host element exists on `document.body` with an open shadow root, the UI root element lives inside that shadow root, and the UI root element is not reachable from the host document's light DOM

#### Scenario: Host page styles cannot restyle the UI

- **WHEN** the host page declares aggressive global rules such as `* { font-family: … !important }`, `div { border-radius: … !important }`, and `button { opacity: … !important }`
- **THEN** the OmniPilot bubble's computed font family, letter spacing, text transform, and opacity are unaffected by those rules

#### Scenario: OmniPilot styles do not reach the host page

- **WHEN** the content script has mounted its interface
- **THEN** the host document contains no stylesheet or style element carrying OmniPilot's rules, and the host page's own elements keep their original computed background, border radius, and color

#### Scenario: The shadow host occupies no layout space

- **WHEN** the shadow host element is measured in the host page
- **THEN** its height is zero, so it does not displace host page content

### Requirement: No stylesheet is injected into host documents

The extension SHALL NOT declare any CSS file for injection into pages it matches. The content script's stylesheet SHALL be carried inside its own bundle and injected only into its shadow root.

#### Scenario: The manifest injects no CSS

- **WHEN** `manifest.json` is inspected
- **THEN** no entry in `content_scripts` declares a `css` array

#### Scenario: The stylesheet is inlined into the bundle

- **WHEN** `dist/content.js` is inspected after a build
- **THEN** it declares the content stylesheet as a top-level string constant, and `dist/styles.css` is not emitted as a build output

### Requirement: Radius utilities resolve through the selectable shape contract

The utility framework's `--radius-*` theme namespace SHALL be cleared and redefined so that every radius scale resolves through a `var(--appearance-radius-*)` reference owned by the `appearance-preferences` capability. A radius utility SHALL NOT introduce a hard-coded corner size of its own: the only permitted literal value is `0`.

This makes the utility layer a pure consumer of the shape contract. Applying `op:rounded-md` yields whatever the user's selected component shape defines, and a scale value that was never mapped cannot survive into a build.

#### Scenario: The radius namespace is cleared

- **WHEN** `src/styles/tailwind.css` is inspected
- **THEN** its `@theme` block declares `--radius-*: initial`, so no unlisted scale inherited from the framework's defaults can be emitted

#### Scenario: Every scale resolves through the appearance contract

- **WHEN** the `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, `--radius-2xl`, `--radius-3xl`, `--radius-4xl`, and `--radius-full` declarations in `src/styles/tailwind.css` are inspected
- **THEN** each one resolves to a `var(--appearance-radius-*)` reference rather than a length literal

#### Scenario: Compiled radius declarations are token references or zero

- **WHEN** every `border-radius` declaration in `dist/tailwind.css` is inspected
- **THEN** each value is either a `var(--op-radius-*)` reference to a token the stylesheet itself declares, or the literal `0`

#### Scenario: Changing the shape restyles utility-styled elements

- **WHEN** the `data-ui-shape` attribute on the appearance root changes
- **THEN** elements carrying radius utilities re-render with the new shape's corner sizes, with no rebuild required

