# Tasks

## 1. Establish an oracle first

- [x] 1.1 Write `tests/content-selectors.spec.js` against the **unmodified** implementation
- [x] 1.2 Cover the action selector: contents, single current entry, toggle, choosing, outside-click
- [x] 1.3 Cover the provider selector: contents, current entry, `SET_PROVIDER`, closing
- [x] 1.4 Cover the model selector: fetch, hostile name as text, filtering, no-matches, choosing, `SET_MODEL`, current marking, keystroke isolation
- [x] 1.5 Run it and get to green before changing any implementation code

## 2. Fix the shadow-boundary regression the oracle exposed

- [x] 2.1 Diagnose why five tests failed against unmodified code — `event.target` is retargeted to the shadow host at `document`-level listeners
- [x] 2.2 Add `eventPathContains`, hit-testing via `composedPath()` with a `contains` fallback
- [x] 2.3 Apply it to all three outside-click handlers
- [x] 2.4 Confirm the toggle and choose-an-entry tests now pass
- [x] 2.5 Correct the test stub, which called the message callback unconditionally even though `SET_MODEL` / `SET_PROVIDER` are fire-and-forget

## 3. Convert the selectors

- [x] 3.1 Flip the content entry to opt into the component runtime in `build.mjs`
- [x] 3.2 Add `openFloatingSelector` owning toggle, positioning, dismissal, and unmount-before-detach
- [x] 3.3 Add a shared `SelectorItem` component
- [x] 3.4 Add a `ModelSelector` component holding models and filter text as state
- [x] 3.5 Rewrite the three `show*Selector` functions on top of the helper
- [x] 3.6 Preserve the invalidated-context path that closes the model selector instead of leaving a spinner

## 4. Update the tests the conversion invalidates

- [x] 4.1 Move `dist/content.js` into the with-runtime list in `preact-build.test.js`
- [x] 4.2 Invert the "content script must never carry the runtime" assertion and keep the service worker excluded
- [x] 4.3 Add `content` to the entries permitted to opt in
- [x] 4.4 Remove the selector assertions from `content-language.test.js`, which drive a fake document the runtime cannot render into, and point to the browser coverage

## 5. Verify

- [x] 5.1 All 18 oracle tests pass **unmodified** against the converted implementation
- [x] 5.2 `npm run test:unit` passes
- [x] 5.3 Full browser suite passes
- [x] 5.4 `dist/background.js` remains byte-identical
