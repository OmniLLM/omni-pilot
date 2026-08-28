# assistant-response-formatting Specification

## Purpose
TBD - created by archiving change format-assistant-response-blocks. Update Purpose after archive.
## Requirements
### Requirement: Assistant replies are rendered as structured blocks

An assistant reply SHALL be rendered as discrete block elements. Prose separated by a blank line SHALL become separate paragraph elements, and the renderer SHALL NOT represent paragraph separation with consecutive line-break elements.

#### Scenario: Blank-line-separated prose becomes paragraphs

- **WHEN** a reply contains three passages of prose separated by blank lines
- **THEN** three paragraph elements are rendered

#### Scenario: A single reply paragraph is still a paragraph

- **WHEN** a reply is a single short passage of prose
- **THEN** exactly one paragraph element is rendered

#### Scenario: A single newline remains a line break

- **WHEN** two prose lines are separated by a single newline rather than a blank line
- **THEN** they render inside one paragraph with a line break between them

#### Scenario: No break elements sit at block level

- **WHEN** a reply containing a heading and several paragraphs is rendered
- **THEN** no line-break element is a direct child of the result container

### Requirement: Block markup is never nested inside a paragraph

Headings, lists, tables, code blocks, block quotes, and horizontal rules SHALL be emitted as siblings of paragraphs, never wrapped inside one, because block content inside a paragraph is invalid and is split by the browser.

#### Scenario: A heading is a heading element

- **WHEN** a reply contains a markdown heading
- **THEN** it renders as a heading element carrying the heading text

#### Scenario: Lists render outside paragraphs

- **WHEN** a reply contains a bulleted list between two passages of prose
- **THEN** one list element with the expected items is rendered, no list is nested inside a paragraph, and the surrounding prose renders as two paragraphs

#### Scenario: Code blocks render outside paragraphs

- **WHEN** a reply contains a fenced code block between two passages of prose
- **THEN** the code block card renders with the code intact and is not nested inside a paragraph

#### Scenario: Tables render outside paragraphs

- **WHEN** a reply contains a markdown table
- **THEN** the table renders with its data rows and is not nested inside a paragraph

### Requirement: Structured replies are visually separated

Rendered blocks SHALL be spaced so that consecutive paragraphs are distinguishable, without leaving an oversized gap between a heading and the text it introduces.

#### Scenario: Consecutive paragraphs are separated

- **WHEN** two paragraphs are rendered
- **THEN** a visible vertical gap separates them

#### Scenario: A heading sits close to its first paragraph

- **WHEN** a heading is followed by a paragraph
- **THEN** the gap between them is smaller than the gap the previous break-based output produced

### Requirement: Formatting preserves inline markup and escaping

Block assembly SHALL preserve inline formatting and SHALL NOT reintroduce any ability for reply content to inject markup.

#### Scenario: Inline emphasis survives

- **WHEN** a paragraph contains bold and italic markdown
- **THEN** the corresponding inline elements render inside that paragraph

#### Scenario: Hostile markup stays literal text

- **WHEN** a reply contains raw HTML such as an image tag with an error handler
- **THEN** it is displayed as literal text and no such element is created

### Requirement: Every surface renders assistant replies with the same formatter

Assistant replies SHALL be formatted identically wherever they are shown, so a
reply does not read differently depending on which panel it arrived in.

#### Scenario: The side panel renders markdown structure

- **WHEN** a reply containing headings, paragraphs, and lists is shown in the side panel
- **THEN** it is rendered with the same block structure the floating panel produces

#### Scenario: Emphasis is rendered rather than shown as its markers

- **WHEN** a reply contains bold or italic markers
- **THEN** the emphasized words are rendered emphasized and the markers are not shown

#### Scenario: Lists become list items

- **WHEN** a reply contains a numbered or bulleted list
- **THEN** each entry becomes its own list item rather than running together as prose

#### Scenario: Only model output is treated as markdown

- **WHEN** the user's own message contains markdown markers
- **THEN** it is displayed literally

#### Scenario: Model output can never inject markup

- **WHEN** a reply contains text that would form HTML
- **THEN** it is displayed as literal text and no element is created from it

### Requirement: Markdown tables render as tables

A pipe-delimited table in a reply SHALL become a real table, with exactly the
columns the author wrote.

#### Scenario: A table becomes a table

- **WHEN** a reply contains a pipe-delimited table with a separator row
- **THEN** it is rendered as a table with a header row and one row per data line
- **AND** no pipe or separator characters remain visible

#### Scenario: A closing pipe adds no column

- **WHEN** a table's rows end with a trailing pipe, as they conventionally do
- **THEN** the rendered table has exactly as many columns as the header names, with no empty column at the end

#### Scenario: Cells carry inline formatting

- **WHEN** a table cell contains emphasis, a link, or inline code
- **THEN** the cell renders that formatting rather than showing its markers

### Requirement: Code blocks are copyable wherever they appear

A fenced code block SHALL be rendered as a card carrying its language and a copy
control, on every surface that shows replies.

#### Scenario: A fenced block becomes a card

- **WHEN** a reply contains a fenced code block
- **THEN** it is rendered as a code card showing the code, with a copy control

#### Scenario: The copy control works in the side panel

- **WHEN** the user activates a code card's copy control in the side panel
- **THEN** the block's code is written to the clipboard and the control confirms it

### Requirement: Prose responses are asked for structure

Every prompt whose output is an explanation, summary or answer SHALL instruct
the model to return structured Markdown, so that no surface receives an
undifferentiated block of text.

#### Scenario: Explanatory actions carry the formatting rules

- **WHEN** a summarize, explain, ask, sentiment, code explanation or GitHub thread action is dispatched
- **THEN** its system prompt asks for short paragraphs, Markdown tables for comparative data, lists for enumerations, headings for multi-topic answers, and fenced code blocks

#### Scenario: Chat carries the formatting rules

- **WHEN** a conversational request is assembled
- **THEN** the system prompt sent to the provider carries the same formatting rules

#### Scenario: All surfaces share one definition

- **WHEN** the floating panel, the side panel or the popup issues a request
- **THEN** the rules applied are the same ones, defined once in the background worker

#### Scenario: No sentence cap suppresses structure

- **WHEN** a summary is requested
- **THEN** the prompt does not impose a fixed sentence count that would prevent a table or list

### Requirement: Verbatim transformations are left unformatted

Actions whose value is the transformed text itself SHALL NOT be given formatting
rules, because added structure would corrupt the requested output.

#### Scenario: Translation returns only the translation

- **WHEN** any translate action is dispatched
- **THEN** its system prompt carries no formatting rules

#### Scenario: Rewriting returns only the rewritten text

- **WHEN** the improve or divide-paragraphs action is dispatched
- **THEN** its system prompt carries no formatting rules

### Requirement: Formatting rules yield to the instructions under pressure

The formatting rules SHALL occupy their own context section, ranked below the
system prompt, so a constrained token budget drops them rather than the
instructions.

#### Scenario: A tight budget keeps the instructions

- **WHEN** the context budget is too small to hold both the system prompt and the formatting rules
- **THEN** the system prompt is still sent and the formatting rules are dropped

### Requirement: Context menu delivery to an unscripted tab is not an error

Dispatching a context-menu action to a tab that has no content script SHALL be
handled silently.

#### Scenario: An unscripted tab does not pollute the error log

- **WHEN** a context-menu action is delivered to a tab that cannot receive it
- **THEN** the failure is swallowed and no unhandled rejection is reported by the service worker

