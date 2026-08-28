# Render the content script's floating selectors with the component runtime

## Why

Shadow DOM isolation removed the reason the component runtime was banned from the content script. With the UI now sealed behind a shadow boundary, the content script can render components without any risk to host pages.

The three floating selectors — action, provider, model — were the obvious first target. They were 175 lines of near-duplicate imperative DOM code: three copies of "remove any open one, build a div, position it below the anchor, append items, register an outside-click handler". The model selector additionally rebuilt its list by hand on every keystroke via `innerHTML`, and built each row with `createElement` + `textContent`.

Converting them removes the duplication and makes the list a function of state rather than a sequence of mutations.

## What Changes

- **ADDED** a shared `openFloatingSelector` helper owning the lifecycle common to all three selectors: toggle-on-second-click, positioning below the anchor, outside-click dismissal, and unmounting the component before detaching.
- **ADDED** a `SelectorItem` component, replacing three separately-built row constructions, and a `ModelSelector` component that holds its model list and filter text as state.
- **MODIFIED** the build so the content entry opts into the component runtime.
- **MODIFIED** `tests/unit/preact-build.test.js`, which previously asserted the content script must *never* carry the runtime. That assertion is inverted; the service worker remains excluded.
- **MODIFIED** `tests/unit/content-language.test.js` to drop its selector assertions, which drove the selectors through a hand-written fake document that the component runtime cannot render into. That coverage moved to the browser suite.

Explicitly **not** in scope: the streaming transcript. Panel persistence serialises `body.innerHTML` and restores it verbatim, so the transcript's markup *is* its state. Converting it means redesigning the persistence format — a functional change, not a rendering one, and it is not attempted here.

## Impact

- Affected specs: `extension-page-rendering`
- Affected code: `src/content-script/index.mjs`, `build.mjs`, two unit tests
- `dist/content.js` grows from 173.4 KB to 186.7 KB (the vendored runtime)

### A regression this work uncovered

The oracle was written first, against the pre-conversion implementation, and **five of its eighteen tests failed immediately**. The cause was not the conversion — it was the shadow root landed in the previous change.

Events crossing a shadow boundary are retargeted to the shadow host by the time they reach a listener on `document`. Every selector's outside-click handler tested `selector.contains(e.target)`, which was therefore always false. Clicking a chip a second time closed the selector and instantly reopened it; clicking an item destroyed the element between `mousedown` and `mouseup`, so the `click` event never fired and the choice was silently dropped.

`eventPathContains` now hit-tests with `composedPath()`, which still carries the real target through the boundary. This was a live, user-visible bug in shipped behaviour that the existing 142-test suite did not catch, because nothing covered these selectors.
