# extension-page-rendering

How the popup and side panel construct their UI: the vendored component runtime, how it reaches the bundle without a bundler, which surfaces may use it, and the state model that replaces imperative DOM mutation.

## ADDED Requirements

### Requirement: Component runtime is vendored at build time

The component runtime SHALL be inlined into the bundles that need it during `node build.mjs`, from a package resolved inside the repository. No runtime module loading, remote fetch, or package manager access SHALL occur when the extension runs.

#### Scenario: Runtime is present in the built bundle

- **WHEN** `node build.mjs` completes
- **THEN** `dist/popup.js` and `dist/sidepanel.js` each contain the component runtime source inline

#### Scenario: No remote or dynamic loading

- **WHEN** the built bundles and extension page markup are inspected
- **THEN** no `<script src>` points at a remote origin, and the bundles contain no `import(`, `eval(`, or `new Function(` introduced by the runtime

#### Scenario: Runtime is not a runtime dependency

- **WHEN** `package.json` is inspected
- **THEN** the component runtime packages appear only under `devDependencies`, and the `dependencies` field remains empty or absent

#### Scenario: No new packaged file

- **WHEN** `node pack.mjs` runs
- **THEN** its `ENTRIES` list is unchanged and no additional runtime file is added to the archive, because the runtime is inlined into the existing `dist/*.js` outputs

### Requirement: Bundling remains concatenation-based

Introducing the component runtime SHALL NOT introduce a bundler, a module system, or a transpiler. The build SHALL remain plain file concatenation so that built scripts stay classic scripts whose top-level declarations are observable.

#### Scenario: Top-level declarations stay observable

- **WHEN** a test loads `dist/popup.js` or `dist/sidepanel.js` with `vm.runInContext`
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
- **THEN** `dist/background.js`, `dist/content.js`, and `dist/options.js` are byte-for-byte identical

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
- **THEN** runtime inlining is controlled by an explicit per-entry flag, enabled only for the popup and sidepanel entries

### Requirement: Side panel renders from a message model

The side panel SHALL hold its conversation as structured state and derive its DOM from that state. It SHALL NOT build transcript nodes through direct `createElement`, `appendChild`, or `textContent` mutation.

#### Scenario: Transcript is state-derived

- **WHEN** the side panel source is inspected
- **THEN** the rendered transcript is produced from an array of message records, each carrying at least a role and its text content

#### Scenario: Empty state is conditional

- **WHEN** the conversation contains no messages
- **THEN** the empty-state prompt is rendered
- **AND WHEN** the first message is added
- **THEN** the empty-state prompt is no longer rendered

#### Scenario: Streaming text accumulates in place

- **WHEN** successive `chunk` messages arrive on the stream port
- **THEN** the assistant message's rendered text equals the accumulation of all received chunks, within a single message element

#### Scenario: Streaming state is visually distinct

- **WHEN** an assistant message is still streaming
- **THEN** its element carries the streaming state class
- **AND WHEN** the stream settles successfully
- **THEN** that class is removed

#### Scenario: Transcript scrolls to the newest content

- **WHEN** a message is appended or streaming text grows
- **THEN** the transcript container is scrolled to its latest content

### Requirement: Side panel stream protocol is preserved exactly

Moving rendering to a component model SHALL NOT change the side panel's messaging contract, timing behavior, conversation history, or user-visible error strings.

#### Scenario: Port contract is unchanged

- **WHEN** the user sends a message
- **THEN** a port is opened with the same port name as before, and a message of the same type is posted carrying the full conversation history

#### Scenario: History records only settled turns

- **WHEN** a turn completes successfully
- **THEN** the user text was appended to history at send time and the accumulated assistant text is appended once on settle, matching the previous ordering

#### Scenario: Watchdog re-arms on activity

- **WHEN** any message arrives on the port
- **THEN** the silence watchdog is reset, so healthy long-running streams are never interrupted

#### Scenario: Watchdog expiry with no text

- **WHEN** the watchdog elapses and no text has accumulated
- **THEN** a timeout error message is shown and the port is disconnected

#### Scenario: Watchdog expiry with partial text

- **WHEN** the watchdog elapses after text has accumulated
- **THEN** the partial text is retained, its streaming state is cleared, it is committed to history, and the port is disconnected

#### Scenario: Status messages show placeholder text

- **WHEN** a `status` message arrives and no text has accumulated yet
- **THEN** the assistant message shows the placeholder corresponding to that status
- **AND WHEN** text has already accumulated
- **THEN** the accumulated text is left untouched

#### Scenario: Error messages surface only without text

- **WHEN** an `error` message arrives and no text has accumulated
- **THEN** the error text is rendered as an error entry

#### Scenario: Completion with no text

- **WHEN** a `done` message arrives with no accumulated text
- **THEN** any pending assistant placeholder is discarded, and a "no response" error is rendered unless an error entry is already present

#### Scenario: Disconnect without completion

- **WHEN** the port disconnects before settling
- **THEN** accumulated text is retained and committed to history if present, otherwise the pending placeholder is discarded and a "no response" error is rendered unless an error entry is already present

#### Scenario: Invalidated extension context

- **WHEN** opening the port or posting to it throws an extension-context-invalidated error
- **THEN** a context-unavailable error is rendered instead of the error propagating

#### Scenario: Settled streams ignore late messages

- **WHEN** a stream has settled
- **THEN** subsequent port messages produce no further rendering or history changes

#### Scenario: Send affordances are unchanged

- **WHEN** the user clicks send, or presses Enter without Shift
- **THEN** the message is sent, the input is cleared, and its auto-grown height is reset
- **AND WHEN** the input is empty or whitespace only
- **THEN** no message is sent

### Requirement: Popup renders from preference state

The popup SHALL derive its status row, appearance controls, and language selector from state read through the existing storage contract, without changing which keys it reads or writes.

#### Scenario: Readiness reflects provider configuration

- **WHEN** the provider is the managed provider, or the auth method is the managed method, or an API key is present
- **THEN** the status is rendered in its ready state
- **AND OTHERWISE** it is rendered in its not-configured state

#### Scenario: Status state is expressed as a class

- **WHEN** the status indicator is rendered
- **THEN** its ready state is expressed through the same state class that the stylesheet targets

#### Scenario: Storage contract is unchanged

- **WHEN** the popup reads or writes preferences
- **THEN** it uses the same storage keys, defaults, and area as before

#### Scenario: External changes update the view

- **WHEN** a watched preference changes in storage from another surface
- **THEN** the popup re-renders to reflect the new value

#### Scenario: Selections persist and apply immediately

- **WHEN** the user changes the theme, visual style, or language control
- **THEN** the new value is written to storage and applied to the live view without a reload

#### Scenario: Appearance controller wiring is preserved

- **WHEN** the popup initializes
- **THEN** it drives the shared appearance controller as before, and disposes it on unload

#### Scenario: Shell renders before extension APIs are touched

- **WHEN** the popup document loads
- **THEN** its full markup is rendered from default state synchronously, before any extension storage or runtime API is accessed
- **AND** the markup remains present even if those APIs are unavailable

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

#### Scenario: Non-component surfaces keep the existing mechanism

- **WHEN** the options page and content script are inspected
- **THEN** they continue to use the existing attribute-driven translation pass, unchanged

### Requirement: Component surfaces are covered by browser-based tests

Surfaces rendered by components SHALL be verified in a real browser, because a hand-written fake DOM cannot host a renderer.

#### Scenario: Fake-DOM unit tests are retired

- **WHEN** the unit test suite is inspected
- **THEN** it contains no tests that simulate the popup or side panel through a hand-written DOM stub

#### Scenario: Side panel gains end-to-end coverage

- **WHEN** the browser test suite runs
- **THEN** it exercises the side panel's send, streaming, status, error, completion, and disconnect paths

#### Scenario: Popup behavior is covered in a browser

- **WHEN** the browser test suite runs
- **THEN** it exercises the popup's readiness states, preference persistence, and language switching

#### Scenario: Visual parity pins still pass

- **WHEN** the popup computed-style parity tests run against the component-rendered popup
- **THEN** every pinned layout, spacing, typography, and color value matches the pre-existing recorded value

#### Scenario: Whole suite is green

- **WHEN** `npm run test:unit` and the browser suite run
- **THEN** all tests pass, including the unmodified tests covering the background worker, content script, and options page
