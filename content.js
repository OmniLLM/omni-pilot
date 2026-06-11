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
  let currentLanguage = 'en';
  let conversationHistory = []; // stores {role, content} for multi-turn chat
  let currentModel = '';
  let currentProvider = '';
  let currentAction = ''; // tracks which action is running
  let panelPositionFixed = false; // true once panel has been positioned or dragged
  let abortController = null; // for cancelling in-flight requests
  let hasApiKey = false; // tracks whether API key is configured

  function label(key) {
    return OmniPilotI18n.t(key, currentLanguage);
  }

  function applyLanguage(language) {
    currentLanguage = OmniPilotI18n.normalizeLanguage(language);
    document.documentElement.lang = currentLanguage;
    updatePanelMeta();
  }

  function applyThemeTo(el) {
    if (!el) return;
    if (currentTheme === 'light') el.setAttribute('data-op-theme', 'light');
    else el.removeAttribute('data-op-theme');
  }

  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-op-theme', theme);
    document.body?.setAttribute('data-op-theme', theme);
    [bubble, dropdown, panel].forEach(applyThemeTo);
  }

  function loadThemePreference() {
    chrome.storage.sync.get({ themePreference: 'dark' }, config => {
      applyTheme(config.themePreference);
    });
  }

  function loadLanguagePreference() {
    chrome.storage.sync.get({ languagePreference: 'en' }, config => {
      applyLanguage(config.languagePreference);
    });
  }

  // Load config from storage
  chrome.storage.sync.get({ model: 'claude-sonnet-4-5', endpoint: 'https://api.omnillm.com/v1', apiKey: '' }, cfg => {
    currentModel = cfg.model || 'claude-sonnet-4-5';
    currentProvider = detectProvider(cfg.endpoint || '');
    hasApiKey = Boolean(cfg.apiKey);
    updatePanelMeta();
  });

  loadThemePreference();
  loadLanguagePreference();

  chrome.storage.onChanged.addListener(changes => {
    if (changes.model) { currentModel = changes.model.newValue; updatePanelMeta(); }
    if (changes.endpoint) { currentProvider = detectProvider(changes.endpoint.newValue || ''); updatePanelMeta(); }
    if (changes.apiKey) hasApiKey = Boolean(changes.apiKey.newValue);
    if (changes.themePreference) applyTheme(changes.themePreference.newValue || 'dark');
    if (changes.languagePreference) applyLanguage(changes.languagePreference.newValue || 'en');
  });

  function detectProvider(endpoint) {
    if (endpoint.includes('omnillm.com')) return 'OmniLLM';
    if (endpoint.includes('anthropic.com')) return 'Anthropic';
    if (endpoint.includes('openai.com')) return 'OpenAI';
    if (endpoint.includes('localhost') || endpoint.includes('127.0.0.1')) return 'Local';
    try { return new URL(endpoint).hostname.split('.').slice(-2, -1)[0] || 'Custom'; } catch { return 'Custom'; }
  }

  function updatePanelMeta() {
    if (!panel) return;
    const modelEl = panel.querySelector('.omnipilot-meta-model');
    const providerEl = panel.querySelector('.omnipilot-meta-provider');
    const titleEl = panel.querySelector('.omnipilot-panel-title');
    const actionEl = panel.querySelector('.omnipilot-meta-action');
    if (modelEl) modelEl.textContent = currentModel;
    if (providerEl) providerEl.textContent = currentProvider;
    if (actionEl) {
      const action = ACTIONS.find(a => a.id === currentAction);
      actionEl.textContent = action ? label(action.labelKey) : label('chat');
    }
    if (titleEl && currentAction) {
      const actionLabels = { translate: label('translating'), summarize: label('summarizing'), explain: label('explaining'), improve: label('improving') };
      titleEl.textContent = `✦ ${actionLabels[currentAction] || 'OmniPilot'}`;
    } else if (titleEl) {
      titleEl.textContent = '✦ OmniPilot';
    }
  }

  const ACTIONS = [
    { id: 'translate', labelKey: 'translate', icon: '🌍' },
    { id: 'summarize', labelKey: 'summarize', icon: '📝' },
    { id: 'explain', labelKey: 'explain', icon: '💡' },
    { id: 'improve', labelKey: 'improve', icon: '✨' }
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
    lastSelectionRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    // position:fixed — viewport coords, no scroll offset
    const x = rect.left + rect.width + 8;
    const y = rect.top + rect.height / 2 - 16;
    bubble.style.left = `${Math.min(Math.max(4, x), window.innerWidth - 130)}px`;
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

    if (!hasApiKey) {
      const item = document.createElement('div');
      item.className = 'omnipilot-dropdown-item omnipilot-setup-item';
      item.innerHTML = `<span class="omnipilot-action-icon">⚙</span>${label('setupApiKey')}`;
      item.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
      item.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        chrome.runtime.openOptionsPage();
        hideDropdown();
        hideBubble();
      });
      el.appendChild(item);
    } else {
      ACTIONS.forEach(action => {
        const item = document.createElement('div');
        item.className = 'omnipilot-dropdown-item';
        item.innerHTML = `<span class="omnipilot-action-icon">${action.icon}</span>${label(action.labelKey)}`;
        item.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
        item.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          runAction(action.id);
        });
        el.appendChild(item);
      });
    }

    document.body.appendChild(el);
    applyThemeTo(el);
    return el;
  }

  function showDropdown(anchorEl) {
    // Recreate dropdown if it exists (API key state may have changed)
    if (dropdown) { dropdown.remove(); dropdown = null; }
    dropdown = createDropdown();
    const rect = anchorEl.getBoundingClientRect();
    // position:fixed — viewport coords
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom + 6}px`;
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
      header.innerHTML = `<span class="omnipilot-panel-title">✦ OmniPilot</span>
        <div class="omnipilot-meta">
          <span class="omnipilot-meta-action-wrap">
            <span class="omnipilot-meta-action">${currentAction ? label(ACTIONS.find(a => a.id === currentAction)?.labelKey || 'chat') : label('chat')}</span>
            <span class="omnipilot-meta-arrow">▾</span>
          </span>
          <span class="omnipilot-meta-sep">·</span>
          <span class="omnipilot-meta-provider">${escapeHtml(currentProvider)}</span>
          <span class="omnipilot-meta-sep">·</span>
          <span class="omnipilot-meta-model-wrap">
            <span class="omnipilot-meta-model">${escapeHtml(currentModel)}</span>
            <span class="omnipilot-meta-arrow">▾</span>
          </span>
        </div>`;

      // Action selector dropdown
      const actionWrap = header.querySelector('.omnipilot-meta-action-wrap');
      actionWrap.addEventListener('click', e => {
        e.stopPropagation();
        showActionSelector(actionWrap);
      });

      // Model selector dropdown
      const modelWrap = header.querySelector('.omnipilot-meta-model-wrap');
      modelWrap.addEventListener('click', e => {
        e.stopPropagation();
        showModelSelector(modelWrap);
      });

      const closeBtn = document.createElement('button');
      closeBtn.className = 'omnipilot-close-btn';
      closeBtn.innerHTML = '✕';
      closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        conversationHistory = [];
        panelPositionFixed = false;
      });
      header.appendChild(closeBtn);

      // Drag support on header
      let dragging = false;
      let dragOffsetX = 0;
      let dragOffsetY = 0;

      header.addEventListener('mousedown', e => {
        if (e.target === closeBtn || e.target.closest('.omnipilot-meta-action-wrap') || e.target.closest('.omnipilot-meta-model-wrap')) return;
        dragging = true;
        const panelLeft = parseFloat(panel.style.left) || 0;
        const panelTop = parseFloat(panel.style.top) || 0;
        // position:fixed — viewport coords only
        dragOffsetX = e.clientX - panelLeft;
        dragOffsetY = e.clientY - panelTop;
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
      const input = document.createElement('textarea');
      input.className = 'omnipilot-panel-input';
      input.placeholder = label('askFollowUp');
      input.rows = 1;
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && input.value.trim()) {
          e.preventDefault();
          e.stopPropagation();
          sendFollowUp(input.value.trim());
          input.value = '';
          input.style.height = 'auto';
        }
        if (e.key === 'Escape') e.stopPropagation();
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
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
      body.innerHTML = `<div class="omnipilot-loading"><div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">${label('thinking')}</span><button class="omnipilot-cancel-btn" title="${label('cancel')}">✕</button></div>`;
      body.querySelector('.omnipilot-cancel-btn')?.addEventListener('click', cancelRequest);
    } else if (isError) {
      body.innerHTML = `<div class="omnipilot-error">${escapeHtml(content)}</div>`;
    } else {
      body.innerHTML = `<div class="omnipilot-result">${formatResult(content)}</div>`;
    }

    // Only position on first show (not after drag or previously positioned)
    if (!panel.dataset.dragged && !panelPositionFixed) {
      positionPanel();
      panelPositionFixed = true;
    }
  }

  function sendFollowUp(question) {
    conversationHistory.push({ role: 'user', content: question });

    // Append user message to panel body
    const body = panel.querySelector('.omnipilot-panel-body');
    body.innerHTML += `<div class="omnipilot-msg omnipilot-msg-user">${escapeHtml(question)}</div>`;
    body.innerHTML += `<div class="omnipilot-loading"><div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">${label('thinking')}</span><button class="omnipilot-cancel-btn" title="${label('cancel')}">✕</button></div>`;
    body.querySelector('.omnipilot-loading .omnipilot-cancel-btn')?.addEventListener('click', cancelRequest);
    body.scrollTop = body.scrollHeight;

    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      body.querySelector('.omnipilot-loading')?.remove();
      body.innerHTML += `<div class="omnipilot-error">${label('extensionContextUnavailable')}</div>`;
      return;
    }

    abortController = new AbortController();
    const signal = abortController.signal;

    runtime.sendMessage(
      { type: 'AI_CHAT', messages: conversationHistory },
      response => {
        if (signal.aborted) return;
        // Remove loading indicator
        body.querySelector('.omnipilot-loading')?.remove();
        if (runtime.lastError) {
          body.innerHTML += `<div class="omnipilot-error">${humanizeError(runtime.lastError.message)}</div>`;
          return;
        }
        if (!response || !response.success) {
          body.innerHTML += `<div class="omnipilot-error">${humanizeError(response?.error)}</div>`;
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
    body.innerHTML = `<div class="omnipilot-selected-context"><span class="omnipilot-context-label">${label('selectedText')}</span> ${escapeHtml(truncated)}</div>`;

    // Only position when opening fresh (not dragged)
    if (!panel.dataset.dragged) {
      positionPanel();
    }

    // Focus the input
    const input = panel.querySelector('.omnipilot-panel-input');
    if (input) setTimeout(() => input.focus(), 50);
  }

  function showModelSelector(anchorEl) {
    // Remove existing selector if any
    const existing = document.getElementById('omnipilot-model-selector');
    if (existing) { existing.remove(); return; }

    const selector = document.createElement('div');
    selector.id = 'omnipilot-model-selector';
    applyThemeTo(selector);

    // Filter input
    const filterInput = document.createElement('input');
    filterInput.className = 'omnipilot-model-filter';
    filterInput.placeholder = label('typeToFilter');
    filterInput.addEventListener('mousedown', e => e.stopPropagation());
    filterInput.addEventListener('keydown', e => e.stopPropagation());
    selector.appendChild(filterInput);

    const listContainer = document.createElement('div');
    listContainer.className = 'omnipilot-model-list';
    selector.appendChild(listContainer);

    document.body.appendChild(selector);

    // Position below the anchor
    const rect = anchorEl.getBoundingClientRect();
    selector.style.left = `${rect.left}px`;
    selector.style.top = `${rect.bottom + 4}px`;

    // Fetch models from background
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) { selector.remove(); return; }

    listContainer.innerHTML = `<div class="omnipilot-model-loading">${label('loadingModels')}</div>`;

    let allModels = [];

    function renderList(filter) {
      const query = filter.toLowerCase();
      const filtered = query ? allModels.filter(m => m.toLowerCase().includes(query)) : allModels;
      listContainer.innerHTML = '';
      if (!filtered.length) {
        listContainer.innerHTML = `<div class="omnipilot-model-loading">${label('noMatches')}</div>`;
        return;
      }
      filtered.forEach(model => {
        const item = document.createElement('div');
        item.className = 'omnipilot-model-item' + (model === currentModel ? ' omnipilot-model-current' : '');
        item.textContent = model;
        item.addEventListener('click', e => {
          e.stopPropagation();
          currentModel = model;
          chrome.storage.sync.set({ model });
          updatePanelMeta();
          selector.remove();
        });
        listContainer.appendChild(item);
      });
    }

    filterInput.addEventListener('input', () => renderList(filterInput.value));

    runtime.sendMessage({ type: 'GET_MODELS' }, response => {
      if (!response || !response.models || !response.models.length) {
        allModels = [currentModel];
      } else {
        allModels = response.models;
      }
      renderList(filterInput.value);
      filterInput.focus();
    });

    // Close on click outside
    const closeHandler = e => {
      if (!selector.contains(e.target) && !anchorEl.contains(e.target)) {
        selector.remove();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
  }

  function showActionSelector(anchorEl) {
    // Remove existing selector if any
    const existing = document.getElementById('omnipilot-action-selector');
    if (existing) { existing.remove(); return; }

    const selector = document.createElement('div');
    selector.id = 'omnipilot-action-selector';
    applyThemeTo(selector);

    const allActions = [
      { id: '', labelKey: 'chat', icon: '💬' },
      ...ACTIONS
    ];

    allActions.forEach(action => {
      const item = document.createElement('div');
      item.className = 'omnipilot-model-item' + (action.id === currentAction ? ' omnipilot-model-current' : '');
      item.innerHTML = `<span style="margin-right:6px">${action.icon}</span>${label(action.labelKey)}`;
      item.addEventListener('click', e => {
        e.stopPropagation();
        currentAction = action.id;
        updatePanelMeta();
        selector.remove();

        // If an action is selected and there's text in context, re-run
        if (action.id && lastSelection) {
          runAction(action.id);
        }
      });
      selector.appendChild(item);
    });

    document.body.appendChild(selector);

    // Position below the anchor
    const rect = anchorEl.getBoundingClientRect();
    selector.style.left = `${rect.left}px`;
    selector.style.top = `${rect.bottom + 4}px`;

    // Close on click outside
    const closeHandler = e => {
      if (!selector.contains(e.target) && !anchorEl.contains(e.target)) {
        selector.remove();
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
  }

  function positionPanel() {
    if (!panel) return;
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
      // position:fixed — viewport coords
      let left = lastSelectionRect.right + gap;
      let top = lastSelectionRect.top;

      // If right side overflows, try left side
      if (left + actualW > window.innerWidth - margin) {
        left = lastSelectionRect.left - actualW - gap;
      }

      // Clamp to viewport
      left = Math.max(margin, Math.min(left, window.innerWidth - actualW - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - actualH - margin));

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    } else if (bubble && bubble.style.display !== 'none') {
      const bRect = bubble.getBoundingClientRect();
      panel.style.left = `${Math.min(bRect.left, window.innerWidth - actualW - margin)}px`;
      panel.style.top = `${bRect.bottom + gap}px`;
    } else {
      panel.style.left = `${Math.max(margin, (window.innerWidth - actualW) / 2)}px`;
      panel.style.top = `80px`;
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

  function humanizeError(msg) {
    if (!msg) return label('somethingWrong');
    const s = escapeHtml(msg);
    if (/401|403|api key/i.test(s)) return `${label('apiKeyRejected')} <a class="omnipilot-error-link" href="#">${label('checkSettings')}</a>`;
    if (/429|rate.?limit|quota/i.test(s)) return label('rateLimit');
    if (/network|fetch|timeout|ECONNREFUSED/i.test(s)) return label('networkError');
    if (/empty.*response/i.test(s)) return label('emptyResponseError');
    return s;
  }

  // ── Cancel Support ─────────────────────────────────────────────────────────────

  function cancelRequest() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (panel) {
      const body = panel.querySelector('.omnipilot-panel-body');
      const loading = body?.querySelector('.omnipilot-loading');
      if (loading) {
        loading.remove();
        body.innerHTML += `<div class="omnipilot-cancelled">${label('cancelled')}</div>`;
      }
    }
  }

  // ── Action Runner ─────────────────────────────────────────────────────────────

  function runAction(actionId) {
    hideDropdown();
    hideBubble();

    const text = lastSelection;
    if (!text) return;

    // Set current action and update panel title
    currentAction = actionId;

    // Initialize conversation with the selected text context
    conversationHistory = [{ role: 'user', content: text }];

    // Show panel immediately with loading state
    showPanelForConversation(text);
    updatePanelMeta();
    const body = panel.querySelector('.omnipilot-panel-body');
    body.innerHTML += `<div class="omnipilot-loading"><div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">${label('thinking')}</span><button class="omnipilot-cancel-btn" title="${label('cancel')}">✕</button></div>`;
    body.querySelector('.omnipilot-cancel-btn')?.addEventListener('click', cancelRequest);

    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      body.querySelector('.omnipilot-loading')?.remove();
      body.innerHTML += `<div class="omnipilot-error">${label('extensionContextUnavailable')}</div>`;
      return;
    }

    // Create abort controller for this request
    abortController = new AbortController();
    const signal = abortController.signal;

    runtime.sendMessage(
      { type: 'AI_ACTION', action: actionId, text },
      response => {
        if (signal.aborted) return; // cancelled
        body.querySelector('.omnipilot-loading')?.remove();
        if (runtime.lastError) {
          body.innerHTML += `<div class="omnipilot-error">${humanizeError(runtime.lastError.message)}</div>`;
          return;
        }
        if (!response) {
          body.innerHTML += `<div class="omnipilot-error">${label('noResponse')}</div>`;
          return;
        }
        if (response.success) {
          conversationHistory.push({ role: 'assistant', content: response.result });
          body.innerHTML += `<div class="omnipilot-msg omnipilot-msg-assistant">${formatResult(response.result)}</div>`;
          body.scrollTop = body.scrollHeight;
        } else {
          body.innerHTML += `<div class="omnipilot-error">${humanizeError(response.error || label('unknownError'))}</div>`;
        }
        currentAction = '';
        updatePanelMeta();
      }
    );
  }

  // ── Selection Detection ───────────────────────────────────────────────────────

  document.addEventListener('mouseup', e => {
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    // Small delay to let selection finalize
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (text && text.length > 1 && selection.rangeCount > 0) {
        lastSelection = text;
        const range = selection.getRangeAt(0);
        let rect = range.getBoundingClientRect();
        // Fallback: Edge sometimes returns zero rect for cross-element selections
        if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) {
          rect = { left: mouseX, top: mouseY, right: mouseX, bottom: mouseY, width: 0, height: 0 };
        }
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
      if (panel) { panel.style.display = 'none'; panelPositionFixed = false; }
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
