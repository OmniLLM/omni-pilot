# Chat UI/UX audit and modernization

Scope: side panel and floating chat, with shared appearance tokens reviewed for
cross-surface consistency. Existing popup and settings layouts retain their
appearance controls. Review combines source inspection and browser regression
tests; it is not a full WCAG certification or a manual screen-reader audit.

## Findings and changes

| Finding | Impact | Resolution |
| --- | --- | --- |
| Every streamed chunk forces the transcript to the bottom | High: interrupts reading earlier responses | Follow only while at the bottom; preserve scroll position and offer Latest message |
| Keyboard chat navigation and prompt reuse are missing | High: navigation depends on pointer scrolling and manual copying | Composer Up/Down recalls sent prompts; Alt+arrows scrolls chat; focused transcript accepts arrows, Page Up/Down, Home/End |
| Generic thinking indicator hides tool work | High: users cannot tell what a long request is doing | Per-request expandable activity timeline with real stages, tool names, running/completed/failed outcomes, and public provider reasoning summaries |
| Partial stream errors are suppressed in the side panel | High: incomplete answer appears successful | Preserve partial text, show error, settle busy state and activity |
| Composer focus relies on a subtle border | Moderate: keyboard focus is difficult to locate | Explicit two-pixel focus ring; transcript and new controls have visible focus |
| Narrow assistant bubbles waste reading space | Moderate: excess wrapping of prose and code | Assistant responses use available width; quieter surfaces and consistent activity typography |
| Empty state provides little guidance | Moderate: first action is unclear | Three editable starter prompts; keyboard help next to the composer |
| Base dark accent uses white text on light blue | Moderate: poor contrast before theme overrides | Base on-accent text uses dark ink, matching the established dark palette |
| Newly attached selection can hide its own Remove control in a short panel | Moderate: pointer removal becomes inaccessible | Preserve existing transcript nodes and reveal the new selection's Remove control |

Existing strengths preserved: shared semantic appearance tokens, selectable
corner styles, 44px primary targets, keyboard-operable selectors, escaped
Markdown, isolated floating-panel styles, and reduced-motion handling. The new
activity indicator is static and does not introduce motion.

## Interaction contract

- Up/Down in the composer recalls previous/next sent prompts without sending
  them. Down past the newest prompt restores the unsent draft. Selection context
  and generated action instructions are excluded from composer history.
- Up enters history from the first line of a draft; arrows within an edited
  multiline draft retain native cursor movement. While browsing history each
  arrow advances one prompt, including multiline prompts. Alt+Up/Down scrolls
  the transcript. Modified selection keys and IME composition retain native behavior.
- Scrolling up suspends automatic following. Latest message, reaching the end,
  or sending a new request resumes following.
- Request activity and reasoning details are collapsed by default. Clicking or
  keyboard-activating the summary expands or collapses them. Streaming and
  completion preserve the user's chosen expansion state.
  Provider reasoning summaries appear above the activity list; when no summary
  is supplied the panel says so. Stages show Running until a subsequent stage
  or terminal event settles them.
- Public Responses API reasoning summaries are displayed if supplied. Private
  thinking, encrypted reasoning, tool arguments, request headers, endpoint URLs,
  and raw trace payloads are not forwarded into activity. Summaries are bounded
  and escaped, and are not added to follow-up prompt history.
- Activity reflects reported events; it does not fabricate tool steps or
  reasoning for providers that do not expose them.
- The Tools section distinguishes available tools from tools actually called.
  It lists discovered names, agents, and skills, and each dispatched tool includes
  its agent/skill, elapsed time, response character count, and outcome. Explicit
  notices cover empty discovery, discovery failure, and disabled routing.
  Request metadata shows the provider, model, and context message count.
  Internal tools used by a remote agent remain unknown unless that agent reports
  them; the extension shows its own delegated call rather than inventing nested work.

## Accessibility validation

Keyboard and layout regressions cover both panels, including draft preservation,
scrolling during token updates, completion/failure states, escaped activity text,
44px controls, narrow viewports, selector focus, and live-region semantics.
Announcements describe stage changes rather than every token. Tool results use
text labels as well as color.

Selected token contrast calculations (WCAG sRGB relative luminance):

| Pair | Ratio | Normal-text threshold |
| --- | --- | --- |
| Base dark on-accent `#0b1020` / accent `#7c9cff` | 7.26:1 | Pass, 4.5:1 |
| Current light muted text `#555c68` / surface `#ffffff` | 6.74:1 | Pass, 4.5:1 |
| Current dark muted text `#b4b9c3` / surface `#17191d` | 8.94:1 | Pass, 4.5:1 |

The browser connection was unavailable for interactive visual review. Manual
NVDA/VoiceOver testing, 200% browser zoom, and visual review across every optional
theme remain outside the verified scope. Automated responsive/layout and existing
appearance contract tests provide the available coverage.
