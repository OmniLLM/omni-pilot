# Tasks

## 1. Extraction

- [x] 1.1 Add a boilerplate selector list and block-tag set
- [x] 1.2 Add `collectText()` walking the live tree, skipping boilerplate and the extension's own UI
- [x] 1.3 Rank candidates in tiers, resolving articles among themselves by text length
- [x] 1.4 Raise the acceptance threshold, keeping the richest candidate as a fallback

## 2. Freshness

- [x] 2.1 Re-read the page when a function is chosen in the side panel

## 3. Verification

- [x] 3.1 Add a browser spec covering promo articles, article ranking, boilerplate, structure and short pages
- [x] 3.2 Confirm the new spec fails against the previous implementation
- [x] 3.3 Run the unit suites, the full browser suite, spec validation and the packer
