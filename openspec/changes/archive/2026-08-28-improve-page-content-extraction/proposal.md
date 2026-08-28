# Improve page content extraction

## Why

Clicking **Summarize** in the side panel sometimes returns a summary of
something that is not the page — in the reported case, a "Microsoft Ignite —
Register now" promo banner instead of the Microsoft Learn lesson the user was
reading.

Two independent defects combine to produce this:

1. `extractPageContent()` accepts `document.querySelector('article')` — the
   *first* article in document order — as soon as it holds more than 50
   characters, and returns immediately. Sites routinely place promotional and
   announcement cards in an `<article>` above the real one. There is no `<main>`
   or `[role="main"]` handling at all, despite that being the standard landmark,
   and no boilerplate stripping, so nav, headers, footers and cookie dialogs are
   captured as content.

2. The side panel runs built-in functions against `pageRef.current`, a snapshot
   taken when the panel opened or the tab changed. On a page that finishes
   rendering afterwards, the function runs against whatever was on screen first.

## What Changes

- Rank content candidates in tiers — `main`, `[role="main"]`, articles, common
  content ids, the largest-element heuristic, then `body` — and choose within
  the article tier by extracted text length rather than document order.
- Skip boilerplate subtrees and OmniPilot's own UI while collecting text, and
  preserve block boundaries as newlines.
- Require a substantive amount of text before accepting a candidate, keeping the
  richest candidate seen as a fallback so short pages still work.
- Re-read the page when a function is chosen in the side panel instead of
  reusing the cached snapshot.

## Impact

- Affected specs: `page-context-chat`
- Affected code: `src/content-script/index.mjs`, `src/sidepanel/index.mjs`
