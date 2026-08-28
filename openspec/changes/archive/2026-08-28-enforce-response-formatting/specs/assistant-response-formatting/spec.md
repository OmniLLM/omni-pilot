# assistant-response-formatting Spec Delta

## ADDED Requirements

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
