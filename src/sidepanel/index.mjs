// OmniPilot Side Panel
(function () {
  'use strict';

  const body = document.getElementById('chatBody');
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const themeToggle = document.getElementById('themeToggle');
  const history = [];
  let currentTheme = 'light';

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

    port.onMessage.addListener(msg => {
      if (msg.type === 'chunk') {
        if (!msgDiv) msgDiv = createStreamingMsg();
        accumulated += msg.text;
        msgDiv.textContent = accumulated;
        body.scrollTop = body.scrollHeight;
      } else if (msg.type === 'error') {
        if (!accumulated) addErrorMsg(msg.error);
      } else if (msg.type === 'done') {
        if (msgDiv) {
          msgDiv.classList.remove('sp-streaming');
          history.push({ role: 'assistant', content: accumulated });
        } else if (!accumulated) {
          addErrorMsg('No response received.');
        }
        try { port.disconnect(); } catch {}
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
