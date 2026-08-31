// OmniPilot Popup
//
// Rendered with Preact + htm. The runtime is inlined ahead of this file by
// build.mjs (see the `needsPreact` entry flag), so `htmPreact` is a plain
// global here — there is no bundler and no module loader involved.
import { DEFAULT_LANGUAGE, t, normalizeLanguage } from '../utils/i18n.mjs';
import { createAppearanceController } from '../utils/appearance.mjs';

const { html, render, useState, useEffect, useRef } = htmPreact;

const STORAGE_DEFAULTS = {
  languagePreference: DEFAULT_LANGUAGE,
  apiKey: '',
  providerType: 'custom-provider',
  authMethod: 'api-key'
};

const THEME_OPTIONS = [
  ['system', 'themeSystem'],
  ['light', 'light'],
  ['dark', 'dark']
];

const VISUAL_STYLE_OPTIONS = [
  ['current', 'visualStyleCurrent'],
  ['clean-minimal', 'visualStyleCleanMinimal'],
  ['terminal', 'visualStyleTerminal'],
  ['warm-editorial', 'visualStyleWarmEditorial'],
  ['neo-brutalist', 'visualStyleNeoBrutalist'],
  ['apple', 'visualStyleApple'],
  ['google', 'visualStyleGoogle'],
  ['meta', 'visualStyleMeta'],
  ['microsoft', 'visualStyleMicrosoft']
];

const UI_SHAPE_OPTIONS = [
  ['square', 'uiShapeSquare'],
  ['subtle', 'uiShapeSubtle'],
  ['rounded', 'uiShapeRounded'],
  ['pill', 'uiShapePill']
];

function isReady(config) {
  return config.providerType === 'github-copilot'
    || config.authMethod === 'github-copilot'
    || config.hasApiKey;
}

// Both class strings are written as static `class="..."` attributes on purpose.
// Tailwind tokenizes candidates on whitespace, so a utility written flush
// against a template interpolation gets swallowed into the candidate and is
// silently never emitted. Branching on two literal attributes keeps every
// utility statically discoverable.
function StatusDot({ ready }) {
  return ready
    ? html`<span class="dot ok op:w-1.5 op:h-1.5 op:shrink-0" id="statusDot" aria-hidden="true"></span>`
    : html`<span class="dot op:w-1.5 op:h-1.5 op:shrink-0" id="statusDot" aria-hidden="true"></span>`;
}

function PreferenceRow({ id, labelKey, value, options, language, onChange }) {
  return html`
    <div class="preference-row">
      <label class="op:text-xs op:text-ink-muted" for=${id} data-i18n=${labelKey}>${t(labelKey, language)}</label>
      <select id=${id} value=${value} onChange=${event => onChange(event.target.value)}>
        ${options.map(([optionValue, optionKey]) => html`
          <option value=${optionValue} data-i18n=${optionKey} key=${optionValue}>${t(optionKey, language)}</option>
        `)}
      </select>
    </div>
  `;
}

function PopupApp() {
  // `loaded` keeps the pre-storage render showing "Checking…", matching the
  // placeholder the static markup used to ship with.
  const [state, setState] = useState({
    loaded: false,
    language: DEFAULT_LANGUAGE,
    hasApiKey: false,
    providerType: STORAGE_DEFAULTS.providerType,
    authMethod: STORAGE_DEFAULTS.authMethod,
    themePreference: 'dark',
    visualStylePreference: 'current',
    uiShapePreference: 'subtle'
  });

  const controllerRef = useRef(null);
  const tabIdRef = useRef(null);
  const merge = patch => setState(previous => ({ ...previous, ...patch }));

  // Resolve the active tab up front so the side panel button can open
  // synchronously inside its click handler and keep the user gesture.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return undefined;
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tabId = tabs && tabs[0] && tabs[0].id;
        if (typeof tabId === 'number') tabIdRef.current = tabId;
      });
    } catch {}
    return undefined;
  }, []);

  // Everything touching chrome.* runs here, after the first commit, so the
  // markup exists even when the extension APIs are unavailable.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage) return undefined;

    const controller = createAppearanceController({
      root: document.documentElement,
      surface: 'popup',
      readPreferences: (defaults, callback) => chrome.storage.sync.get(defaults, callback),
      subscribeToChanges: listener => {
        if (!chrome.storage.onChanged?.addListener) return null;
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener?.(listener);
      },
      onApply: applied => merge({
        themePreference: applied.themePreference,
        visualStylePreference: applied.visualStylePreference,
        uiShapePreference: applied.uiShapePreference
      })
    });
    controllerRef.current = controller;

    chrome.storage.sync.get(STORAGE_DEFAULTS, config => {
      merge({
        loaded: true,
        language: normalizeLanguage(config.languagePreference),
        hasApiKey: Boolean(config.apiKey),
        providerType: config.providerType || STORAGE_DEFAULTS.providerType,
        authMethod: config.authMethod || STORAGE_DEFAULTS.authMethod
      });
    });

    const handleStorageChange = (changes, areaName) => {
      if (areaName && areaName !== 'sync') return;
      const patch = {};
      if (changes?.languagePreference) {
        patch.language = normalizeLanguage(changes.languagePreference.newValue);
      }
      if (changes?.apiKey) patch.hasApiKey = Boolean(changes.apiKey.newValue);
      if (changes?.providerType) {
        patch.providerType = changes.providerType.newValue || STORAGE_DEFAULTS.providerType;
      }
      if (changes?.authMethod) {
        patch.authMethod = changes.authMethod.newValue || STORAGE_DEFAULTS.authMethod;
      }
      if (Object.keys(patch).length) merge(patch);
    };
    chrome.storage.onChanged?.addListener?.(handleStorageChange);

    const dispose = () => {
      controller.dispose();
      chrome.storage.onChanged?.removeListener?.(handleStorageChange);
    };
    globalThis.addEventListener?.('unload', dispose, { once: true });
    return undefined;
  }, []);

  // The document language lives on a node Preact does not own.
  useEffect(() => {
    document.documentElement.lang = state.language;
  }, [state.language]);

  const language = state.language;
  const ready = isReady(state);
  const statusKey = ready ? 'ready' : 'apiKeyNotSet';

  const persist = values => {
    if (typeof chrome !== 'undefined' && chrome.storage) chrome.storage.sync.set(values);
  };

  const onThemeChange = themePreference => {
    merge({ themePreference });
    controllerRef.current?.update({ themePreference });
    persist({ themePreference });
  };

  const onVisualStyleChange = visualStylePreference => {
    merge({ visualStylePreference });
    controllerRef.current?.update({ visualStylePreference });
    persist({ visualStylePreference });
  };

  const onUiShapeChange = uiShapePreference => {
    merge({ uiShapePreference });
    controllerRef.current?.update({ uiShapePreference });
    persist({ uiShapePreference });
  };

  const onLanguageChange = value => {
    const languagePreference = normalizeLanguage(value);
    merge({ language: languagePreference });
    persist({ languagePreference });
  };

  const openSettings = () => {
    if (typeof chrome !== 'undefined') chrome.runtime?.openOptionsPage?.();
  };

  // Must be called synchronously from the click: chrome.sidePanel.open()
  // requires an active user gesture, which an async callback would lose. The
  // tab id is therefore resolved ahead of time, on mount.
  const openSidePanel = () => {
    if (typeof chrome === 'undefined' || !chrome.sidePanel?.open) return;
    const tabId = tabIdRef.current;
    try {
      const opened = tabId === null
        ? chrome.sidePanel.open({})
        : chrome.sidePanel.open({ tabId });
      opened?.then?.(() => window.close?.(), () => {});
    } catch {}
  };

  return html`
    <main class="popup-shell op:flex op:flex-col" aria-label="OmniPilot">
      <header class="topbar op:flex op:items-center op:justify-between op:gap-3">
        <a
          class="header-left op:flex op:items-center op:gap-2 op:text-inherit op:no-underline"
          href="https://github.com/OmniLLM/omni-pilot"
          target="_blank"
          rel="noopener noreferrer"
          title="Open OmniPilot on GitHub"
        >
          <span class="brand-mark op:flex op:items-center op:justify-center op:bg-accent op:text-on-accent" aria-hidden="true">✦</span>
          <span class="title op:font-display op:text-md op:font-strong op:tracking-heading">OmniPilot</span>
        </a>

        <div class="status op:flex op:items-center op:gap-2 op:text-xs op:text-ink-muted">
          <${StatusDot} ready=${ready} />
          <span id="statusText" aria-live="polite">${state.loaded ? t(statusKey, language) : 'Checking…'}</span>
        </div>
      </header>

      <section class="launcher op:flex op:flex-col op:gap-2" aria-labelledby="sidePanelLabel">
        <button
          type="button"
          class="primary-action op:flex op:items-center op:justify-center op:gap-2 op:w-full op:bg-accent op:text-on-accent op:text-sm op:font-strong op:font-body op:cursor-pointer"
          id="sidePanelBtn"
          onClick=${openSidePanel}
        >
          <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5.75h14v10.5H9.5L5 19.5V5.75Z"></path>
            <path d="M8.5 9.25h7M8.5 12.5h4.5"></path>
          </svg>
          <span id="sidePanelLabel">Ask about this page</span>
          <svg class="action-arrow" viewBox="0 0 20 20" aria-hidden="true">
            <path d="m7 4 6 6-6 6"></path>
          </svg>
        </button>
        <p class="op:text-sm op:text-ink-muted op:leading-body" id="desc" data-i18n="selectTextDesc">${t('selectTextDesc', language)}</p>
      </section>

      <section class="preferences op:flex op:flex-col" aria-labelledby="appearanceLabel">
        <div class="section-heading op:flex op:items-center op:justify-between op:gap-3">
          <h2 class="op:text-xs op:font-strong op:text-ink-muted" id="appearanceLabel" data-i18n="appearance">${t('appearance', language)}</h2>
        </div>

        <div class="preference-list op:flex op:flex-col">
          <${PreferenceRow}
            id="themePreferenceSelect"
            labelKey="themePreference"
            value=${state.themePreference}
            options=${THEME_OPTIONS}
            language=${language}
            onChange=${onThemeChange}
          />
          <${PreferenceRow}
            id="uiShapePreferenceSelect"
            labelKey="uiShape"
            value=${state.uiShapePreference}
            options=${UI_SHAPE_OPTIONS}
            language=${language}
            onChange=${onUiShapeChange}
          />
          <${PreferenceRow}
            id="visualStylePreferenceSelect"
            labelKey="visualStyle"
            value=${state.visualStylePreference}
            options=${VISUAL_STYLE_OPTIONS}
            language=${language}
            onChange=${onVisualStyleChange}
          />
          <div class="preference-row">
            <label class="op:text-xs op:text-ink-muted" for="languageSelect" id="languageLabel" data-i18n="language">${t('language', language)}</label>
            <select
              id="languageSelect"
              value=${language}
              onChange=${event => onLanguageChange(event.target.value)}
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </div>
        </div>
      </section>

      <button
        type="button"
        class="settings-btn op:flex op:items-center op:justify-center op:gap-2 op:w-full op:text-ink-muted op:text-sm op:font-medium op:font-body op:cursor-pointer"
        id="settingsBtn"
        onClick=${openSettings}
      >
        <svg class="settings-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"></path>
          <path d="M19 13.2v-2.4l-2-.6a7.7 7.7 0 0 0-.7-1.6l1-1.9-1.7-1.7-1.9 1a7.7 7.7 0 0 0-1.6-.7L11.5 3H9.1l-.6 2.1a7.7 7.7 0 0 0-1.6.7L5 4.8 3.3 6.5l1 1.9a7.7 7.7 0 0 0-.7 1.6l-2 .6V13l2 .6c.2.6.4 1.1.7 1.6l-1 1.9L5 18.8l1.9-1c.5.3 1 .5 1.6.7l.6 2.1h2.4l.6-2.1c.6-.2 1.1-.4 1.6-.7l1.9 1 1.7-1.7-1-1.9c.3-.5.5-1 .7-1.6l2-.4Z"></path>
        </svg>
        <span id="settingsLabel" data-i18n="settings">${t('settings', language)}</span>
      </button>
    </main>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  render(html`<${PopupApp} />`, document.getElementById('root'));
});
