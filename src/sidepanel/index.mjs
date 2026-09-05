// OmniPilot Side Panel
//
// Rendered with Preact + htm. The runtime is inlined ahead of this file by
// build.mjs (see the `needsPreact` entry flag), so `htmPreact` is a plain
// global here — there is no bundler and no module loader involved.
//
// The transcript is state: an array of message records rendered as a pure
// function of that array. The stream protocol below is unchanged from the
// imperative version — port name, message types, watchdog timing, history
// ordering, and error strings are all preserved exactly.
import { createAppearanceController } from '../utils/appearance.mjs';
import { t, normalizeLanguage } from '../utils/i18n.mjs';
import { PROVIDER_LABELS, getProviderEntries, ACTIONS } from '../utils/catalog.mjs';
import { renderMarkdown } from '../utils/markdown.mjs';
import { createPromptHistory, createChatNavigation, createRequestActivity, updateRequestActivity, finishRequestActivity, renderRequestActivity } from '../utils/chat-ui.mjs';

const { html, render, useState, useEffect, useLayoutEffect, useRef } = htmPreact;

const PORT_NAME = 'omnipilot-stream';
const EMPTY_PROMPT = 'Start a conversation. Ask anything.';
const NO_RESPONSE_ERROR = 'No response received.';
const TIMEOUT_ERROR = 'No response. The assistant may have timed out — try again.';
const CONTEXT_LOST_ERROR = 'Extension context unavailable. Refresh the page.';
const INPUT_MAX_HEIGHT = 120;
const PAGE_CONTEXT_MAX_CHARS = 12000;
const NO_PAGE_FOR_ACTION_ERROR = "This page can't be read, so there is nothing to run that on.";
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_PROVIDER_TYPE = 'custom-provider';
const PANEL_TAB_ID = (() => {
  const value = new URLSearchParams(globalThis.location?.search || '').get('tabId');
  if (value === null || value === '') return null;
  const tabId = Number(value);
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
})();

// Chat is not one of ACTIONS — it is the absence of an action — but it heads
// the selector so the user can get back to plain conversation.
const CHAT_ACTION = { id: '', labelKey: 'chat', icon: '💬' };

function providerLabel(providerType) {
  return PROVIDER_LABELS[providerType] || PROVIDER_LABELS[DEFAULT_PROVIDER_TYPE];
}

/**
 * Reads the active tab's title, URL, and main text via the content script.
 * Resolves to null whenever the page cannot be read — restricted pages such as
 * chrome://, the Web Store, and PDF viewers have no content script.
 */
function fetchPageContext() {
  return new Promise(resolve => {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      resolve(null);
      return;
    }
    const readTab = tab => {
      if (!tab?.id) {
        resolve(null);
        return;
      }
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT' }, response => {
          if (chrome.runtime.lastError || !response?.success) {
            resolve(null);
            return;
          }
          resolve({
            tabId: tab.id,
            title: response.title || tab.title || '',
            url: response.url || tab.url || '',
            content: String(response.content || '').slice(0, PAGE_CONTEXT_MAX_CHARS)
          });
        });
      } catch {
        resolve(null);
      }
    };
    try {
      if (PANEL_TAB_ID !== null && chrome.tabs.get) {
        chrome.tabs.get(PANEL_TAB_ID, tab => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          readTab(tab);
        });
        return;
      }
      if (!chrome.tabs.query) {
        resolve(null);
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs && tabs[0];
        if (chrome.runtime.lastError || !tab?.id) {
          resolve(null);
          return;
        }
        readTab(tab);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Builds the system message that grounds the conversation in the page. */
function pageContextMessage(page) {
  return {
    role: 'system',
    content: [
      'The user is viewing the following web page. Use it as the primary context',
      'when answering. If the answer is not in the page, say so.',
      '',
      `Title: ${page.title}`,
      `URL: ${page.url}`,
      '',
      '--- PAGE CONTENT ---',
      page.content,
      '--- END PAGE CONTENT ---'
    ].join('\n')
  };
}

const STATUS_LABELS = {
  delegating: 'Delegating…',
  thinking: 'Thinking…'
};

function statusLabel(status) {
  return STATUS_LABELS[status] || 'Working…';
}

function isExtensionContextInvalidatedError(err) {
  const msg = err && (err.message || err.toString?.() || String(err));
  return typeof msg === 'string' && /extension context invalidated/i.test(msg);
}

function Message({ message }) {
  if (message.role === 'activity') {
    return html`<details class="op-activity">
      <summary><span class="op-activity-indicator" data-active=${!message.activity.ended} aria-hidden="true"></span><span>${message.activity.status}</span><small>Activity</small></summary>
      <div class="op-activity-body" dangerouslySetInnerHTML=${{ __html: renderRequestActivity(message.activity) }}></div>
    </details>`;
  }
  if (message.role === 'error') {
    return html`<div class="sp-error" role="alert" aria-atomic="true">${message.content}</div>`;
  }
  if (message.role === 'divider') {
    return html`<div class="sp-divider" role="separator" aria-label=${message.content}>
      <span>${message.content}</span>
    </div>`;
  }
  if (message.role === 'user') {
    return html`<article class="sp-msg sp-msg-user" aria-label="You">${message.content}</article>`;
  }
  // A request can sit briefly before the worker emits its first status or
  // token. Render that gap as an explicit state instead of an empty transcript.
  // The dots are decorative; the text and live region carry the same status
  // for assistive technology and reduced-motion users.
  if (message.thinking) {
    return html`<article class="sp-msg sp-msg-assistant sp-streaming sp-thinking" aria-label="OmniPilot is thinking" aria-busy="true">
      <span class="sp-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>${message.content || 'Thinking…'}</span>
    </article>`;
  }
  // Two literal class attributes rather than one interpolated string: Tailwind
  // tokenizes candidates on whitespace and would swallow a utility written
  // flush against an interpolation.
  //
  // Assistant replies are markdown. `renderMarkdown` escapes the model's text
  // before generating any markup, so nothing the model emits can inject HTML.
  const rendered = { __html: renderMarkdown(message.content) };
  return message.streaming
    ? html`<article class="sp-msg sp-msg-assistant sp-streaming" aria-label="OmniPilot" aria-busy="true" dangerouslySetInnerHTML=${rendered}></article>`
    : html`<article class="sp-msg sp-msg-assistant" aria-label="OmniPilot" dangerouslySetInnerHTML=${rendered}></article>`;
}

function PageContextChip({ page, enabled, onToggle }) {
  if (page === undefined) {
    return html`
      <div class="sp-context sp-context-empty" aria-busy="true">
        <span class="sp-context-icon" aria-hidden="true">◌</span>
        <span class="sp-context-copy">
          <span class="sp-context-kicker">Page context</span>
          <span class="sp-context-text">Checking this page…</span>
        </span>
      </div>`;
  }
  if (page === null) {
    return html`
      <div class="sp-context sp-context-empty" role="status">
        <span class="sp-context-icon" aria-hidden="true">⊘</span>
        <span class="sp-context-copy">
          <span class="sp-context-kicker">Page context</span>
          <span class="sp-context-text">This page can't be read</span>
        </span>
      </div>`;
  }
  return html`
    <label class="sp-context" title=${page.url}>
      <span class="sp-context-icon" aria-hidden="true">◫</span>
      <span class="sp-context-copy">
        <span class="sp-context-kicker">Use page context</span>
        <span class="sp-context-text">${page.title || page.url}</span>
      </span>
      <input class="sp-context-toggle" type="checkbox" checked=${enabled} onChange=${onToggle} />
      <span class="sp-context-switch" aria-hidden="true"></span>
    </label>`;
}

function SelectorItem({ icon, text, current, onChoose }) {
  const choose = event => {
    const trigger = event.currentTarget.closest('.sp-chip-wrap')?.querySelector('.sp-chip');
    onChoose();
    requestAnimationFrame(() => trigger?.focus());
  };
  return html`
    <button
      type="button"
      class=${'sp-selector-item' + (current ? ' sp-selector-current' : '')}
      role="option"
      aria-selected=${current ? 'true' : 'false'}
      tabIndex=${current ? 0 : -1}
      onClick=${choose}
    >
      ${icon ? html`<span class="sp-selector-icon" aria-hidden="true">${icon}</span>` : null}<span>${text}</span>
    </button>`;
}

/**
 * Fetches the model list when mounted, then filters it as the user types.
 * The list is state, so a keystroke re-renders rather than rebuilding markup.
 */
function ModelSelector({ current, onChoose }) {
  const [models, setModels] = useState(null);
  const [filter, setFilter] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const settle = list => {
      if (cancelled) return;
      setModels(list && list.length ? list : [current].filter(Boolean));
      inputRef.current?.focus();
    };
    try {
      chrome.runtime.sendMessage({ type: 'GET_MODELS' }, response => {
        // Reading lastError suppresses the "unchecked runtime.lastError" noise
        // when the service worker is gone.
        void chrome.runtime.lastError;
        settle(response?.models);
      });
    } catch {
      settle(null);
    }
    return () => { cancelled = true; };
  }, []);

  const query = filter.toLowerCase();
  const visible = models === null
    ? null
    : (query ? models.filter(model => model.toLowerCase().includes(query)) : models);

  return html`
    <input
      class="sp-selector-filter"
      placeholder="Type to filter…"
      aria-label="Filter models"
      ref=${inputRef}
      value=${filter}
      onInput=${event => setFilter(event.target.value)}
    />
    <div class="sp-selector-list" role="listbox" aria-label="Models">
      ${visible === null
        ? html`<div class="sp-selector-empty">Loading models…</div>`
        : visible.length
          ? visible.map(model => html`
              <${SelectorItem}
                key=${model}
                text=${model}
                current=${model === current}
                onChoose=${() => onChoose(model)}
              />`)
          : html`<div class="sp-selector-empty">No matches</div>`}
    </div>`;
}

/** A header chip plus the selector it opens, positioned beneath it. */
function Chip({ id, label: chipLabel, icon, open, onToggle, onClose, children }) {
  const popupRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    const initial = popup?.querySelector('.sp-selector-filter, [role="option"][aria-selected="true"], [role="option"]');
    initial?.focus();
  }, [open]);

  const onSelectorKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      document.getElementById(id)?.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll('[role="option"]')];
    if (!options.length) return;
    const current = options.indexOf(document.activeElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % options.length;
    if (event.key === 'ArrowUp') next = current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length;
    event.preventDefault();
    options[next].focus();
  };

  return html`
    <div class="sp-chip-wrap">
      <button
        type="button"
        class="sp-chip"
        id=${id}
        aria-haspopup="listbox"
        aria-expanded=${open ? 'true' : 'false'}
        aria-controls=${`${id}-selector`}
        onClick=${onToggle}
      >
        ${icon ? html`<span aria-hidden="true">${icon}</span>` : null}<span class="sp-chip-label">${chipLabel}</span><span class="sp-chip-caret" aria-hidden="true">▾</span>
      </button>
      ${open ? html`
        <div
          class="sp-selector"
          id=${`${id}-selector`}
          ref=${popupRef}
          onKeyDown=${onSelectorKeyDown}
        >${children}</div>` : null}
    </div>`;
}

function SidePanel() {
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState(undefined);
  const [usesPage, setUsesPage] = useState(true);
  const [language, setLanguage] = useState('en');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [providerType, setProviderType] = useState(DEFAULT_PROVIDER_TYPE);
  const [action, setAction] = useState('');
  const [openSelector, setOpenSelector] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [awayFromLatest, setAwayFromLatest] = useState(false);

  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const navigationRef = useRef(null);
  const promptsRef = useRef([]);
  const promptHistoryRef = useRef(null);
  if (!promptHistoryRef.current) promptHistoryRef.current = createPromptHistory(() => promptsRef.current);
  const historyRef = useRef([]);
  const watchdogMsRef = useRef(RESPONSE_TIMEOUT_DEFAULT_MS);
  const nextIdRef = useRef(0);
  const pageRef = useRef(null);
  const usesPageRef = useRef(true);
  const sentContextRef = useRef(false);

  const nextId = () => {
    nextIdRef.current += 1;
    return nextIdRef.current;
  };

  const append = message => setMessages(previous => [...previous, message]);

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage) return undefined;

    const controller = createAppearanceController({
      root: document.documentElement,
      surface: 'sidepanel',
      readPreferences(defaults, callback) {
        chrome.storage.sync.get(defaults, callback);
      },
      subscribeToChanges(listener) {
        const onChanged = chrome.storage?.onChanged;
        if (!onChanged?.addListener) return undefined;
        onChanged.addListener(listener);
        return () => onChanged.removeListener?.(listener);
      },
      matchMedia: typeof globalThis.matchMedia === 'function'
        ? globalThis.matchMedia.bind(globalThis)
        : undefined
    });

    window.addEventListener?.('unload', () => controller.dispose(), { once: true });

    chrome.storage.sync.get({ responseTimeoutMs: RESPONSE_TIMEOUT_DEFAULT_MS }, cfg => {
      watchdogMsRef.current = normalizeResponseTimeoutMs(cfg.responseTimeoutMs);
    });

    return undefined;
  }, []);

  // Mirror the session settings the header shows. Changes made from any other
  // surface (options page, floating panel) land here through the same listener,
  // so the chips never go stale.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.sync) return undefined;

    chrome.storage.sync.get(
      { model: DEFAULT_MODEL, providerType: DEFAULT_PROVIDER_TYPE, languagePreference: 'en' },
      cfg => {
        setModel(cfg.model || DEFAULT_MODEL);
        setProviderType(PROVIDER_LABELS[cfg.providerType] ? cfg.providerType : DEFAULT_PROVIDER_TYPE);
        setLanguage(normalizeLanguage(cfg.languagePreference));
      }
    );

    const onChanged = chrome.storage?.onChanged;
    if (!onChanged?.addListener) return undefined;
    const listener = changes => {
      if (changes.model) setModel(changes.model.newValue || DEFAULT_MODEL);
      if (changes.providerType) {
        const next = changes.providerType.newValue;
        setProviderType(PROVIDER_LABELS[next] ? next : DEFAULT_PROVIDER_TYPE);
      }
      if (changes.languagePreference) setLanguage(normalizeLanguage(changes.languagePreference.newValue));
    };
    onChanged.addListener(listener);
    return () => onChanged.removeListener?.(listener);
  }, []);

  // Dismiss an open selector on any click that is not on a chip or inside the
  // selector itself. Chips are excluded so their own click can toggle instead of
  // closing and immediately reopening.
  useEffect(() => {
    if (openSelector === null) return undefined;
    const onMouseDown = event => {
      const target = event.target;
      if (target?.closest?.('.sp-chip, .sp-selector')) return;
      setOpenSelector(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [openSelector]);

  useLayoutEffect(() => {
    navigationRef.current = createChatNavigation(bodyRef.current, setAwayFromLatest);
    return () => navigationRef.current?.dispose();
  }, []);

  // Follow new content only while the reader remains at the latest message.
  useLayoutEffect(() => {
    navigationRef.current?.refresh();
  }, [messages]);

  // Bind this panel to the tab that opened it. Other tab activations must not
  // replace its page context or conversation; only navigation in its own tab
  // refreshes the page snapshot.
  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      fetchPageContext().then(next => {
        if (cancelled) return;
        pageRef.current = next;
        setPage(next);
      });
    };

    refresh();

    const tabs = typeof chrome !== 'undefined' ? chrome.tabs : undefined;
    const onUpdated = (tabId, changeInfo) => {
      if (PANEL_TAB_ID !== null && tabId === PANEL_TAB_ID && changeInfo?.status === 'complete') refresh();
    };
    tabs?.onUpdated?.addListener?.(onUpdated);

    return () => {
      cancelled = true;
      tabs?.onUpdated?.removeListener?.(onUpdated);
    };
  }, []);

  function sendMessage() {
    const input = inputRef.current;
    const text = input.value.trim();
    if (!text) return;
    promptsRef.current.push(text);
    promptHistoryRef.current.reset();
    navigationRef.current?.latest();

    input.value = '';
    input.style.height = 'auto';

    // Ground the conversation in the page once, ahead of the first user turn.
    // Sent as history so the existing AI_CHAT_STREAM contract is unchanged.
    if (usesPageRef.current && pageRef.current?.content && !sentContextRef.current) {
      historyRef.current.push(pageContextMessage(pageRef.current));
      sentContextRef.current = true;
    }

    setAnnouncement('Message sent.');
    append({ id: nextId(), role: 'user', content: text });
    historyRef.current.push({ role: 'user', content: text });

    openStream({ type: 'AI_CHAT_STREAM', messages: historyRef.current });
  }

  /**
   * Opens the stream port, posts `payload`, and folds everything that comes
   * back into the transcript. Chat turns and built-in functions differ only in
   * the payload, so the port lifecycle — watchdog, disconnect handling, and
   * invalidated-context recovery — lives here once.
   */
  function openStream(payload) {
    // chrome.runtime.connect() throws synchronously with
    // "Extension context invalidated." after an extension reload while the
    // side panel is still open. Catch it and surface a friendly error.
    let port;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) {
        append({ id: nextId(), role: 'error', content: CONTEXT_LOST_ERROR });
        return;
      }
      throw err;
    }

    let accumulated = '';
    let streamId = nextId();
    let settled = false;
    const activityId = nextId();
    let activity = createRequestActivity();
    append({ id: activityId, role: 'activity', activity });
    const showActivity = event => {
      activity = updateRequestActivity(activity, event);
      setMessages(previous => previous.map(message => message.id === activityId ? { ...message, activity } : message));
      if (event?.type !== 'reasoning.summary') setAnnouncement(activity.status);
    };
    const endActivity = outcome => {
      activity = finishRequestActivity(activity, outcome);
      setMessages(previous => previous.map(message => message.id === activityId ? { ...message, activity } : message));
    };

    // Insert the pending row before posting to the port. This guarantees
    // immediate feedback even when the service worker is still waking up.
    // The same row becomes the streamed response once the first chunk arrives,
    // avoiding a visual jump or a second assistant message.
    append({ id: streamId, role: 'assistant', content: 'Thinking…', streaming: true, thinking: true });
    setAnnouncement('Thinking…');
    const updateStream = content => setMessages(previous =>
      previous.map(message => (message.id === streamId ? { ...message, content, thinking: false } : message))
    );
    const settleStream = (outcome = 'complete') => {
      setMessages(previous =>
        previous.map(message => (message.id === streamId ? { ...message, streaming: false } : message))
      );
      setAnnouncement(outcome === 'complete'
        ? (accumulated ? `Response complete. ${accumulated}` : 'Response complete.')
        : 'Response interrupted. Partial answer retained.');
    };
    // Drops any pending placeholder, then reports "no response" unless the
    // transcript already carries an error. The check spans the whole
    // transcript, matching the original body-wide `.sp-error` lookup.
    const reportNoResponse = () => {
      const pendingId = streamId;
      streamId = null;
      setMessages(previous => {
        const remaining = pendingId === null
          ? previous
          : previous.filter(message => message.id !== pendingId);
        if (remaining.some(message => message.role === 'error')) return remaining;
        return [...remaining, { id: nextId(), role: 'error', content: NO_RESPONSE_ERROR }];
      });
    };

    // Watchdog: the service worker can be suspended, or an A2A delegation can
    // hang, leaving the port silent with no 'done'. Without this the panel would
    // wait forever. Every message re-arms it, so healthy long responses are safe.
    let watchdog = null;
    function clearWatchdog() {
      if (watchdog !== null && typeof clearTimeout === 'function') clearTimeout(watchdog);
      watchdog = null;
    }
    function finish() {
      settled = true;
      clearWatchdog();
      try { port.disconnect(); } catch {}
    }
    function armWatchdog() {
      if (typeof setTimeout !== 'function') return;
      clearWatchdog();
      watchdog = setTimeout(() => {
        if (settled) return;
        endActivity('interrupted');
        if (!accumulated) {
          setMessages(previous => previous.filter(message => message.id !== streamId));
          append({ id: nextId(), role: 'error', content: TIMEOUT_ERROR });
        } else if (streamId !== null) {
          settleStream('interrupted');
          historyRef.current.push({ role: 'assistant', content: accumulated });
        }
        finish();
      }, watchdogMsRef.current);
      // Never let the watchdog itself keep the process alive (no-op in browsers,
      // where timer handles are plain numbers).
      if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
    }

    port.onMessage.addListener(msg => {
      if (settled) return;
      armWatchdog();
      if (msg.type === 'chunk') {
        if (!accumulated) showActivity({ type: 'response.streaming' });
        accumulated += msg.text;
        updateStream(accumulated);
      } else if (msg.type === 'activity') {
        showActivity(msg.activity);
      } else if (msg.type === 'status') {
        showActivity(msg);
        if (!accumulated) {
          const label = statusLabel(msg.status);
          setMessages(previous => previous.map(message => (
            message.id === streamId ? { ...message, content: label, thinking: true } : message
          )));
          setAnnouncement(label);
        }
      } else if (msg.type === 'error') {
        endActivity('error');
        if (!accumulated) {
          const pendingId = streamId;
          streamId = null;
          setMessages(previous => [
            ...previous.filter(message => message.id !== pendingId),
            { id: nextId(), role: 'error', content: msg.error }
          ]);
        } else {
          settleStream('error');
          historyRef.current.push({ role: 'assistant', content: accumulated });
          append({ id: nextId(), role: 'error', content: msg.error });
        }
        finish();
      } else if (msg.type === 'done') {
        endActivity(accumulated ? 'complete' : 'error');
        if (streamId !== null && accumulated) {
          settleStream();
          historyRef.current.push({ role: 'assistant', content: accumulated });
        } else if (!accumulated) {
          reportNoResponse();
        }
        finish();
      }
    });

    port.onDisconnect.addListener(() => {
      clearWatchdog();
      if (settled) return;
      settled = true;
      endActivity('interrupted');
      // Worker died before sending 'done'. Keep any partial text; otherwise show
      // an error rather than a half-rendered streaming bubble that never settles.
      if (streamId !== null && accumulated) {
        settleStream('interrupted');
        historyRef.current.push({ role: 'assistant', content: accumulated });
      } else {
        reportNoResponse();
      }
    });

    try {
      port.postMessage(payload);
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) {
        endActivity('error');
        clearWatchdog();
        try { port.disconnect(); } catch {}
        const pendingId = streamId;
        streamId = null;
        setMessages(previous => [
          ...previous.filter(message => message.id !== pendingId),
          { id: nextId(), role: 'error', content: CONTEXT_LOST_ERROR }
        ]);
        return;
      }
      throw err;
    }
  }

  const onInput = event => {
    promptHistoryRef.current.reset();
    const input = event.target;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, INPUT_MAX_HEIGHT) + 'px';
  };

  const onKeyDown = event => {
    if (promptHistoryRef.current.keydown(event)) return;
    navigationRef.current?.keydown(event);
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  };

  const onToggleContext = event => {
    const enabled = Boolean(event.target.checked);
    usesPageRef.current = enabled;
    setUsesPage(enabled);
  };

  const toggleSelector = name => setOpenSelector(previous => (previous === name ? null : name));

  const onChooseModel = nextModel => {
    setOpenSelector(null);
    if (nextModel === model) return;
    setModel(nextModel);
    try { chrome.runtime.sendMessage({ type: 'SET_MODEL', model: nextModel }); } catch {}
  };

  const onChooseProvider = nextProviderType => {
    setOpenSelector(null);
    if (nextProviderType === providerType) return;
    setProviderType(nextProviderType);
    try { chrome.runtime.sendMessage({ type: 'SET_PROVIDER', providerType: nextProviderType }); } catch {}
  };

  // Running a built-in function from the side panel treats the page as the
  // subject, the way the floating panel treats the selection as the subject.
  //
  // The page is re-read here rather than reusing the chip's snapshot. That
  // snapshot is taken when the panel opens and on tab changes, so on a page
  // that finishes rendering afterwards — a lesson body arriving after its
  // promo banner, say — running a function against it would summarize whatever
  // happened to be on screen first.
  const onChooseAction = async actionId => {
    setOpenSelector(null);
    setAction(actionId);
    if (!actionId) return;

    const fresh = await fetchPageContext();
    if (fresh) {
      pageRef.current = fresh;
      setPage(fresh);
    }
    const current = fresh?.content ? fresh : pageRef.current;
    if (!current?.content) {
      append({ id: nextId(), role: 'error', content: NO_PAGE_FOR_ACTION_ERROR });
      return;
    }

    const chosen = ACTIONS.find(entry => entry.id === actionId);
    const actionLabel = chosen ? `${chosen.icon} ${t(chosen.labelKey, language)}` : actionId;
    navigationRef.current?.latest();
    append({ id: nextId(), role: 'divider', content: actionLabel });

    // Keep the transcript's history coherent so follow-up chat continues from
    // the result rather than from an assistant turn with no antecedent.
    historyRef.current.push({
      role: 'user',
      content: `${actionLabel}: ${current.title || current.url}`
    });

    openStream({ type: 'AI_ACTION_STREAM', action: actionId, text: current.content });
  };

  // Code block cards carry a Copy button. Delegating from the transcript keeps
  // the rendered markup a pure function of the message text.
  const onBodyClick = event => {
    const button = event.target?.closest?.('.omnipilot-code-block-copy-btn');
    if (!button) return;
    const code = button.closest('.omnipilot-code-block-card')?.querySelector('.omnipilot-code-block-body');
    if (!code) return;
    navigator.clipboard?.writeText?.(code.textContent || '');
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = 'Copy'; }, 1500);
  };

  const actionEntry = ACTIONS.find(entry => entry.id === action) || CHAT_ACTION;

  return html`
    <main class="sp-shell">
      <header class="sp-header">
        <div class="sp-brand">
          <span class="sp-brand-mark" aria-hidden="true">✦</span>
          <div>
            <h1>OmniPilot</h1>
            <p>Page-aware assistant</p>
          </div>
        </div>
        <span class="sp-session-label">Workspace</span>
      </header>
      <section class="sp-toolbar" aria-label="Conversation settings">
        <div class="sp-meta">
          <${Chip}
            id="spActionChip"
            icon=${actionEntry.icon}
            label=${t(actionEntry.labelKey, language)}
            open=${openSelector === 'action'}
            onToggle=${() => toggleSelector('action')}
            onClose=${() => setOpenSelector(null)}
          >
            <div role="listbox" aria-label="Actions">
              ${[CHAT_ACTION, ...ACTIONS].map(entry => html`
                <${SelectorItem}
                  key=${entry.id || 'chat'}
                  icon=${entry.icon}
                  text=${t(entry.labelKey, language)}
                  current=${entry.id === action}
                  onChoose=${() => onChooseAction(entry.id)}
                />`)}
            </div>
          <//>
          <${Chip}
            id="spProviderChip"
            label=${providerLabel(providerType)}
            open=${openSelector === 'provider'}
            onToggle=${() => toggleSelector('provider')}
            onClose=${() => setOpenSelector(null)}
          >
            <div role="listbox" aria-label="Providers">
              ${getProviderEntries().map(entry => html`
                <${SelectorItem}
                  key=${entry.providerType}
                  text=${entry.label}
                  current=${entry.providerType === providerType}
                  onChoose=${() => onChooseProvider(entry.providerType)}
                />`)}
            </div>
          <//>
          <${Chip}
            id="spModelChip"
            label=${model}
            open=${openSelector === 'model'}
            onToggle=${() => toggleSelector('model')}
            onClose=${() => setOpenSelector(null)}
          >
            <${ModelSelector} current=${model} onChoose=${onChooseModel} />
          <//>
        </div>
        <${PageContextChip} page=${page} enabled=${usesPage} onToggle=${onToggleContext} />
      </section>
      <div class="sp-transcript">
      <section class="sp-body" id="chatBody" ref=${bodyRef} tabIndex="0" onKeyDown=${event => navigationRef.current?.keydown(event)} onClick=${onBodyClick} role="log" aria-label="Conversation" aria-describedby="spComposerHint" aria-relevant="additions" aria-busy=${messages.some(message => message.streaming) ? 'true' : 'false'}>
        ${messages.length === 0
          ? html`<div class="sp-empty">
              <span class="sp-empty-mark" aria-hidden="true">✦</span>
              <h2>Ready when you are</h2>
              <p>${EMPTY_PROMPT}</p>
              <div class="sp-starters">
                ${['Summarize this page', 'Explain the key ideas', 'Help me write something'].map(prompt => html`<button type="button" onClick=${() => { inputRef.current.value = prompt; inputRef.current.focus(); }}> ${prompt}<span aria-hidden="true">↗</span></button>`)}
              </div>
            </div>`
          : messages.map(message => html`<${Message} message=${message} key=${message.id} />`)}
      </section>
      ${awayFromLatest ? html`<button class="sp-latest" type="button" onClick=${() => navigationRef.current?.latest()}>↓ Latest message</button>` : null}
      </div>
      <div class="sp-sr-status" role="status" aria-live="polite" aria-atomic="true">${announcement}</div>
      <form class="sp-input-area" aria-label="Message composer" onSubmit=${event => { event.preventDefault(); sendMessage(); }}>
        <label class="sp-input-label" for="chatInput">Message</label>
        <div class="sp-composer">
          <textarea
            class="sp-input"
            id="chatInput"
            aria-describedby="spComposerHint"
            placeholder="Ask about this page…"
            rows="1"
            ref=${inputRef}
            onInput=${onInput}
            onKeyDown=${onKeyDown}
          ></textarea>
          <button class="sp-send" id="sendBtn" type="submit" aria-label="Send message">
            <span>Send</span><span class="sp-send-icon" aria-hidden="true">↑</span>
          </button>
        </div>
        <p class="sp-composer-hint" id="spComposerHint">Enter to send · Shift + Enter for a new line<br />↑ ↓ previous / next prompt · Alt + ↑ ↓ scroll chat</p>
      </form>
    </main>
  `;
}

render(html`<${SidePanel} />`, document.getElementById('root'));
