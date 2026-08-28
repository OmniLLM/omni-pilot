# page-context-chat Spec Delta

## MODIFIED Requirements

### Requirement: The page is readable by the side panel

The content script SHALL answer a page-context request with the current page's
title, URL, and extracted main text, reusing the extraction already used for
page summaries. Extraction SHALL prefer the page's main content over
promotional, navigational and other boilerplate material.

#### Scenario: A readable page responds with its content

- **WHEN** the side panel requests page context for a tab running the content script
- **THEN** the response carries the page title, URL, and extracted text

#### Scenario: A restricted page yields no context

- **WHEN** the active tab has no content script, such as a browser-internal page
- **THEN** the request fails without throwing, and the side panel treats the page as unreadable

#### Scenario: Extracted text is bounded

- **WHEN** the page's extracted text is very long
- **THEN** it is truncated to a fixed maximum before being used, so a large page cannot overflow the request

#### Scenario: A promotional article does not stand in for the page

- **WHEN** the page places a promotional or announcement card in an article element ahead of its main content landmark
- **THEN** the extracted text is the main content, not the promotional card

#### Scenario: Articles are ranked by content, not document order

- **WHEN** the page has several article elements and no main content landmark
- **THEN** the article carrying the most text is extracted, regardless of its position in the document

#### Scenario: Page chrome is excluded

- **WHEN** the page carries navigation, headers, footers, complementary asides, dialogs, or the extension's own UI
- **THEN** none of their text appears in the extracted content

#### Scenario: Structure survives extraction

- **WHEN** content is extracted from block-level elements such as paragraphs, headings and list items
- **THEN** the extracted text keeps line breaks at those boundaries rather than running together

#### Scenario: A short page still yields its content

- **WHEN** the page's main content is shorter than the threshold used to identify substantive content
- **THEN** the richest candidate found is still returned rather than nothing

## ADDED Requirements

### Requirement: Functions run against the page as it is now

When a built-in function is chosen in the side panel, the page SHALL be re-read
at that moment rather than reusing a previously captured snapshot.

#### Scenario: A late-rendering page is read fresh

- **WHEN** the user chooses a function after the page has changed or finished rendering since the panel last captured it
- **THEN** the function runs against the page content read at the time of the choice

#### Scenario: An unreadable page still reports clearly

- **WHEN** the page cannot be read at the time a function is chosen
- **THEN** the transcript reports that the page is unavailable instead of running the function
