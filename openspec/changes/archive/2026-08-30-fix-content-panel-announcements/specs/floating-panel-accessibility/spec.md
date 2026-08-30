# floating-panel-accessibility Delta

## ADDED Requirements

### Requirement: The floating panel exposes exactly one status live region

The floating content-script panel SHALL expose exactly one live region for transient status, `#omnipilot-panel-status`, and that element SHALL keep `role="status"` and `aria-atomic="true"` for its entire lifetime. Its `role` SHALL NOT be reassigned after creation.

Urgency SHALL be expressed through `aria-live`, which is the attribute that governs politeness when it is present: `assertive` when the status is reported as an alert, `polite` otherwise. The politeness SHALL be applied before the new message text is written, so that a single announcement is made at the intended urgency.

The transcript region SHALL NOT be a competing live region; it remains a `role="log"` with `aria-relevant="additions"`.

#### Scenario: The status region keeps a stable role

- **WHEN** the floating panel is opened and any number of status updates are applied, including alerts
- **THEN** `#omnipilot-panel-status` still reports `role="status"` and `aria-atomic="true"`

#### Scenario: A routine status is announced politely

- **WHEN** a routine status such as the ready or in-progress message is applied
- **THEN** `#omnipilot-panel-status` carries `aria-live="polite"` and its text is the supplied message

#### Scenario: An error status is announced assertively

- **WHEN** a status is applied as an alert, such as the stream error path
- **THEN** `#omnipilot-panel-status` carries `aria-live="assertive"`, still reports `role="status"`, and its text is the supplied message

### Requirement: The floating panel exposes a busy state while streaming

An assistant message that is still streaming in the floating panel SHALL carry `aria-busy="true"`, and SHALL be set to `aria-busy="false"` when the stream is finalized. The busy state SHALL be applied and cleared together with the `omnipilot-streaming` class, so that the accessibility tree and the styling never disagree about whether a response is still arriving.

This matches the side panel, which exposes `aria-busy` on its streaming assistant message.

#### Scenario: A streaming message reports busy

- **WHEN** the first chunk of a streamed response creates the assistant message element
- **THEN** that element carries both the `omnipilot-streaming` class and `aria-busy="true"`

#### Scenario: A finalized message reports not busy

- **WHEN** the stream is finalized and the message is re-rendered as formatted markdown
- **THEN** the `omnipilot-streaming` class is removed and the element carries `aria-busy="false"`

### Requirement: Decorative brand glyphs are excluded from the accessibility tree

Every purely decorative glyph rendered by the content script SHALL carry `aria-hidden="true"` on its own element, so that it is not announced as content. This covers the `✦` brand mark wherever it appears — the selection bubble icon, the minimized orb icon, the onboarding icon, the panel heading, and the assistant message-header avatar — and the `U` initial in the user message-header avatar.

A decorative glyph SHALL NOT be the only content of an element that carries meaning; each such glyph sits beside a real text label or an element that already has an accessible name.

Because the transcript is a `role="log"` with `aria-relevant="additions"`, this requirement applies to every code path that produces a message header, including live rendering and the serialized markup used for session persistence.

#### Scenario: Message avatars are not announced

- **WHEN** a user turn and an assistant turn are appended to the floating transcript, by any code path including the persisted A2A transcript markup
- **THEN** each `.omnipilot-msg-header-avatar` element carries `aria-hidden="true"`, and the speaker name beside it remains readable text

#### Scenario: Chrome glyphs are not announced

- **WHEN** the selection bubble, the minimized orb, the onboarding card, or the panel heading is rendered
- **THEN** the decorative glyph in each carries `aria-hidden="true"`, and each control still resolves an accessible name from its label text or `aria-label`
