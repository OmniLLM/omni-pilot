# Design

## Context

The content script owns exactly one UI mount point. `ensureOmniPilotRoot()` creates `#omnipilot-extension-root-7f3a9c` and is the sole `document.body.appendChild` in the file; every other UI element is appended beneath it via the `getUiMount()` accessor and held in closure variables. Crucially, the file contains only five `document.querySelector*` calls, and all five target *host page* content for extraction (`article`, `.js-issue-title`, `.timeline-comment-group`) — none of them look up our own UI.

That is what makes this change small. If UI elements were re-found by global selector, moving the tree behind a shadow boundary would break every one of those lookups. They aren't, so it doesn't.

## Goals / Non-Goals

**Goals**
- The host page cannot style our UI, including via `!important`.
- Our stylesheet never enters a host document.
- Every existing content-script behavioural test passes **unmodified**, apart from harness setup that simulated the manifest's CSS injection.

**Non-Goals**
- Applying Preact or Tailwind to the content script.
- Changing any content-script behaviour, markup, or CSS rule.
- Closed shadow mode (see D3).

## Decisions

### D1 — Separate host element rather than attaching the shadow root to the existing root

`attachShadow` is called on a **new** wrapper `#omnipilot-extension-host-7f3a9c`, and `#omnipilot-extension-root-7f3a9c` is moved inside it.

The tempting alternative — calling `attachShadow` directly on the existing root — fails, because a shadow host's own children are no longer rendered once a shadow root is attached. The root element also carries `data-appearance-root` / `data-surface="content"` / `data-theme` attributes that the entire stylesheet is scoped under, and the appearance controller writes to those attributes through a retained element reference. Keeping the root element intact and merely relocating it means the stylesheet's scoping selectors and the appearance controller both keep working with zero changes.

### D2 — Inline the CSS into the bundle rather than linking a web-accessible resource

Two options existed for getting CSS inside the shadow root:

| | `<link rel="stylesheet">` to a web-accessible resource | Inlined `<style>` (chosen) |
|---|---|---|
| Manifest | needs `web_accessible_resources` | no change |
| Timing | asynchronous — the panel paints unstyled first | synchronous — no flash |
| Exposure | the stylesheet URL is fetchable/detectable by the host page | nothing observable |
| Cost | `content.js` unchanged | `content.js` +52 KB |

The flash of unstyled content is disqualifying on its own: the bubble appears on `mouseup` directly under the user's cursor, so an unstyled frame is guaranteed to be seen. The 52 KB is not new payload — it is `dist/styles.css` relocated, and that file is deleted in the same change; the packaged zip grows by 0.5 KB of JSON escaping, which `node pack.mjs` confirms.

Adding `web_accessible_resources` would also have widened the extension's fingerprinting surface for no benefit.

### D3 — Open shadow mode, not closed

`mode: 'open'` is deliberate.

Closed mode offers effectively no security benefit here: the content script and the host page share a JavaScript realm, so a determined host page can already patch `Element.prototype.attachShadow` before we run. It buys nothing real, while costing a great deal in practice — Playwright's CSS locators pierce open shadow roots automatically but cannot see into closed ones. With `open`, all 137 existing tests continue to use plain `page.locator('#omnipilot-bubble')`. With `closed`, every content-script assertion would need rewriting through a custom handle, and the behavioural oracle for this change would be destroyed by the change itself.

### D4 — Keep the stylesheet's existing scoping selectors

Every rule stays scoped under `#omnipilot-extension-root-7f3a9c[data-surface="content"]` and `#omnipilot-*` ids, exactly as before, even though a shadow root makes that redundant.

Rewriting the selectors to `:host`-relative form would be a large, untested diff through 52 KB of CSS whose only benefit is aesthetic. It would also make the build's three regex transforms of `appearance.css` obsolete and force them to be rewritten. Leaving the selectors alone keeps the inlined string **byte-identical** to the `dist/styles.css` this change deletes — which is exactly what the updated unit assertion checks, so the CSS is provably unchanged rather than merely believed to be.

### D5 — Guard `attachShadow` availability

The mount falls back to appending directly to the host element if `attachShadow` is not a function. The content script is injected into arbitrary pages, including ones that may have tampered with DOM prototypes; degrading to today's behaviour is strictly better than throwing and losing the UI entirely. This mirrors the file's existing defensive idiom (`if (typeof document?.querySelector !== 'function') return;`).

### D6 — Reset the host element reference alongside the root

`ensureOmniPilotRoot` re-creates the tree when the root is disconnected (this is what makes the extension survive SPA navigations that wipe `document.body`). That teardown path now removes `omniPilotHost` and nulls **both** references. Nulling only the root would orphan the old host element in the DOM, leaking one empty `<div>` per navigation.

### D7 — Re-point the leak assertions rather than delete them

`tests/unit/tailwind-build.test.js` asserted two properties of `dist/styles.css`: that it contains no `.op\:` utility selector, and that it is byte-equal to the transformed appearance CSS plus the hand-written content CSS. That file no longer exists, but both guarantees still matter — arguably more, since the stylesheet now ships inside a 173 KB JS bundle where a stray utility would be far harder to spot by eye.

The test now parses `OMNIPILOT_CONTENT_CSS` back out of `dist/content.js` via `JSON.parse` and asserts the same two properties against it. Two assertions are added: that no `content_scripts` entry declares `css`, and that `dist/styles.css` is no longer emitted. The second guards against a half-reverted build script silently resurrecting the injection.

## Risks / Trade-offs

- **[`position: fixed` could resolve against a different containing block inside a shadow root]** → It does not; shadow roots do not create a containing block absent a transformed ancestor. Verified behaviourally: `panel-persistence.spec.js` and `panel-selection.spec.js` assert panel placement and pass unmodified.
- **[The appearance controller writes to attributes on the relocated root]** → It holds a direct element reference rather than re-querying, so relocation is transparent. Covered by the existing appearance tests.
- **[`dist/content.js` becomes large enough to slow injection]** → It is parsed once per document at `document_idle`; a 52 KB string literal is trivial to parse and was previously parsed as CSS on the same documents anyway.
- **[Host pages could still reach in via `::part` or by walking the open shadow root]** → True, and accepted. This change addresses accidental style collision, which is the actual observed failure mode; it is not a security boundary, and D3 explains why a closed root would not make it one.

## Migration Plan

Single atomic change; no user-visible behaviour differs and no stored data is touched. A user updating the extension gets the new `content.js` and a manifest with no `content_scripts.css`; Chrome stops injecting the old stylesheet on the next page load.

## Open Questions

None.
