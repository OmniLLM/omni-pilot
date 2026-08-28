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

const { html, render, useState, useEffect, useRef } = htmPreact;

const PORT_NAME = 'omnipilot-stream';
const EMPTY_PROMPT = 'Start a conversation. Ask anything.';
const NO_RESPONSE_ERROR = 'No response received.';
const TIMEOUT_ERROR = 'No response. The assistant may have timed out — try again.';
const CONTEXT_LOST_ERROR = 'Extension context unavailable. Refresh the page.';
const INPUT_MAX_HEIGHT = 120;

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
  if (message.role === 'error') {
    return html`<div class="sp-error">${message.content}</div>`;
  }
  if (message.role === 'user') {
    return html`<div class="sp-msg sp-msg-user">${message.content}</div>`;
  }
  // Two literal class attributes rather than one interpolated string: Tailwind
  // tokenizes candidates on whitespace and would swallow a utility written
  // flush against an interpolation.
  return message.streaming
    ? html`<div class="sp-msg sp-msg-assistant sp-streaming">${message.content}</div>`
    : html`<div class="sp-msg sp-msg-assistant">${message.content}</div>`;
}

function SidePanel() {
  const [messages, setMessages] = useState([]);

  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const historyRef = useRef([]);
  const watchdogMsRef = useRef(RESPONSE_TIMEOUT_DEFAULT_MS);
  const nextIdRef = useRef(0);

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

  // Keep the newest content in view as the transcript grows.
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [messages]);

  function sendMessage() {
    const input = inputRef.current;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    append({ id: nextId(), role: 'user', content: text });
    historyRef.current.push({ role: 'user', content: text });

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
    let streamId = null;
    let settled = false;

    const startStream = () => {
      streamId = nextId();
      append({ id: streamId, role: 'assistant', content: '', streaming: true });
    };
    const updateStream = content => setMessages(previous =>
      previous.map(message => (message.id === streamId ? { ...message, content } : message))
    );
    const settleStream = () => setMessages(previous =>
      previous.map(message => (message.id === streamId ? { ...message, streaming: false } : message))
    );
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
        if (!accumulated) {
          append({ id: nextId(), role: 'error', content: TIMEOUT_ERROR });
        } else if (streamId !== null) {
          settleStream();
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
        if (streamId === null) startStream();
        accumulated += msg.text;
        updateStream(accumulated);
      } else if (msg.type === 'status') {
        if (streamId === null) startStream();
        if (!accumulated) updateStream(statusLabel(msg.status));
      } else if (msg.type === 'error') {
        if (!accumulated) append({ id: nextId(), role: 'error', content: msg.error });
      } else if (msg.type === 'done') {
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
      // Worker died before sending 'done'. Keep any partial text; otherwise show
      // an error rather than a half-rendered streaming bubble that never settles.
      if (streamId !== null && accumulated) {
        settleStream();
        historyRef.current.push({ role: 'assistant', content: accumulated });
      } else {
        reportNoResponse();
      }
    });

    try {
      port.postMessage({ type: 'AI_CHAT_STREAM', messages: historyRef.current });
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) {
        clearWatchdog();
        try { port.disconnect(); } catch {}
        append({ id: nextId(), role: 'error', content: CONTEXT_LOST_ERROR });
        return;
      }
      throw err;
    }
  }

  const onInput = event => {
    const input = event.target;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, INPUT_MAX_HEIGHT) + 'px';
  };

  const onKeyDown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return html`
    <div class="sp-header">
      <span aria-hidden="true">✦</span>
      <h1>OmniPilot</h1>
    </div>
    <div class="sp-body" id="chatBody" ref=${bodyRef}>
      ${messages.length === 0
        ? html`<div class="sp-empty">${EMPTY_PROMPT}</div>`
        : messages.map(message => html`<${Message} message=${message} key=${message.id} />`)}
    </div>
    <div class="sp-input-area">
      <textarea
        class="sp-input"
        id="chatInput"
        placeholder="Ask anything..."
        rows="1"
        ref=${inputRef}
        onInput=${onInput}
        onKeyDown=${onKeyDown}
      ></textarea>
      <button class="sp-send" id="sendBtn" onClick=${sendMessage}>Send</button>
    </div>
  `;
}

render(html`<${SidePanel} />`, document.getElementById('root'));
