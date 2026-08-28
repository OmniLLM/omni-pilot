# Tasks

## 1. Share the renderer

- [x] 1.1 Extract `formatResult` and its helpers into `src/utils/markdown.mjs` as `renderMarkdown`
- [x] 1.2 Parameterise the localized "thinking" label so the module carries no surface-specific text
- [x] 1.3 Inline it into the content and side panel bundles
- [x] 1.4 Reduce the content script's `formatResult` to a wrapper and confirm its 13 formatting tests still pass unchanged

## 2. Render replies in the side panel

- [x] 2.1 Render assistant messages through `renderMarkdown`
- [x] 2.2 Keep user messages as plain text
- [x] 2.3 Style paragraphs, headings, lists, quotes, rules, links, and inline code from the appearance tokens
- [x] 2.4 Style tables, code cards, and think blocks
- [x] 2.5 Delegate the code card's Copy button from the transcript
- [x] 2.6 Keep the streaming caret on the last line of the reply, and keep the transcript scrolled to the bottom

## 3. Fix the defects the work exposed

- [x] 3.1 Strip a row's outer pipes before splitting, removing the spurious trailing column
- [x] 3.2 Apply the inline pass to table cells so emphasis inside them renders
- [x] 3.3 Add a regression test for each on both surfaces

## 4. Verify

- [x] 4.1 `tests/sidepanel-markdown.spec.js` covers every scenario in the spec
- [x] 4.2 `npm run test:unit` passes
- [x] 4.3 Full browser suite passes
- [x] 4.4 `dist/background.js` remains byte-identical
- [x] 4.5 Visual confirmation against the reply the user reported
