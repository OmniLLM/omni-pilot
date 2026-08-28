# Adopt the component runtime on the options page

## Why

The options page contains the largest imperative rendering block in the
codebase: `renderA2aServers` builds roughly 100 lines of markup by string
concatenation, assigns it through `innerHTML`, and hand-escapes 27 interpolated
values with a local `escapeHtml` helper. A sibling function, `startEditA2aServer`,
swaps a row for an edit form through `outerHTML`.

This is the only place in the extension where untrusted, user-supplied data
(agent names, endpoints, and skill descriptions fetched from a remote agent card)
is concatenated into an HTML string. Correctness depends on every one of those 27
interpolations remembering to call `escapeHtml`. One omission is a script
injection into a privileged extension page.

The popup and side panel already render from state through the vendored component
runtime. Extending it to this region removes the string-concatenation renderer
entirely and makes escaping structural rather than manual.

## What Changes

- The agent list region of the options page is rendered by the component runtime
  instead of `innerHTML` string concatenation. `escapeHtml` is no longer used to
  build markup; text is escaped by the renderer.
- The inline edit form stops replacing DOM through `outerHTML` and becomes part of
  the rendered output, driven by an "editing" state value.
- `build.mjs` inlines the component runtime into the options bundle, via the same
  opt-in per-entry flag introduced for the popup and side panel.
- Unit tests that asserted on the concatenated HTML string move to the browser
  suite. Unit tests that only needed the agent list as fixture data seed that
  state directly instead of rendering.

Deliberately unchanged, because these are functional pieces rather than rendering:

- The static form markup for provider, model, memory, and appearance settings
  stays in `index.html`, driven by the existing `getElementById` accessors.
- The click and change delegation listeners bound to the agent list container are
  untouched. The rendered output keeps the same `data-action`, `data-server-id`,
  `data-skill-id`, and `data-skill-toggle` attributes those listeners match on.
- Every storage key, message type, normalization function, and status string.

## Impact

- Affected specs: `extension-page-rendering`
- Affected code: `src/options/index.mjs`, `build.mjs`,
  `tests/unit/options.test.js`, `tests/settings-page.spec.js`
- `dist/background.js` and `dist/content.js` remain byte-identical.
  `dist/options.js` grows by the size of the inlined runtime.
