# Tasks

## 1. Share the provider and action catalog

- [x] 1.1 Add `src/utils/catalog.mjs` holding `PROVIDER_LABELS`, `getProviderEntries`, and `ACTIONS`
- [x] 1.2 Inline it into the content and side panel bundles and teach `stripUtilityImports` about it
- [x] 1.3 Remove the now-duplicate definitions from the content script and import them instead
- [x] 1.4 Give the side panel bundle the translation table (`needsI18n`)

## 2. Build the side panel header controls

- [x] 2.1 Track model, provider type, and language in side panel state, seeded from storage
- [x] 2.2 Follow `storage.onChanged` so changes made elsewhere are reflected live
- [x] 2.3 Add a shared floating selector: opens below its chip, toggles, dismisses on outside click, only one open at a time
- [x] 2.4 Add the action chip, listing chat plus every built-in function
- [x] 2.5 Add the provider chip, writing `SET_PROVIDER`
- [x] 2.6 Add the model chip: `GET_MODELS`, filter box, no-matches state, writing `SET_MODEL`
- [x] 2.7 Style the header row and selectors from the appearance tokens

## 3. Run functions from the side panel

- [x] 3.1 Post `AI_ACTION_STREAM` over the existing stream port with the page content
- [x] 3.2 Show which function ran in the transcript and stream the result into it
- [x] 3.3 Push the result into conversation history so follow-up chat continues from it
- [x] 3.4 Report unreadable pages instead of issuing a request
- [x] 3.5 Reuse the existing watchdog, disconnect, and invalidated-context handling

## 4. Verify

- [x] 4.1 Write `tests/sidepanel-session-controls.spec.js` covering every scenario in the spec
- [x] 4.2 `npm run test:unit` passes
- [x] 4.3 Full browser suite passes
- [x] 4.4 `dist/background.js` remains byte-identical
- [x] 4.5 `openspec validate --strict` passes
