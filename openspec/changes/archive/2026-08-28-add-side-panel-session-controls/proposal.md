# Give the side panel the same session controls as the floating panel

## Why

The floating panel that opens over a page carries three header chips — action,
provider, model — each opening a small selector. The side panel carries none of
them. It is a chat window with no way to see or change which model is answering,
which provider is being used, or to run one of the built-in functions.

That is an inconsistency the user has to work around: to switch model or
provider while using the side panel, they must select text on the page, open the
floating panel, change it there, and come back. The built-in functions
(translate, summarize, explain, …) are unreachable from the side panel entirely,
even though the side panel already holds the page content those functions would
operate on.

## What Changes

- **ADDED** an action chip to the side panel header, listing Chat plus the same
  built-in functions the floating panel offers. Choosing a function runs it
  immediately against the current page content.
- **ADDED** a provider chip listing the same providers, writing the choice
  through the existing `SET_PROVIDER` message.
- **ADDED** a model chip that fetches the model list with `GET_MODELS`, filters
  it as the user types, and writes the choice through `SET_MODEL`.
- **ADDED** live reflection of model and provider: both chips follow changes made
  anywhere else (options page, floating panel) through the existing storage
  change listener.
- **MODIFIED** `src/utils/` to hold a shared catalog of the provider labels and
  the action list, which were previously private to the content script. Both
  surfaces now read one definition instead of two copies.
- **MODIFIED** the build so the side panel bundle carries the translation table
  and the new catalog.

No background or protocol change: every message type used here
(`GET_MODELS`, `SET_MODEL`, `SET_PROVIDER`, `AI_ACTION_STREAM`) already exists
and is already handled. `dist/background.js` is unchanged.

## Impact

- Affected specs: `side-panel-session-controls` (new)
- Affected code: `src/sidepanel/index.mjs`, `src/sidepanel/index.html`,
  `src/content-script/index.mjs`, `src/utils/catalog.mjs` (new), `build.mjs`
