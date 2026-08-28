# extension-page-styling Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
