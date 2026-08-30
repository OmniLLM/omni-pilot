## Why

The floating content-script panel and the side panel render the same conversation, but only the side panel is announced correctly. A UX/accessibility audit of the shipped surfaces found three defects, all confined to `src/content-script/index.mjs`, and all of them already solved correctly elsewhere in this codebase. These are consistency bugs, not design opinions.

**1. The alert status path is dead code.**

`#omnipilot-panel-status` is created with a hard-coded `aria-live="polite"` alongside `role="status"`. `updatePanelStatus(message, kind)` then tries to escalate urgency by swapping the element's `role` to `alert`:

```js
status.setAttribute('role', kind === 'alert' ? 'alert' : 'status');
status.textContent = message || '';
```

An explicit `aria-live` attribute overrides the implicit politeness of the element's role, so `role="alert"` never becomes assertive. The single caller that passes `'alert'` — the stream error path — is announced exactly like the routine `Assistant ready` message. Separately, mutating the `role` of a live region in the same task that changes its text is unreliable across screen readers, which register live regions by their resolved role at insertion time; the two writes can race and produce either a missed announcement or a duplicate one.

The side panel gets this right: errors render as a dedicated `role="alert" aria-atomic="true"` element, and the routine status lives in a separate, permanently polite `role="status"` region.

**2. The floating panel never exposes a busy state while streaming.**

`createStreamingAssistantMessage()` marks the in-flight message with the class `omnipilot-streaming`, and `finalizeStreamingMessage()` removes it. That class is styling only — nothing in the accessibility tree says a response is still arriving, so assistive technology presents a half-streamed answer as if it were complete.

The side panel exposes `aria-busy="true"` on the streaming article and mirrors it onto the `role="log"` transcript. The floating panel has an equivalent `role="log"` transcript and an equivalent streaming message element, and sets neither.

**3. Decorative brand glyphs are announced as content.**

The `✦` brand mark and the `U` avatar initial are purely ornamental. The popup, options page, and side panel all mark them `aria-hidden="true"`. Not one of the ten occurrences in the content script does. Because the message-header avatars sit inside a `role="log"` region with `aria-relevant="additions"`, every single conversation turn is announced with a leading `black four-pointed star` or `U` before the speaker name.

## What Changes

- **Stop mutating `role` on the panel status region.** `role="status"` becomes permanent, and `updatePanelStatus` escalates urgency through `aria-live` (`assertive` for `alert`, `polite` otherwise) — the attribute that actually governs politeness. This makes the existing `content-selectors.spec.js` assertion that the region is `role="status"` true unconditionally, rather than true only because the alert path was never exercised in a test.
- **Expose `aria-busy` on the floating panel while streaming.** The streaming message element carries `aria-busy="true"` from creation and is set to `"false"` on finalize, alongside the existing class toggle, matching the side panel.
- **Mark every decorative glyph in the content script `aria-hidden="true"`** — the bubble icon, minimized orb icon, onboarding icon, panel heading mark, and the `✦` / `U` message-header avatars in all four places they are produced (live assistant message, live user message, streaming message, and the persisted A2A transcript markup).

## Non-goals

Deliberately left untouched:

- **All functional logic in `src/content-script/index.mjs`.** Streaming ports, provider routing, session persistence, and A2A delegation are not opened. This change scopes only presentation attributes on already-rendered elements, as hard constraint 6 requires a change to do explicitly.
- **`src/background/index.mjs`.** Not opened.
- **The side panel, popup, and options page.** They are the reference implementation this change conforms the content script to, not the thing being changed.
- **The visible glyphs themselves.** `✦` and `U` remain on screen and keep their classes and styling. Only their exposure to the accessibility tree changes.
- **`src/content-script/styles.css`.** No styling change; `omnipilot-streaming` keeps its exact current styling role, and the byte-equality of the inlined content CSS is unaffected.
- **The `role="log"` transcript structure.** `aria-relevant="additions"` and the existing landmark roles are correct and are carried forward unchanged.
- **Rewriting the status region into separate polite and assertive regions.** The side panel splits them; the floating panel keeps one region and switches its politeness. Two competing live regions in a small floating panel is the anti-pattern the audit guidance warns against.

## Hard-constraint compliance

| # | Constraint | How this change complies |
|---|---|---|
| 1 | No IIFE / module-scoped output; unit tests read top-level declarations via `vm.runInContext` | `build.mjs` is not modified, and no top-level declaration is added, removed, or renamed. Only statement bodies inside existing functions change. |
| 2 | Content script UI lives in an open Shadow DOM; hit-test with `composedPath()` | No listener, no hit-test, and no event path logic is touched. The change adds only ARIA attributes to elements that are already created and already mounted in the shadow root. |
| 3 | MV3 CSP — no remote assets, no `eval`, no runtime JIT | No asset, dependency, or build step is added. |
| 4 | `square-corners.test.js` radius policy | No CSS is authored or modified, so no `border-radius` declaration changes. |
| 5 | `policy-compliance.test.js` — version sync, no `tabs` permission, pinned `pack.mjs` ENTRIES | No version, permission, or packaging entry changes. |
| 6 | Functional logic in `content-script/index.mjs` and `background/index.mjs` is frozen unless a change explicitly scopes it | **This change explicitly scopes `src/content-script/index.mjs`, and only its accessibility attributes.** No control flow, no network path, no persistence path, and no message contract is altered. `background/index.mjs` is not opened. |

## Capabilities

### New Capabilities

- `floating-panel-accessibility`: how the floating content-script panel is exposed to assistive technology — the single status live region and its politeness escalation, the busy state during streaming, and the exclusion of decorative brand glyphs from the accessibility tree.

## Impact

**Code**
- `src/content-script/index.mjs` — `updatePanelStatus` politeness handling; `aria-busy` on the streaming message; `aria-hidden` on ten decorative glyphs.

**Specs**
- `openspec/specs/floating-panel-accessibility/spec.md` — new.

**Tests**
- `tests/content-a11y.spec.js` — new Playwright spec covering all three behaviors in a real browser against the shipped `dist/content.js`.

**Risk**
- Low. ARIA attributes have no effect on layout, styling, event handling, or serialized session state beyond the attributes themselves. The existing `content-selectors.spec.js` assertion on `role="status"` continues to hold and becomes stronger.
