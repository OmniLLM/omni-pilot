// OmniPilot Side Panel
(function () {
  'use strict';

  const body = document.getElementById('chatBody');
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const themeToggle = document.getElementById('themeToggle');
  const history = [];
  let currentTheme = 'light';
  // Surface an error if the stream port goes silent this long (worker suspended
  // or A2A delegation hung). Reset on every message so live streams aren't cut.
  const STREAM_WATCHDOG_MS = 90000;

  // Theme
  chrome.storage.sync.get({ themePreference: 'dark' }, cfg => {
    currentTheme = cfg.themePreference || 'dark';
    applyTheme();
  });

  function applyTheme() {
    document.body.setAttribute('data-theme', currentTheme);
    themeToggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
  }

  themeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    chrome.storage.sync.set({ themePreference: currentTheme });
    applyTheme();
  });

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  function clearEmpty() {
    const empty = body.querySelector('.sp-empty');
    if (empty) empty.remove();
  }

  function addUserMsg(text) {
    clearEmpty();
    const div = document.createElement('div');
    div.className = 'sp-msg sp-msg-user';
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function createStreamingMsg() {
    clearEmpty();
    const div = document.createElement('div');
    div.className = 'sp-msg sp-msg-assistant sp-streaming';
    div.textContent = '';
    body.appendChild(div);
    return div;
  }

  function addErrorMsg(text) {
    const div = document.createElement('div');
    div.className = 'sp-error';
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    addUserMsg(text);
    history.push({ role: 'user', content: text });

    const port = chrome.runtime.connect({ name: 'omnipilot-stream' });
    let accumulated = '';
    let msgDiv = null;
    let settled = false;

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
        if (!accumulated) addErrorMsg('No response. The assistant may have timed out — try again.');
        else if (msgDiv) { msgDiv.classList.remove('sp-streaming'); history.push({ role: 'assistant', content: accumulated }); }
        finish();
      }, STREAM_WATCHDOG_MS);
      // Never let the watchdog itself keep the process alive (no-op in browsers,
      // where timer handles are plain numbers).
      if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
    }

    port.onMessage.addListener(msg => {
      if (settled) return;
      armWatchdog();
      if (msg.type === 'chunk') {
        if (!msgDiv) msgDiv = createStreamingMsg();
        accumulated += msg.text;
        msgDiv.textContent = accumulated;
        body.scrollTop = body.scrollHeight;
      } else if (msg.type === 'status') {
        if (!msgDiv) msgDiv = createStreamingMsg();
        if (!accumulated) msgDiv.textContent = msg.status === 'delegating' ? 'Delegating…' : 'Working…';
      } else if (msg.type === 'error') {
        if (!accumulated) addErrorMsg(msg.error);
      } else if (msg.type === 'done') {
        if (msgDiv && accumulated) {
          msgDiv.classList.remove('sp-streaming');
          history.push({ role: 'assistant', content: accumulated });
        } else if (!accumulated) {
          if (msgDiv) { msgDiv.remove(); msgDiv = null; }
          if (!body.querySelector('.sp-error')) addErrorMsg('No response received.');
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
      if (msgDiv && accumulated) {
        msgDiv.classList.remove('sp-streaming');
        history.push({ role: 'assistant', content: accumulated });
      } else {
        if (msgDiv) { msgDiv.remove(); msgDiv = null; }
        if (!body.querySelector('.sp-error')) addErrorMsg('No response received.');
      }
    });

    port.postMessage({ type: 'AI_CHAT_STREAM', messages: history });
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
})();
