# Give assistant responses real block structure

## Why

Reported from a live session: assistant replies render as one long undifferentiated run of text, with an oddly large empty gap under headings.

The cause is in `formatResult`. After converting markdown to inline HTML, it finished with:

```js
formatted = formatted.replace(/\n/g, '<br>');
```

Every newline became a `<br>`, which has two consequences:

1. **There are no paragraphs.** A blank line between two paragraphs became `<br><br>`, so the output is a single continuous text node with soft breaks in it. There is no paragraph spacing, no rhythm, and nothing for CSS to style — precisely the "one long line" that was reported.

2. **Block elements collect stray breaks.** The newlines *surrounding* a heading, list, table or code block also became `<br>`s, so `<h3>Summary</h3>` was followed by two literal line breaks on top of the heading's own margin. That is the empty gap in the report.

## What Changes

- **ADDED** `assembleBlocks`, which walks the converted text line by line, groups consecutive prose lines into `<p>` elements, and emits block-level markup on its own. A blank line ends a paragraph; a single newline within one stays a `<br>`, which is the one thing the old code got right.
- **REMOVED** the blanket `\n` → `<br>` replacement.
- **ADDED** spacing rules for `p`, `ul`, `ol`, `blockquote`, `table`, `pre`, `h3`, `h4` and `li` inside `.omnipilot-result`, so the new block structure has vertical rhythm. Spacing is applied as bottom margin only, with the last child cleared, so the first and last blocks sit flush against the bubble padding rather than adding a gap.

## Impact

- Affected specs: `assistant-response-formatting` (new)
- Affected code: `src/content-script/index.mjs`, `src/content-script/styles.css`
- New coverage: `tests/content-response-formatting.spec.js` (12 tests)

Block-level markup must never be wrapped in a `<p>`. A `<div>` or `<table>` inside a paragraph is invalid HTML and the browser silently splits the paragraph around it, which would reintroduce the very gaps being fixed. `assembleBlocks` therefore recognises block lines — including the code-block, table and think-block placeholders, which are substituted for `<div>` and `<table>` markup later in the pipeline — and passes them through untouched.

Escaping is unaffected: `assembleBlocks` runs well after `escapeHtml`, and only ever joins or wraps lines that have already been escaped. A test asserts a hostile `<img>` in a reply is still rendered as literal text.
