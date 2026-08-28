# extension-page-styling

## MODIFIED Requirements

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
