// OmniPilot - content script
// Detects text selection and shows AI action bubble

(function () {
  'use strict';

  let bubble = null;
  let dropdown = null;
  let panel = null;
  let lastSelection = '';
  let lastSelectionRect = null;
  let currentTheme = 'dark';
  let conversationHistory = []; // stores {role, content} for multi-turn chat

  function applyThemeTo(el) {
    if (!el) return;
    if (currentTheme === 'light') el.setAttribute('data-op-theme', 'light');
    else el.removeAttribute('data-op-theme');
  }

  function applyTheme(theme) {
    currentTheme = theme;
    [bubble, dropdown, panel].forEach(applyThemeTo);
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
    applyThemeTo(el);
    return el;
  }

  function showBubble(rect) {
    if (!bubble) bubble = createBubble();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    lastSelectionRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
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
    applyThemeTo(el);
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

  function calcInitialPanelSize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Rectangular: wider than tall
    const w = Math.max(420, Math.min(640, Math.round(vw * 0.4)));
    const h = Math.max(220, Math.min(400, Math.round(vh * 0.32)));
    return { w, h };
  }

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
      closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        conversationHistory = [];
      });
      header.appendChild(closeBtn);

      // Drag support on header
      let dragging = false;
      let dragOffsetX = 0;
      let dragOffsetY = 0;

      header.addEventListener('mousedown', e => {
        if (e.target === closeBtn) return;
        dragging = true;
        const rect = panel.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        panel.style.transition = 'none';
        e.preventDefault();
      });

      document.addEventListener('mousemove', e => {
        if (!dragging) return;
        const left = e.clientX - dragOffsetX;
        const top = e.clientY - dragOffsetY;
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
      });

      document.addEventListener('mouseup', () => {
        if (dragging) {
          panel.dataset.dragged = '1';
        }
        dragging = false;
        panel.style.transition = '';
      });

      // Resize handle (custom, more reliable than CSS resize)
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'omnipilot-resize-handle';
      let resizing = false;
      let resizeStartX, resizeStartY, resizeStartW, resizeStartH;

      resizeHandle.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        resizing = true;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeStartW = panel.offsetWidth;
        resizeStartH = panel.offsetHeight;
        panel.style.transition = 'none';
      });

      document.addEventListener('mousemove', e => {
        if (!resizing) return;
        const newW = Math.max(280, resizeStartW + (e.clientX - resizeStartX));
        const newH = Math.max(160, resizeStartH + (e.clientY - resizeStartY));
        panel.style.width = `${newW}px`;
        panel.style.height = `${newH}px`;
      });

      document.addEventListener('mouseup', () => {
        if (resizing) {
          resizing = false;
          panel.style.transition = '';
          panel.dataset.userResized = '1';
        }
      });

      const body = document.createElement('div');
      body.className = 'omnipilot-panel-body';

      const inputArea = document.createElement('div');
      inputArea.className = 'omnipilot-panel-input-area';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'omnipilot-panel-input';
      input.placeholder = 'Ask a follow-up question...';
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && input.value.trim()) {
          e.stopPropagation();
          sendFollowUp(input.value.trim());
          input.value = '';
        }
        if (e.key === 'Escape') e.stopPropagation();
      });
      input.addEventListener('mousedown', e => e.stopPropagation());
      const sendBtn = document.createElement('button');
      sendBtn.className = 'omnipilot-send-btn';
      sendBtn.textContent = '→';
      sendBtn.addEventListener('click', () => {
        if (input.value.trim()) {
          sendFollowUp(input.value.trim());
          input.value = '';
        }
      });
      inputArea.appendChild(input);
      inputArea.appendChild(sendBtn);

      panel.appendChild(header);
      panel.appendChild(body);
      panel.appendChild(inputArea);
      panel.appendChild(resizeHandle);
      document.body.appendChild(panel);
      applyThemeTo(panel);
    }

    const body = panel.querySelector('.omnipilot-panel-body');
    panel.style.display = 'flex';

    if (isLoading) {
      body.innerHTML = '<div class="omnipilot-loading"><div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">Thinking…</span></div>';
    } else if (isError) {
      body.innerHTML = `<div class="omnipilot-error">${escapeHtml(content)}</div>`;
    } else {
      body.innerHTML = `<div class="omnipilot-result">${formatResult(content)}</div>`;
    }

    // Only position on first show (not after drag)
    if (!panel.dataset.dragged) {
      positionPanel();
    }
  }

  function sendFollowUp(question) {
    conversationHistory.push({ role: 'user', content: question });

    // Append user message to panel body
    const body = panel.querySelector('.omnipilot-panel-body');
    body.innerHTML += `<div class="omnipilot-msg omnipilot-msg-user">${escapeHtml(question)}</div>`;
    body.innerHTML += '<div class="omnipilot-loading"><div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">Thinking…</span></div>';
    body.scrollTop = body.scrollHeight;

    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      body.querySelector('.omnipilot-loading')?.remove();
      body.innerHTML += '<div class="omnipilot-error">Extension context unavailable. Refresh page.</div>';
      return;
    }

    runtime.sendMessage(
      { type: 'AI_CHAT', messages: conversationHistory },
      response => {
        // Remove loading indicator
        body.querySelector('.omnipilot-loading')?.remove();
        if (runtime.lastError) {
          body.innerHTML += `<div class="omnipilot-error">${escapeHtml(runtime.lastError.message)}</div>`;
          return;
        }
        if (!response || !response.success) {
          body.innerHTML += `<div class="omnipilot-error">${escapeHtml(response?.error || 'Unknown error')}</div>`;
          return;
        }
        conversationHistory.push({ role: 'assistant', content: response.result });
        body.innerHTML += `<div class="omnipilot-msg omnipilot-msg-assistant">${formatResult(response.result)}</div>`;
        body.scrollTop = body.scrollHeight;
      }
    );
  }

  function showPanelForConversation(selectedText) {
    // Show panel immediately with selected text displayed and input ready
    if (!panel) {
      showPanel('', false, false); // creates the panel
    } else {
      panel.style.display = 'flex';
    }
    const body = panel.querySelector('.omnipilot-panel-body');
    // Show the selected text as context
    const truncated = selectedText.length > 200 ? selectedText.slice(0, 200) + '…' : selectedText;
    body.innerHTML = `<div class="omnipilot-selected-context"><span class="omnipilot-context-label">Selected text:</span> ${escapeHtml(truncated)}</div>`;

    // Only position when opening fresh (not dragged)
    if (!panel.dataset.dragged) {
      positionPanel();
    }

    // Focus the input
    const input = panel.querySelector('.omnipilot-panel-input');
    if (input) setTimeout(() => input.focus(), 50);
  }

  function positionPanel() {
    if (!panel) return;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const { w: panelW, h: panelH } = calcInitialPanelSize();

    // Set initial size (only if not already resized by user)
    if (!panel.dataset.userResized) {
      panel.style.width = `${panelW}px`;
      panel.style.height = `${panelH}px`;
    }

    const actualW = panel.offsetWidth || panelW;
    const actualH = panel.offsetHeight || panelH;
    const gap = 12;
    const margin = 16;

    if (lastSelectionRect) {
      // Try right side of selection first
      let left = lastSelectionRect.right + scrollX + gap;
      let top = lastSelectionRect.top + scrollY;

      // If right side overflows, try left side
      if (left + actualW > window.innerWidth + scrollX - margin) {
        left = lastSelectionRect.left + scrollX - actualW - gap;
      }

      // Clamp to viewport
      left = Math.max(scrollX + margin, Math.min(left, window.innerWidth + scrollX - actualW - margin));
      top = Math.max(scrollY + margin, Math.min(top, window.innerHeight + scrollY - actualH - margin));

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    } else if (bubble && bubble.style.display !== 'none') {
      const bRect = bubble.getBoundingClientRect();
      panel.style.left = `${Math.min(bRect.left + scrollX, window.innerWidth + scrollX - actualW - margin)}px`;
      panel.style.top = `${bRect.bottom + scrollY + gap}px`;
    } else {
      panel.style.left = `${Math.max(scrollX + margin, (window.innerWidth - actualW) / 2 + scrollX)}px`;
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

    // Initialize conversation with the selected text context
    conversationHistory = [{ role: 'user', content: text }];

    // Show panel immediately with loading state
    showPanelForConversation(text);
    const body = panel.querySelector('.omnipilot-panel-body');
    body.innerHTML += '<div class="omnipilot-loading"><div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">Thinking…</span></div>';

    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      body.querySelector('.omnipilot-loading')?.remove();
      body.innerHTML += '<div class="omnipilot-error">Extension context unavailable. Refresh page.</div>';
      return;
    }

    runtime.sendMessage(
      { type: 'AI_ACTION', action: actionId, text },
      response => {
        body.querySelector('.omnipilot-loading')?.remove();
        if (runtime.lastError) {
          body.innerHTML += `<div class="omnipilot-error">${escapeHtml(runtime.lastError.message)}</div>`;
          return;
        }
        if (!response) {
          body.innerHTML += '<div class="omnipilot-error">No response from background service worker.</div>';
          return;
        }
        if (response.success) {
          conversationHistory.push({ role: 'assistant', content: response.result });
          body.innerHTML += `<div class="omnipilot-msg omnipilot-msg-assistant">${formatResult(response.result)}</div>`;
          body.scrollTop = body.scrollHeight;
        } else {
          body.innerHTML += `<div class="omnipilot-error">${escapeHtml(response.error || 'Unknown error')}</div>`;
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

      if (text && text.length > 1 && selection.rangeCount > 0) {
        lastSelection = text;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        lastSelectionRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        // Only show bubble if panel is not visible
        if (!panel || panel.style.display === 'none') {
          showBubble(rect);
        }
      } else {
        // Check if click was on our UI elements
        if (!isOmniPilotElement(e.target)) {
          hideBubble();
          hideDropdown();
          lastSelection = '';
          lastSelectionRect = null;
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
