# side-panel-session-controls Specification

## Purpose

Governs the side panel's session controls — the action, provider, and model chips in its header.

This capability owns making the active provider and model visible and changeable from the panel, fetching and filtering the model list, reaching the built-in functions without leaving the panel, and localizing provider and function names. It also owns the requirement that these selectors behave identically to the floating panel's, so the two surfaces cannot diverge into two different interaction models.

Boundary: this capability covers what the controls offer and how they behave. How they are rendered belongs to `extension-page-rendering`, and the page content a chosen function runs against belongs to `page-context-chat`.

## Requirements
### Requirement: The side panel exposes the active model and provider

The side panel SHALL display which model and which provider will answer, and
SHALL let the user change either without leaving the panel.

#### Scenario: The header names the current model and provider

- **WHEN** the side panel opens
- **THEN** its header shows the stored provider's display name and the stored model name

#### Scenario: Choosing a model applies it

- **WHEN** the user opens the model chip and chooses an entry
- **THEN** the choice is written through the existing set-model message
- **AND** the chip shows the newly chosen model

#### Scenario: Choosing a provider applies it

- **WHEN** the user opens the provider chip and chooses an entry
- **THEN** the choice is written through the existing set-provider message

#### Scenario: The current entry is marked

- **WHEN** either selector is open
- **THEN** exactly one entry is marked as current, matching the value shown on the chip

#### Scenario: Changes made elsewhere are reflected

- **WHEN** the model or provider is changed from another surface, such as the options page
- **THEN** the side panel header updates without being reopened

### Requirement: The model list is fetched and filterable

The model selector SHALL obtain its list from the extension rather than
hard-coding one, and SHALL let the user narrow a long list by typing.

#### Scenario: The list is requested when the selector opens

- **WHEN** the user opens the model selector
- **THEN** the model list is requested from the extension and rendered once it arrives

#### Scenario: Typing narrows the list

- **WHEN** the user types into the selector's filter
- **THEN** only models whose names contain the typed text remain listed

#### Scenario: A filter matching nothing says so

- **WHEN** the filter matches no model
- **THEN** the selector reports that there are no matches instead of showing an empty box

#### Scenario: Model names are never treated as markup

- **WHEN** a model name contains characters that would form markup
- **THEN** the name is displayed literally

### Requirement: The built-in functions are reachable from the side panel

The side panel SHALL offer the same built-in functions as the floating panel,
and SHALL run the chosen function against the page the panel is about.

#### Scenario: The action selector lists chat plus every function

- **WHEN** the user opens the action chip
- **THEN** the list contains a chat entry followed by the same built-in functions the floating panel offers

#### Scenario: Choosing a function runs it on the page

- **WHEN** the user chooses a function while the page is readable
- **THEN** the function is run against the page content over the existing stream port, using the existing action-stream message
- **AND** the result is appended to the transcript

#### Scenario: The transcript records which function ran

- **WHEN** a function is run from the side panel
- **THEN** the transcript shows which function produced the result

#### Scenario: Choosing chat runs nothing

- **WHEN** the user chooses the chat entry
- **THEN** no request is issued and the panel returns to ordinary chat

#### Scenario: An unreadable page cannot run a function

- **WHEN** the user chooses a function while the page cannot be read
- **THEN** no request is issued and the panel reports that there is nothing to run the function on

### Requirement: The selectors behave consistently with the floating panel

Each header selector SHALL open below its chip, close when dismissed, and never
leave more than one selector open.

#### Scenario: A second click on the same chip closes the selector

- **WHEN** a selector is open and the user clicks its chip again
- **THEN** the selector closes and does not reopen

#### Scenario: Opening one selector closes another

- **WHEN** one selector is open and the user opens a different one
- **THEN** only the newly opened selector remains on screen

#### Scenario: Clicking away dismisses the selector

- **WHEN** a selector is open and the user clicks elsewhere in the panel
- **THEN** the selector closes without applying a choice

### Requirement: Provider and function names are localized

The header selectors SHALL present function names in the user's chosen
interface language.

#### Scenario: Function names follow the language preference

- **WHEN** the interface language preference is changed
- **THEN** the action chip and its entries are shown in that language

