## 1. Status live region

- [x] 1.1 Remove the `role` reassignment from `updatePanelStatus` in `src/content-script/index.mjs`; keep `role="status"` permanent.
- [x] 1.2 Set `aria-live` to `assertive` for `kind === 'alert'` and `polite` otherwise, before writing the message text.
- [x] 1.3 Confirm the creation site still sets `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.

## 2. Streaming busy state

- [x] 2.1 Set `aria-busy="true"` on the message element in `createStreamingAssistantMessage`.
- [x] 2.2 Set `aria-busy="false"` in `finalizeStreamingMessage`, alongside removing the `omnipilot-streaming` class.

## 3. Decorative glyphs

- [x] 3.1 Add `aria-hidden="true"` to the `✦` avatar in `createAssistantMessage` and `createStreamingAssistantMessage`.
- [x] 3.2 Add `aria-hidden="true"` to the `U` avatar in `createUserMessage`.
- [x] 3.3 Add `aria-hidden="true"` to both avatars in the persisted A2A transcript markup.
- [x] 3.4 Add `aria-hidden="true"` to the selection bubble icon, minimized orb icon, and onboarding icon.
- [x] 3.5 Wrap the `✦` in the panel heading in an `aria-hidden="true"` span, at both the creation site and in `updatePanelTitle`.

## 4. Verification

- [x] 4.1 Add `tests/content-a11y.spec.js` covering the status politeness escalation, the streaming busy state, and glyph `aria-hidden`.
- [x] 4.2 Run `npm run test:unit` — all tests pass, including the new file.
- [x] 4.3 Run the content-script Playwright specs (`content-selectors`, `panel-selection`) — all pass.
- [x] 4.4 Run `npx openspec validate --all --strict`.
- [x] 4.5 Archive the change.
