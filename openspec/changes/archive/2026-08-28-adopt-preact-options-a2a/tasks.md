# Tasks

## 1. Baseline and safety net

- [x] 1.1 Record `dist/*` SHA-256 hashes and confirm `npm run test:unit` and the browser suite are green
- [x] 1.2 Write browser coverage for the agent list against the **unmodified** options page: name and endpoint rendered, token never rendered, enable/disable controls and disabled state class, skill summary and expandable skill panel, inline edit form open/cancel/save, health indicator present per agent
- [x] 1.3 Add a browser test asserting markup inside agent metadata is rendered as literal text and creates no elements
- [x] 1.4 Confirm the new browser tests pass before any source change

## 2. Build integration

- [x] 2.1 Set `needsPreact: true` on the options entry in `build.mjs`
- [x] 2.2 Update `tests/unit/preact-build.test.js`: add options to the flagged list, move `dist/options.js` out of the runtime-free set
- [x] 2.3 Rebuild and confirm `dist/background.js` and `dist/content.js` are byte-identical to baseline

## 3. Convert the agent list

- [x] 3.1 Add components for an agent row, its action controls, its skill panel, and the inline edit form
- [x] 3.2 Replace the `innerHTML` assignment in `renderA2aServers` with a render call into `#a2aServerList`, preserving normalization, the `a2aServers` assignment, and the health-check fan-out
- [x] 3.3 Replace `startEditA2aServer`'s `outerHTML` splice with an `editingA2aServerId` state value and a re-render, keeping its early-return guard
- [x] 3.4 Clear the editing state on `cancel-edit` and on successful `save-edit`
- [x] 3.5 Remove `escapeHtml` if it has no remaining callers
- [x] 3.6 Verify every `data-action`, `data-server-id`, `data-skill-id`, and `data-skill-toggle` attribute is still emitted

## 4. Migrate the unit tests

- [x] 4.1 Replace `renderA2aServers` fixture-seeding calls with direct state seeding through `normalizeA2aServers`, keeping their persistence assertions
- [x] 4.2 Remove the two unit tests that assert on the produced markup, now covered in the browser
- [x] 4.3 Confirm the remaining options unit assertions still pass

## 5. Verify

- [x] 5.1 `npm run test:unit` green
- [x] 5.2 Full browser suite green, including the popup visual parity pins
- [x] 5.3 `dist/background.js` and `dist/content.js` byte-identical to baseline
- [x] 5.4 `node pack.mjs` succeeds with an unchanged entry list
- [x] 5.5 Load the options page headless and confirm zero console errors
- [x] 5.6 `openspec validate --strict`
