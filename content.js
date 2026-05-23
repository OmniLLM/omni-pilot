// OmniPilot - content script
// Detects text selection and shows AI action bubble

(function () {
  'use strict';

  let bubble = null;
  let dropdown = null;
  let panel = null;
  let lastSelection = '';
  let currentTheme = 'dark';

  // Apply theme to all OmniPilot elements
  function applyTheme(theme) {
    currentTheme = theme;
    const attr = theme === 'light' ? 'light' : null;
    [bubble, dropdown, panel].forEach(el => {
      if (!el) return;
      if (attr) el.setAttribute('data-op-theme', attr);
      else el.removeAttribute('data-op-theme');
    });
  }

  // Load theme from storage
  chrome.storage.sync.get({ theme: 'dark' }, cfg => applyTheme(cfg.theme));
  chrome.storage.onChanged.addListener(changes => {
    if (changes.theme) applyTheme(changes.theme.newValue);
  });

  const ACTIONS = [
    { id: 'translate', label: 'Translate', icon: '🌍' },
    { id: 'summarize', label: 'Summarize', icon: '📝' },
    { id: 'explain', label: 'Explain', icon: '💡' },
    { id: 'improve', label: 'Improve', icon: '✨' }
  ];

  // ── Bubble ──────────────────────────────────────────────────────────────────

  function createBubble() {
    const el = document.createElement('div');
    el.id = 'omnipilot-bubble';
    el.innerHTML = '<span class="omnipilot-icon">✦</span> OmniPilot';
    el.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleDropdown(el);
    });
    document.body.appendChild(el);
    return el;
  }

  function showBubble(rect) {
    if (!bubble) bubble = createBubble();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const x = rect.left + scrollX + rect.width / 2 - 55;
    const y = rect.top + scrollY - 44;
    bubble.style.left = `${Math.max(4, x)}px`;
    bubble.style.top = `${Math.max(4, y)}px`;
    bubble.style.display = 'flex';
  }

  function hideBubble() {
    if (bubble) bubble.style.display = 'none';
  }

  // ── Dropdown ─────────────────────────────────────────────────────────────────

  function toggleDropdown(anchorEl) {
    if (dropdown && dropdown.style.display !== 'none') {
      hideDropdown();
      return;
    }
    showDropdown(anchorEl);
  }

  function createDropdown() {
    const el = document.createElement('div');
    el.id = 'omnipilot-dropdown';
    ACTIONS.forEach(action => {
      const item = document.createElement('div');
      item.className = 'omnipilot-dropdown-item';
      item.innerHTML = `<span class="omnipilot-action-icon">${action.icon}</span>${action.label}`;
      item.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
      item.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        runAction(action.id);
      });
      el.appendChild(item);
    });
    document.body.appendChild(el);
    return el;
  }

  function showDropdown(anchorEl) {
    if (!dropdown) dropdown = createDropdown();
    const rect = anchorEl.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    dropdown.style.left = `${rect.left + scrollX}px`;
    dropdown.style.top = `${rect.bottom + scrollY + 6}px`;
    dropdown.style.display = 'block';
  }

  function hideDropdown() {
    if (dropdown) dropdown.style.display = 'none';
  }

  // ── Result Panel ─────────────────────────────────────────────────────────────

  function showPanel(content, isLoading = false, isError = false) {
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'omnipilot-panel';

      const header = document.createElement('div');
      header.className = 'omnipilot-panel-header';
      header.innerHTML = '<span class="omnipilot-panel-title">✦ OmniPilot</span>';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'omnipilot-close-btn';
      closeBtn.innerHTML = '✕';
      closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });
      header.appendChild(closeBtn);

      const body = document.createElement('div');
      body.className = 'omnipilot-panel-body';

      panel.appendChild(header);
      panel.appendChild(body);
      document.body.appendChild(panel);
    }

    const body = panel.querySelector('.omnipilot-panel-body');
    panel.style.display = 'block';

    if (isLoading) {
      body.innerHTML = '<div class="omnipilot-loading"><div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">Thinking…</span></div>';
    } else if (isError) {
      body.innerHTML = `<div class="omnipilot-error">⚠ ${escapeHtml(content)}</div>`;
    } else {
      body.innerHTML = `<div class="omnipilot-result">${formatResult(content)}</div>`;
    }

    // Position near bubble or viewport center
    positionPanel();
  }

  function positionPanel() {
    if (!panel) return;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    if (bubble && bubble.style.display !== 'none') {
      const bRect = bubble.getBoundingClientRect();
      panel.style.left = `${Math.min(bRect.left + scrollX, window.innerWidth - 450)}px`;
      panel.style.top = `${bRect.bottom + scrollY + 10}px`;
    } else {
      panel.style.left = `${Math.max(10, (window.innerWidth - 440) / 2)}px`;
      panel.style.top = `${scrollY + 80}px`;
    }
  }

  function formatResult(text) {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Action Runner ─────────────────────────────────────────────────────────────

  function runAction(actionId) {
    hideDropdown();
    hideBubble();

    const text = lastSelection;
    if (!text) return;

    showPanel('', true);

    chrome.runtime.sendMessage(
      { type: 'AI_ACTION', action: actionId, text },
      response => {
        if (chrome.runtime.lastError) {
          showPanel('Extension error: ' + chrome.runtime.lastError.message, false, true);
          return;
        }
        if (response.success) {
          showPanel(response.result);
        } else {
          showPanel(response.error || 'Unknown error', false, true);
        }
      }
    );
  }

  // ── Selection Detection ───────────────────────────────────────────────────────

  document.addEventListener('mouseup', e => {
    // Small delay to let selection finalize
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (text && text.length > 1) {
        lastSelection = text;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        showBubble(rect);
      } else {
        // Check if click was on our UI elements
        if (!isOmniPilotElement(e.target)) {
          hideBubble();
          hideDropdown();
          lastSelection = '';
        }
      }
    }, 10);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideBubble();
      hideDropdown();
      if (panel) panel.style.display = 'none';
    }
  });

  document.addEventListener('mousedown', e => {
    if (!isOmniPilotElement(e.target)) {
      hideDropdown();
    }
  });

  function isOmniPilotElement(el) {
    return el && (
      el.id?.startsWith('omnipilot-') ||
      el.closest?.('#omnipilot-bubble') ||
      el.closest?.('#omnipilot-dropdown') ||
      el.closest?.('#omnipilot-panel')
    );
  }

})();
