# extension-page-rendering Delta

## ADDED Requirements

### Requirement: Options page agent list renders from state

The options page's configured-agent list SHALL be produced by the component
runtime from the agent array. It SHALL NOT be assembled by concatenating an HTML
string, and no hand-written escaping helper SHALL be used to build its markup.

#### Scenario: No string-built markup remains

- **WHEN** the options page source is inspected
- **THEN** the agent list is rendered through the component runtime, and neither `innerHTML` nor `outerHTML` is assigned to build any part of it

#### Scenario: Untrusted agent metadata is escaped structurally

- **WHEN** an agent's name, endpoint, skill name, skill identifier, or skill description contains HTML markup
- **THEN** that value is rendered as literal text, and no element derived from it is created in the document

#### Scenario: Secrets are never rendered

- **WHEN** the agent list renders for an agent that has a stored authentication token
- **THEN** the token value does not appear anywhere in the rendered output

#### Scenario: Delegation contract is preserved

- **WHEN** the agent list is rendered
- **THEN** every control carries the same `data-action` and `data-server-id` attribute pair as before, and skill checkboxes carry the same skill-toggle attributes, so the existing delegated listeners match unchanged

#### Scenario: Enablement state is visible and actionable

- **WHEN** an agent is enabled
- **THEN** its row offers a disable control and carries no disabled state class
- **AND WHEN** an agent is disabled
- **THEN** its row offers an enable control and carries the disabled state class

#### Scenario: Toggling enablement re-renders from persisted state

- **WHEN** the user activates an agent's enable or disable control
- **THEN** the new enablement value is persisted and the row re-renders offering the opposite control

#### Scenario: Skill panel expansion is state-driven

- **WHEN** an agent has discovered skills
- **THEN** a summary of enabled skills is rendered with a control to expand the skill panel
- **AND WHEN** the panel is expanded
- **THEN** one checkbox per skill is rendered, reflecting that skill's enabled state

#### Scenario: Inline editing is rendered, not spliced

- **WHEN** the user activates an agent's edit control
- **THEN** that agent's row is replaced by an edit form as part of the rendered output rather than by out-of-band DOM replacement
- **AND WHEN** the user cancels
- **THEN** the list returns to its normal rendering with no agent left in the editing state

#### Scenario: Health indicators survive rendering

- **WHEN** the agent list renders
- **THEN** a health indicator element is present for each agent, addressable by that agent's identifier, so the existing health check can update it

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

#### Scenario: Untouched surfaces are byte-identical

- **WHEN** the build runs before and after this change
- **THEN** `dist/background.js` and `dist/content.js` are byte-for-byte identical

### Requirement: Component runtime is confined to extension pages

The component runtime SHALL be inlined only into bundles for extension pages. It SHALL NOT reach the content script, which is injected into arbitrary websites without style or DOM isolation.

#### Scenario: Content script excludes the runtime

- **WHEN** `dist/content.js` is inspected
- **THEN** it contains no component runtime source and no runtime global

#### Scenario: Background worker excludes the runtime

- **WHEN** `dist/background.js` is inspected
- **THEN** it contains no component runtime source, as the service worker renders no UI

#### Scenario: Runtime inlining is opt-in per entry

- **WHEN** `build.mjs` is inspected
- **THEN** runtime inlining is controlled by an explicit per-entry flag, enabled only for the popup, sidepanel, and options entries

### Requirement: Localization is render-driven on component surfaces

On surfaces rendered by components, translated text SHALL be produced during rendering rather than by post-render DOM mutation, so that re-rendering cannot revert translated content.

#### Scenario: Labels come from the translation lookup

- **WHEN** a component surface renders localized text
- **THEN** each string is resolved through the translation lookup for the active language at render time

#### Scenario: Language change re-renders text

- **WHEN** the active language changes
- **THEN** all localized strings on the surface reflect the new language

#### Scenario: Document language attribute is maintained

- **WHEN** the active language is applied
- **THEN** the document's `lang` attribute is set to that language

#### Scenario: Attribute-driven translation still covers static markup

- **WHEN** the options page applies a language
- **THEN** its static markup continues to be translated by the existing attribute-driven pass
- **AND** that pass does not reach component-rendered regions, which resolve their own labels at render time

#### Scenario: Content script keeps the existing mechanism

- **WHEN** the content script is inspected
- **THEN** it continues to use the existing attribute-driven translation pass, unchanged

### Requirement: Component surfaces are covered by browser-based tests

Surfaces rendered by components SHALL be verified in a real browser, because a hand-written fake DOM cannot host a renderer.

#### Scenario: Fake-DOM unit tests are retired

- **WHEN** the unit test suite is inspected
- **THEN** it contains no test that asserts on markup produced by a component-rendered region through a hand-written DOM stub

#### Scenario: Side panel gains end-to-end coverage

- **WHEN** the browser test suite runs
- **THEN** it exercises the side panel's send, streaming, status, error, completion, and disconnect paths

#### Scenario: Popup behavior is covered in a browser

- **WHEN** the browser test suite runs
- **THEN** it exercises the popup's readiness states, preference persistence, and language switching

#### Scenario: Agent list behavior is covered in a browser

- **WHEN** the browser test suite runs
- **THEN** it exercises the agent list's rendering of names and endpoints, its omission of tokens, its escaping of markup in agent metadata, its enable and disable controls, its skill panel, and its inline edit form

#### Scenario: Visual parity pins still pass

- **WHEN** the popup computed-style parity tests run against the component-rendered popup
- **THEN** every pinned layout, spacing, typography, and color value matches the pre-existing recorded value

#### Scenario: Whole suite is green

- **WHEN** `npm run test:unit` and the browser suite run
- **THEN** all tests pass, including the unmodified tests covering the background worker and content script
