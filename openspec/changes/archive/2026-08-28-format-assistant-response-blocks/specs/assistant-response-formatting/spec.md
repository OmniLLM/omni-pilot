# assistant-response-formatting Delta

## ADDED Requirements

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
