# Ask about the current page from the side panel

## Why

The extension already ships a side panel, but nothing opens it and it knows
nothing about the page the user is looking at. Chrome surfaces it only through
the browser's own side panel dropdown, and once open it is a generic chat box.

The behaviour users expect — as in Chrome's built-in Gemini panel — is a panel
that opens beside the page and answers questions *about that page*.

## What Changes

- A context menu item, "Ask about this page", opens the side panel for the
  current tab.
- The popup gains a button that does the same.
- The content script answers a new `GET_PAGE_CONTEXT` request with the page's
  title, URL, and extracted main text, reusing the existing `extractPageContent`
  used by the page-summary action.
- The side panel shows the current page as a chip above the transcript, with a
  checkbox to include or exclude it, and refreshes it when the user switches or
  reloads tabs.
- When included, the page is sent once per conversation as a leading `system`
  message ahead of the first user turn.

## Impact

- Affected specs: `page-context-chat`
- Affected code: `src/content-script/index.mjs`, `src/background/index.mjs`,
  `src/popup/index.mjs`, `src/sidepanel/index.mjs`, `src/sidepanel/index.html`
- No new permissions. `sidePanel`, `contextMenus`, and `<all_urls>` are already
  granted, and `<all_urls>` is what makes tab title and URL readable without the
  forbidden `tabs` permission.
- The `AI_CHAT_STREAM` port contract is unchanged; page context travels inside
  the existing `messages` array.
