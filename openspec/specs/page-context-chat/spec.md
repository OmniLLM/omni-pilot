# page-context-chat Specification

## Purpose
TBD - created by archiving change add-page-context-side-panel. Update Purpose after archive.
## Requirements
### Requirement: The side panel can be opened for the current tab

The extension SHALL provide affordances that open the side panel beside the page
the user is viewing, without requiring the browser's own side panel menu.

#### Scenario: Opening from the page context menu

- **WHEN** the user opens the context menu on a page and chooses the "ask about this page" item
- **THEN** the side panel opens for that tab

#### Scenario: Opening from the toolbar popup

- **WHEN** the user opens the toolbar popup and activates its side panel button
- **THEN** the side panel opens for the active tab

#### Scenario: Opening survives the user gesture requirement

- **WHEN** either affordance is activated
- **THEN** the side panel open call is issued synchronously within the click handler, so the browser's user-gesture requirement is satisfied

### Requirement: The page is readable by the side panel

The content script SHALL answer a page-context request with the current page's
title, URL, and extracted main text, reusing the extraction already used for
page summaries.

#### Scenario: A readable page responds with its content

- **WHEN** the side panel requests page context for a tab running the content script
- **THEN** the response carries the page title, URL, and extracted text

#### Scenario: A restricted page yields no context

- **WHEN** the active tab has no content script, such as a browser-internal page
- **THEN** the request fails without throwing, and the side panel treats the page as unreadable

#### Scenario: Extracted text is bounded

- **WHEN** the page's extracted text is very long
- **THEN** it is truncated to a fixed maximum before being used, so a large page cannot overflow the request

### Requirement: The side panel shows which page it is using

The side panel SHALL display the page it will use as context, and SHALL let the
user exclude it.

#### Scenario: The chip names the page

- **WHEN** the active page is readable
- **THEN** a chip shows the page title, falling back to the tab title and then the URL, and carries the full URL as its tooltip

#### Scenario: The chip reports an unreadable page

- **WHEN** the active page cannot be read
- **THEN** the chip says so and offers no include control

#### Scenario: Inclusion is on by default and can be turned off

- **WHEN** the chip is shown for a readable page
- **THEN** its include control is checked by default
- **AND WHEN** the user unchecks it
- **THEN** the page is excluded from subsequent requests

#### Scenario: The chip follows the user

- **WHEN** the user switches to another tab, or the active tab finishes loading a new page
- **THEN** the chip refreshes to describe the newly active page

### Requirement: Conversations are grounded in the page

When the page is included, it SHALL be supplied to the model as conversation
context without altering the existing streaming contract.

#### Scenario: Page context leads the first turn

- **WHEN** the user sends their first message with the page included
- **THEN** the request history begins with a system message carrying the page title, URL, and text, followed by the user message

#### Scenario: Page context is sent once per conversation

- **WHEN** the user sends a second message in the same conversation
- **THEN** the history still contains exactly one page-context system message

#### Scenario: Excluded or unreadable pages add nothing

- **WHEN** the user sends a message while the page is excluded, unreadable, or has no extractable text
- **THEN** the request history contains only the conversation messages

#### Scenario: The stream contract is unchanged

- **WHEN** a message is sent
- **THEN** it is posted on the existing stream port, with the same port name and message type as before, with the page context carried inside the existing messages array

