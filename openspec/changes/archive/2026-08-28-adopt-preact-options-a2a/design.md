# Design

## Context

`renderA2aServers` is ~100 lines of template-literal HTML assigned through
`innerHTML`, with 27 `escapeHtml` call sites. It is invoked by nine different
delegated actions. `startEditA2aServer` replaces a single row through
`outerHTML`. Both live inside a 1,162-line module that is otherwise plain form
handling, and both are covered by a fake-DOM unit test whose elements are hand
written objects with a string `innerHTML` property.

## Goals / Non-Goals

**Goals**

- Remove HTML string construction, and therefore manual escaping, from the
  options page.
- Keep every functional path — storage, messaging, normalization, delegation —
  bit-for-bit behaviorally identical.

**Non-Goals**

- Converting the static settings form. It is not dynamic, it is driven by stable
  `getElementById` accessors, and 168 unit assertions depend on that shape.
  Rewriting it would trade a large amount of real coverage for no reduction in
  risk.
- Changing the delegated event listeners.
- Fixing pre-existing quirks in the agent list.

## Decisions

### D1: Render into the existing container, keep the container in HTML

`#a2aServerList` stays in `index.html`. The renderer mounts into it. The element
keeps its identity, so the two delegated listeners bound to it during
`DOMContentLoaded` stay bound across every re-render. This is what makes the
change invisible to the event layer.

Rejected: mounting a component that owns the listeners. That would move
functional logic into the render layer, which this change explicitly avoids.

### D2: Keep the `data-action` attribute protocol

The delegated listener matches `[data-action][data-server-id]` and reads values
with `getAttribute`. The components emit exactly those attributes rather than
attaching handlers. This looks unidiomatic for a component framework, and it is
deliberate: the alternative is rewriting the nine-branch dispatcher, which is
functional code.

### D3: Editing becomes state, not a DOM splice

`startEditA2aServer` currently overwrites a row with `outerHTML`. Under a
renderer, an out-of-band mutation like that is silently reverted by the next
diff, and can corrupt the diff's view of the tree.

A module-level `editingA2aServerId` replaces it. `startEditA2aServer` sets it and
re-renders; the renderer emits an edit form for that agent instead of a row.
`cancel-edit` and a successful `save-edit` clear it.

The original's guard — return early if that agent's row is not currently in the
document — is preserved, so calling it for an unlisted agent still does nothing.

A behavioral difference is accepted: previously any unrelated re-render discarded
an open edit form; now the form survives. Losing a half-typed form on an
unrelated update was not intentional behavior.

`saveEditA2aServer` reads its values through
`form.querySelector('.a2a-edit-name')` and friends. Those are real inputs in the
rendered output, so that function is untouched.

### D4: Health dots stay imperative

`checkA2aServerHealth` finds `.a2a-health-dot[data-health-for="<id>"]` and
mutates `className` and `title` directly, asynchronously, after render. That
stays as is.

This is safe because the renderer only runs when `renderA2aServers` is called,
which is exactly when the old code rebuilt `innerHTML` and destroyed the dots
anyway. A dot's health class surviving until the next explicit re-render matches
the previous behavior. Making health a rendered state value would mean lifting an
async functional path into the render layer.

The rendered dot carries no `class` beyond its base value and no `title` binding
that would fight the imperative update within a single render pass.

### D5: `escapeHtml` is retired from this path

Text and attribute values are escaped by the renderer. The helper is removed if
nothing else uses it, so it cannot be reintroduced by habit into a future string
template.

### D6: Labels resolve through `label()` at render time

The options page's `applyLanguage` runs the attribute-driven translation pass
over the document. That pass mutates `textContent` of `[data-i18n]` elements and
would fight the renderer.

The agent list already resolves its strings through the local `label()` helper
rather than `data-i18n` attributes, so this is preserved as is: the rendered
output resolves labels at render time and emits no `data-i18n` attributes into
the component-owned region. `applyLanguage` keeps working for the static form,
and the agent list picks up the new language on its next render.

### D7: Test migration is by category, not wholesale

Four unit tests touch the agent list:

- Two assert on the produced markup. These cannot survive a fake DOM and move to
  the browser suite.
- Two only call `renderA2aServers` to seed `a2aServers` before firing a synthetic
  click at a fabricated button. They do not read the markup. They seed the state
  through `normalizeA2aServers` instead, which is the same side effect the render
  call was being used for, and keep their persistence assertions as unit tests.

The browser tests are written and passing against the current implementation
before the implementation changes. That ordering is what proves fidelity rather
than merely asserting it.

### D8: Options bundle opts into the runtime

`build.mjs` gains `needsPreact: true` on the options entry. `dist/options.js`
grows by the runtime's size. `dist/background.js` and `dist/content.js` stay
byte-identical, which the existing test asserts.

`tests/unit/preact-build.test.js` currently hard-codes the flagged entry list and
asserts `dist/options.js` is runtime-free; both move.

## Risks / Trade-offs

- **The static form stays imperative.** The options page ends up mixed. Accepted:
  the dynamic, injection-prone region is the part that benefits, and the static
  form's coverage is worth more than its consistency.
- **Attribute-based dispatch instead of handlers.** Unidiomatic, but it is the
  price of not touching functional code.
- **Bundle growth.** The runtime is already vendored for two other pages; the
  options page is not size-sensitive.
