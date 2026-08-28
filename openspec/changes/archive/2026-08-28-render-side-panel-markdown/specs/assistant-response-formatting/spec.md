# assistant-response-formatting Specification Delta

## ADDED Requirements

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
