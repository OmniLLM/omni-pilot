# extension-page-rendering Delta

## ADDED Requirements

### Requirement: Content script floating selectors render from state

The content script's action, provider, and model selectors SHALL be produced by the component runtime from their source lists. They SHALL NOT be assembled by concatenating HTML strings, and the model list SHALL be a function of the fetched models and the current filter text rather than of imperative rebuilds.

#### Scenario: Selector rows are component-rendered

- **WHEN** the content script source is inspected
- **THEN** the three selectors are rendered through the component runtime, and no `innerHTML` assignment builds any part of them

#### Scenario: A hostile model name is rendered as text

- **WHEN** the backend returns a model name containing HTML markup
- **THEN** the name is displayed as literal text and no element derived from it is created

#### Scenario: The filter narrows the list without rebuilding it by hand

- **WHEN** the user types into the model filter
- **THEN** only matching models remain listed, matching is case-insensitive, and clearing the filter restores the full list

#### Scenario: An empty filter result is explained

- **WHEN** the filter matches no model
- **THEN** a no-matches message is shown in place of the list

#### Scenario: Choosing an entry applies it and closes the selector

- **WHEN** the user clicks an entry in the action, provider, or model selector
- **THEN** the corresponding selection is applied, the matching message is sent for provider and model, and the selector closes

### Requirement: Floating selectors dismiss correctly across the shadow boundary

Outside-click dismissal SHALL hit-test the event's composed path rather than its retargeted target, because the content script's UI is inside a shadow root and `event.target` observed from `document` is the shadow host.

#### Scenario: Clicking the same chip twice closes the selector

- **WHEN** the user clicks a chip that has already opened its selector
- **THEN** the selector closes and does not reopen

#### Scenario: Clicking an entry is not swallowed by the dismiss handler

- **WHEN** the user clicks an entry inside an open selector
- **THEN** the dismiss handler does not remove the selector before the click is delivered, and the entry's action takes effect

#### Scenario: Clicking elsewhere on the page dismisses the selector

- **WHEN** the user clicks outside both the selector and its anchor chip
- **THEN** the selector closes

## MODIFIED Requirements

### Requirement: Component runtime is confined to extension pages

The component runtime SHALL be inlined only into bundles whose surface renders component UI. It SHALL NOT reach the background service worker, which renders no UI.

The content script is now included, because its interface is isolated in a shadow root and its floating selectors are component-rendered.

#### Scenario: Content script carries the runtime

- **WHEN** `dist/content.js` is inspected
- **THEN** it contains the vendored component runtime

#### Scenario: Background worker excludes the runtime

- **WHEN** `dist/background.js` is inspected
- **THEN** it contains no component runtime source, as the service worker renders no UI
