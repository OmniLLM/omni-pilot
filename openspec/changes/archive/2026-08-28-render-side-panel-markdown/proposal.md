# Render assistant replies in the side panel as formatted markdown

## Why

The side panel showed the model's raw output as plain text. Replies routinely
contain markdown, so users saw literal `**bold**`, numbered lists collapsed onto
a single running line, and markdown tables rendered as a wall of pipe
characters — `| Provider | Models listed | |---|---| | **Anthropic** …`. A reply
that was carefully structured by the model arrived as an unreadable paragraph.

The floating panel already renders all of this correctly. The renderer was
private to the content script, so the two surfaces were free to diverge — and
had.

## What Changes

- **MODIFIED** the renderer into `src/utils/markdown.mjs`, shared by the content
  script and the side panel. The content script keeps a thin wrapper that
  supplies its localized "thinking" label.
- **MODIFIED** the side panel to render assistant replies through it: headings,
  paragraphs, lists, tables, block quotes, rules, links, emphasis, inline code,
  fenced code blocks with a working Copy button, and collapsible think blocks.
- **MODIFIED** the side panel stylesheet with block spacing and table, code, and
  think-block styling drawn from the appearance tokens.
- **FIXED** two defects in the shared renderer, both of which also affected the
  floating panel:
  - Every table gained a spurious empty trailing column. The row parser dropped
    the empty string before the leading pipe but kept the one after the trailing
    pipe, because its filter compared the index against the *unfiltered* array's
    length, which is always true.
  - Emphasis inside table cells was shown literally. Tables are extracted from
    the text before the inline pass runs, and cells were escaped as plain text
    with no inline pass of their own.

User messages remain plain text — only the model's output is treated as
markdown, and it is escaped before any markup is generated.

## Impact

- Affected specs: `assistant-response-formatting`
- Affected code: `src/utils/markdown.mjs` (new), `src/content-script/index.mjs`,
  `src/sidepanel/index.mjs`, `src/sidepanel/index.html`, `build.mjs`
