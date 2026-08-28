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
  ['neo-brutalist', 'visualStyleNeoBrutalist']
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
    ? html`<span class="dot ok op:w-1.5 op:h-1.5 op:shrink-0" id="statusDot"></span>`
    : html`<span class="dot op:w-1.5 op:h-1.5 op:shrink-0" id="statusDot"></span>`;
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
    visualStylePreference: 'current'
  });

  const controllerRef = useRef(null);
  const merge = patch => setState(previous => ({ ...previous, ...patch }));

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
        visualStylePreference: applied.visualStylePreference
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

  const onLanguageChange = value => {
    const languagePreference = normalizeLanguage(value);
    merge({ language: languagePreference });
    persist({ languagePreference });
  };

  const openSettings = () => {
    if (typeof chrome !== 'undefined') chrome.runtime?.openOptionsPage?.();
  };

  return html`
    <div class="op:flex op:items-center op:justify-between op:mb-3">
      <a
        class="header-left op:flex op:items-center op:gap-2 op:text-inherit op:no-underline"
        href="https://github.com/OmniLLM/omni-pilot"
        target="_blank"
        rel="noopener noreferrer"
        title="Open OmniPilot on GitHub"
      >
        <div class="op:w-6 op:h-6 op:bg-accent op:flex op:items-center op:justify-center op:text-xs op:text-on-accent">✦</div>
        <span class="title op:font-display op:text-md op:font-strong op:tracking-heading">OmniPilot</span>
      </a>
    </div>

    <div class="op:h-px op:bg-line op:mb-3"></div>

    <div class="op:text-sm op:text-ink-muted op:leading-body op:mb-3" id="desc" data-i18n="selectTextDesc">${t('selectTextDesc', language)}</div>

    <div class="op:flex op:items-center op:gap-2 op:text-sm op:text-ink-muted op:mb-3">
      <${StatusDot} ready=${ready} />
      <span id="statusText" aria-live="polite">${state.loaded ? t(statusKey, language) : 'Checking…'}</span>
    </div>

    <div
      class="theme-row appearance-controls op:flex op:items-center op:justify-between op:gap-3 op:py-2.5 op:px-3 op:bg-surface op:shadow-1"
      aria-labelledby="appearanceLabel"
    >
      <div class="theme-copy op:flex op:flex-col op:gap-0.5">
        <span class="theme-label op:text-sm op:font-strong op:text-ink" id="appearanceLabel" data-i18n="appearance">${t('appearance', language)}</span>
        <${PreferenceRow}
          id="themePreferenceSelect"
          labelKey="themePreference"
          value=${state.themePreference}
          options=${THEME_OPTIONS}
          language=${language}
          onChange=${onThemeChange}
        />
        <${PreferenceRow}
          id="visualStylePreferenceSelect"
          labelKey="visualStyle"
          value=${state.visualStylePreference}
          options=${VISUAL_STYLE_OPTIONS}
          language=${language}
          onChange=${onVisualStyleChange}
        />
      </div>
    </div>

    <div class="theme-row op:flex op:items-center op:justify-between op:gap-3 op:py-2.5 op:px-3 op:bg-surface op:shadow-1">
      <div class="theme-copy op:flex op:flex-col op:gap-0.5">
        <span class="theme-label op:text-sm op:font-strong op:text-ink" id="languageLabel" data-i18n="language">${t('language', language)}</span>
      </div>
      <select
        id="languageSelect"
        aria-label="Language"
        value=${language}
        onChange=${event => onLanguageChange(event.target.value)}
      >
        <option value="en">English</option>
        <option value="zh">中文</option>
      </select>
    </div>

    <button
      class="settings-btn op:flex op:items-center op:justify-center op:gap-1.5 op:w-full op:p-2 op:bg-surface op:text-ink op:text-sm op:font-medium op:font-body op:cursor-pointer"
      id="settingsBtn"
      onClick=${openSettings}
    >
      <span>⚙</span> <span id="settingsLabel" data-i18n="settings">${t('settings', language)}</span>
    </button>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  render(html`<${PopupApp} />`, document.getElementById('root'));
});
