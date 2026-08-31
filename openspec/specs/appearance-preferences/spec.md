# appearance-preferences Specification

## Purpose

Governs what a user may choose about how OmniPilot looks, and how that choice reaches every surface.

This capability owns the three appearance preferences — color theme, visual style, and component shape — together with their enumerations, defaults, normalization, persistence in `chrome.storage.sync`, live propagation to the popup, options page, side panel, and content script, and the `--appearance-*` design-token contract that each combination resolves to.

Boundary: this capability *defines* the tokens; it does not decide how any stylesheet consumes them. How CSS is compiled, namespaced, layered, and confined to particular surfaces belongs to `extension-page-styling`, which is a downstream consumer of the tokens defined here.

## Requirements
### Requirement: Three independent appearance preferences

The extension SHALL expose exactly three appearance preferences, each independently selectable and each with a fixed enumeration and default:

| Preference | Storage key | Values | Default |
|---|---|---|---|
| Color theme | `themePreference` | `system`, `light`, `dark` | `dark` |
| Visual style | `visualStylePreference` | `current`, `clean-minimal`, `terminal`, `warm-editorial`, `neo-brutalist`, `apple`, `google`, `meta`, `microsoft` | `current` |
| Component shape | `uiShapePreference` | `square`, `subtle`, `rounded`, `pill` | `subtle` |

The three are orthogonal: any combination SHALL be valid, giving 3 x 9 x 4 renderable appearances.

The `current` visual style is presented to the user as "Modern". That is display copy only; the stored value, the enumeration member, and the `data-visual-style="current"` selector SHALL remain `current`.

#### Scenario: Enumerations are fixed

- **WHEN** the appearance module's exported enumerations are inspected
- **THEN** `THEME_PREFERENCES` is `['system', 'light', 'dark']`, `VISUAL_STYLE_PREFERENCES` is `['current', 'clean-minimal', 'terminal', 'warm-editorial', 'neo-brutalist', 'apple', 'google', 'meta', 'microsoft']`, and `UI_SHAPE_PREFERENCES` is `['square', 'subtle', 'rounded', 'pill']`

#### Scenario: Defaults are supplied to storage reads

- **WHEN** a surface reads its stored preferences
- **THEN** it passes defaults of `dark`, `current`, and `subtle`, so a profile that has never chosen an appearance renders those values

#### Scenario: Preferences are independent

- **WHEN** one preference is changed
- **THEN** the other two keep their current values, and no combination of the three is rejected

### Requirement: Unrecognized preference values fall back to the default

Every preference value SHALL be normalized before it is applied. A value that is absent, `null`, malformed, or not a member of its enumeration SHALL resolve to that preference's default rather than being written to the DOM.

This keeps a corrupted or out-of-date synced profile — for example one written by an older version that offered different values — from rendering an unstyled surface.

#### Scenario: An invalid value normalizes to the default

- **WHEN** a preference is normalized from a value outside its enumeration
- **THEN** the result is `dark` for the color theme, `current` for the visual style, and `subtle` for the component shape

#### Scenario: A valid value is preserved

- **WHEN** a preference is normalized from a member of its enumeration
- **THEN** that member is returned unchanged

#### Scenario: A corrupt stored profile still renders

- **WHEN** storage returns `themePreference: 'bad'` and `visualStylePreference: null`
- **THEN** the appearance root resolves to `data-theme-preference="dark"`, `data-theme="dark"`, `data-visual-style="current"`, and `data-ui-shape="subtle"`

### Requirement: Preferences are projected onto the appearance root as data attributes

Resolved preferences SHALL be published to the DOM by setting attributes on a single appearance root element per surface, which is the only interface the stylesheets consume. The root SHALL carry `data-appearance-root`, a `data-surface` identifying the surface, `data-theme-preference` (the raw preference), `data-theme` (the resolved concrete theme), `data-visual-style`, and `data-ui-shape`. Its `color-scheme` SHALL be set to the resolved theme so native form controls and scrollbars match.

#### Scenario: The root carries the full attribute set

- **WHEN** a surface's appearance controller applies a state
- **THEN** its root element carries `data-appearance-root`, `data-surface`, `data-theme-preference`, `data-theme`, `data-visual-style`, and `data-ui-shape`, and its inline `color-scheme` equals the resolved theme

#### Scenario: Styling reads only the root attributes

- **WHEN** `src/styles/appearance.css` is inspected
- **THEN** every theme, visual style, and shape variant is selected by a `data-theme`, `data-visual-style`, or `data-ui-shape` attribute on an appearance root, a content-script root, or an options-page preview element

#### Scenario: Attributes update in place

- **WHEN** a preference changes
- **THEN** the corresponding attribute is rewritten on the existing root element, with no remount and no rebuild

### Requirement: The system theme preference follows the operating system

When the color theme is `system`, the resolved theme SHALL be derived from the `prefers-color-scheme: dark` media query, and the surface SHALL track later changes to it for as long as the preference remains `system`. Selecting an explicit `light` or `dark` theme SHALL stop that tracking.

#### Scenario: System resolves against the media query

- **WHEN** the color theme is `system`
- **THEN** `data-theme` is `dark` if `prefers-color-scheme: dark` matches and `light` otherwise, while `data-theme-preference` stays `system`

#### Scenario: An operating-system change is followed live

- **WHEN** the preference is `system` and the media query changes
- **THEN** `data-theme` is updated to the new resolved theme without a reload

#### Scenario: Choosing an explicit theme stops tracking

- **WHEN** the preference changes from `system` to `light` or `dark`
- **THEN** the media-query listener is removed, and later operating-system changes no longer affect the surface

#### Scenario: Disposal releases listeners

- **WHEN** a surface's appearance controller is disposed
- **THEN** its media-query listener and its storage subscription are both removed

### Requirement: Preferences persist in synced storage and propagate to every surface live

Preferences SHALL be stored in `chrome.storage.sync` so they follow the user's profile across devices. Every surface SHALL subscribe to storage changes and re-apply its appearance immediately, so a preference changed on one surface takes effect on all open surfaces without a reload. Changes reported for any storage area other than `sync` SHALL be ignored.

#### Scenario: A change on one surface reaches the others

- **WHEN** a preference is written from the popup or the options page
- **THEN** every other open surface applies the new value without being reloaded

#### Scenario: Non-sync storage areas are ignored

- **WHEN** a preference-shaped change is reported for the `local` storage area
- **THEN** no surface changes its appearance

#### Scenario: A late initial read never overwrites a newer change

- **WHEN** a storage change is applied while the initial read is still in flight, and that read then returns an older value for the same preference
- **THEN** the newer value is kept, while preferences the change did not mention still take their value from the read

### Requirement: Only the popup and options surfaces write preferences

The popup and the options page SHALL be the only surfaces that write appearance preferences. The side panel and the content script SHALL be read-only consumers: they apply stored preferences and follow changes, but SHALL NOT write any preference back.

This keeps a single, auditable set of writers, so a rendering surface cannot silently pin a value for the whole profile.

#### Scenario: Editing surfaces persist the choice

- **WHEN** the user changes the theme, visual style, or component shape from the popup or the options page
- **THEN** the new value is applied immediately to that surface and written to `chrome.storage.sync`

#### Scenario: The side panel never writes

- **WHEN** the side panel is opened, used, and closed
- **THEN** it performs no write of `themePreference`, `visualStylePreference`, or `uiShapePreference`

#### Scenario: The content script follows without writing

- **WHEN** the content script mounts its UI and a preference later changes
- **THEN** its shadow-root UI re-renders with the new appearance, and it writes no preference

### Requirement: Component shape selects a radius scale

The component shape preference SHALL select the values of a four-token radius scale — `--appearance-radius-xs`, `--appearance-radius-sm`, `--appearance-radius-md`, and `--appearance-radius-pill` — which is the single source of corner geometry for every surface:

| Shape | `xs` | `sm` | `md` | `pill` |
|---|---|---|---|---|
| `square` | `0` | `0` | `0` | `0` |
| `subtle` | `2px` | `4px` | `6px` | `8px` |
| `rounded` | `4px` | `8px` | `12px` | `16px` |
| `pill` | `6px` | `12px` | `18px` | `9999px` |

`square` is the base scale, so a surface that has resolved no shape yet renders square corners rather than an unstyled fallback.

#### Scenario: Every shape defines the full scale

- **WHEN** `src/styles/appearance.css` is inspected
- **THEN** the `subtle`, `rounded`, and `pill` shapes each have a `data-ui-shape` block, and all four radius tokens are declared

#### Scenario: Authored stylesheets consume the tokens

- **WHEN** `src/styles/popup.css`, `src/styles/options.css`, `src/styles/sidepanel.css`, and `src/content-script/styles.css` are inspected
- **THEN** each sets `border-radius` through a `var(--appearance-radius-*)` reference, and none hard-codes `border-radius: 0`

#### Scenario: Changing the shape restyles every surface

- **WHEN** the component shape preference changes
- **THEN** controls, cards, menus, and messages on every open surface adopt the new corner sizes immediately, with no rebuild

#### Scenario: The options page previews shapes in place

- **WHEN** the component shape is changed on the options page
- **THEN** the page's appearance preview elements adopt the selected shape alongside the rest of the surface

### Requirement: Every visual style defines a complete token palette in both themes

Each of the nine visual styles SHALL define a complete palette for both the `light` and `dark` themes, so no combination of theme and visual style can leave a token unresolved. The palette SHALL cover surface, text, border, accent, state, feedback, typographic, spacing, sizing, elevation, and motion tokens.

The stylesheet SHALL additionally honor `prefers-reduced-motion: reduce` and `forced-colors: active`, so the appearance system degrades correctly for users who need reduced motion or a forced color palette.

#### Scenario: All eighteen style-and-theme combinations are defined

- **WHEN** `src/styles/appearance.css` is inspected
- **THEN** each of the nine visual styles declares a palette for `data-theme="light"` and for `data-theme="dark"`

#### Scenario: The token contract is complete

- **WHEN** the declared `--appearance-*` tokens are inspected
- **THEN** the contract includes at least `canvas`, `surface`, `surface-raised`, `text`, `text-muted`, `text-subtle`, `border`, `border-strong`, `accent`, `accent-hover`, `on-accent`, `focus`, `success`, `danger`, `warning`, `font-body`, `card-padding`, `border-width`, `control-height`, `icon-button-size`, `panel-padding`, `composer-padding`, `selected-surface`, `focus-ring-width`, `disabled-opacity`, `shadow-1`, and `transition-duration`

#### Scenario: Accessibility media queries are honored

- **WHEN** `src/styles/appearance.css` is inspected
- **THEN** it declares a `prefers-reduced-motion: reduce` block and a `forced-colors: active` block

#### Scenario: The content script's appearance is scoped to its shadow root

- **WHEN** the appearance CSS inlined into the content script bundle is inspected
- **THEN** its selectors are scoped to the content script's own root element, so the host page's elements are never matched

