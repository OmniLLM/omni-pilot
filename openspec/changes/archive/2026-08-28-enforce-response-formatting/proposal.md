# Enforce response formatting

## Why

Replies arrive as a single unbroken wall of prose. The screenshot that prompted
this describes a bar chart of per-model spending — inherently tabular data — as
one 15-line paragraph listing figure after figure. It is close to unreadable in
a narrow panel.

The renderer is not at fault: it already produces headings, paragraphs, lists
and tables. The models were simply never asked for structure, and two prompts
actively worked against it by capping the answer at "2-3 concise sentences" and
"3-5 sentences".

## What Changes

- Add a single set of formatting rules — Markdown, short paragraphs, tables for
  comparative data, lists for enumerations, headings for multi-topic answers,
  fenced code — shared by every prompt whose output is prose.
- Exclude the transformation actions (translate, improve, divide paragraphs),
  whose value is the returned text itself.
- Drop the sentence-count caps that suppressed structure.
- Carry the rules into chat as their own context section, so a tight token
  budget sheds them before it sheds the instructions.
- Stop context-menu delivery to a tab without a content script from surfacing as
  an unhandled rejection in the service worker's error log.

Because all three surfaces — the floating panel, the side panel and the popup —
issue their requests through the background worker, one definition covers them
all.

## Impact

- Affected specs: `assistant-response-formatting`
- Affected code: `src/background/index.mjs`, `src/background/agent/agent.mjs`
