# Tasks

## 1. Diagnose

- [x] 1.1 Reproduce from the reported reply: a heading, then prose, rendered as one run with a large gap under the heading
- [x] 1.2 Trace the cause to the blanket `\n` → `<br>` replacement at the end of `formatResult`
- [x] 1.3 Confirm the two distinct symptoms: no paragraph elements at all, and stray breaks around block markup

## 2. Assemble real blocks

- [x] 2.1 Add `assembleBlocks`, grouping consecutive prose lines into `<p>` and passing block lines through
- [x] 2.2 Treat a blank line as a paragraph boundary and a single newline as an in-paragraph `<br>`
- [x] 2.3 Recognise block lines including the code-block, table and think-block placeholders, so later substitution does not land inside a paragraph
- [x] 2.4 Remove the blanket newline replacement
- [x] 2.5 Confirm `assembleBlocks` runs after escaping so no escaping guarantee is weakened

## 3. Give the blocks rhythm

- [x] 3.1 Add bottom-margin spacing for `p`, `ul`, `ol`, `blockquote`, `table`, `pre`
- [x] 3.2 Clear the last child's margin so the bubble padding is not doubled
- [x] 3.3 Tighten heading margins and clear the top margin on a leading heading
- [x] 3.4 Add list indentation and item spacing
- [x] 3.5 Confirm no `border-radius` is introduced, keeping the square-corner policy intact

## 4. Cover it

- [x] 4.1 Add `tests/content-response-formatting.spec.js` driven by the reported reply
- [x] 4.2 Assert paragraph count, heading element, and absence of block-level breaks
- [x] 4.3 Assert measured spacing: paragraphs separated, heading close to its paragraph
- [x] 4.4 Assert lists, code blocks, and tables are not nested in paragraphs
- [x] 4.5 Assert inline emphasis survives and hostile markup stays literal

## 5. Verify

- [x] 5.1 All 12 formatting tests pass
- [x] 5.2 Visually confirm the rendered panel against the reported screenshot
- [x] 5.3 `npm run test:unit` passes
- [x] 5.4 Full browser suite passes
