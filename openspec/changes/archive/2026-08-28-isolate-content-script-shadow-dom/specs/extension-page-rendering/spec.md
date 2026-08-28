# extension-page-rendering Delta

## MODIFIED Requirements

### Requirement: Bundling remains concatenation-based

Introducing the component runtime SHALL NOT introduce a bundler, a module system, or a transpiler. The build SHALL remain plain file concatenation so that built scripts stay classic scripts whose top-level declarations are observable.

#### Scenario: Top-level declarations stay observable

- **WHEN** a test loads `dist/popup.js`, `dist/sidepanel.js`, or `dist/options.js` with `vm.runInContext`
- **THEN** top-level `function` declarations from the entry source are readable as properties of the context object

#### Scenario: Our code is not wrapped

- **WHEN** the built bundles are inspected
- **THEN** no bundler preamble, module registry, or wrapper encloses the concatenated entry-file source

#### Scenario: Scripts stay classic

- **WHEN** the extension page markup is inspected
- **THEN** every `<script>` tag loading a built bundle has no `type="module"` attribute

#### Scenario: No transpiler in the pipeline

- **WHEN** the build pipeline is inspected
- **THEN** no JSX or syntax-transform step exists, because templates are expressed as native tagged template literals

#### Scenario: The service worker is untouched by rendering changes

- **WHEN** the build runs before and after a change that adopts or extends the component runtime
- **THEN** `dist/background.js` is byte-for-byte identical

### Requirement: Component runtime is confined to extension pages

The component runtime SHALL be inlined only into bundles for extension pages. It SHALL NOT reach the content script or the background service worker.

The original rationale for this requirement was that the content script is injected into arbitrary websites without style or DOM isolation. That is no longer true — the content script now isolates its UI in a shadow root. The requirement stands on narrower grounds: the content script's interface has not been converted to the component runtime, so shipping the runtime there would be dead weight in a bundle that is parsed on every page the user visits. Converting it remains a separate, future change.

#### Scenario: Content script excludes the runtime

- **WHEN** `dist/content.js` is inspected
- **THEN** it contains no component runtime source and no runtime global

#### Scenario: Background worker excludes the runtime

- **WHEN** `dist/background.js` is inspected
- **THEN** it contains no component runtime source, as the service worker renders no UI
