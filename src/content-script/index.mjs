// OmniPilot - content script
// Detects text selection and shows AI action bubble

import { t, normalizeLanguage } from '../utils/i18n.mjs';

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
  let hasApiKey = false; // tracks whether API key or Copilot auth is configured
  let currentProviderType = 'custom-provider';
  let currentAuthMethod = 'api-key';
  let currentApiKey = '';
  let currentEndpoint = '';
  let a2aServers = [];
  let lastAppendedSelectionContext = '';
  let selectionContextSeq = 0;
  let popupInitialWidth = null;
  let popupInitialHeight = null;
  const REPOSITORY_URL = 'https://github.com/OmniLLM/omni-pilot';
  // If the stream port goes silent this long without any message, assume the
  // service worker died / an A2A delegation hung and surface an error instead of
  // a spinner that never resolves. Reset on every message, so healthy long
  // streams and delegations are unaffected.
  const STREAM_WATCHDOG_MS = 90000;
  const PROVIDER_LABELS = {
    'custom-provider': 'Custom',
    'github-copilot': 'GitHub Copilot',
    'azure-foundry': 'Azure Foundry'
  };

  function label(key) {
    return t(key, currentLanguage);
  }

  function applyLanguage(language) {
    currentLanguage = normalizeLanguage(language);
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

  function normalizePopupSizeValue(value, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(min, Math.min(max, parsed));
  }

  // Load config from storage
  chrome.storage.sync.get({ model: 'claude-sonnet-4-5', endpoint: 'https://api.omnillm.com/v1', apiKey: '', providerType: 'custom-provider', authMethod: 'api-key', popupInitialWidth: null, popupInitialHeight: null }, cfg => {
    currentModel = cfg.model || 'claude-sonnet-4-5';
    currentProviderType = normalizeProviderType(cfg.providerType || 'custom-provider');
    currentAuthMethod = cfg.authMethod || 'api-key';
    currentApiKey = cfg.apiKey || '';
    currentEndpoint = cfg.endpoint || '';
    popupInitialWidth = normalizePopupSizeValue(cfg.popupInitialWidth, 300, 1200);
    popupInitialHeight = normalizePopupSizeValue(cfg.popupInitialHeight, 180, 900);
    currentProvider = getProviderLabel(currentProviderType || currentAuthMethod, currentEndpoint);
    hasApiKey = currentProviderType === 'github-copilot' || currentAuthMethod === 'github-copilot' || isA2aProviderType(currentProviderType) || Boolean(currentApiKey);
    updatePanelMeta();
  });

  loadA2aServersFromStorage(servers => {
    a2aServers = servers;
    currentProvider = getProviderLabel(currentProviderType || currentAuthMethod, currentEndpoint);
    hasApiKey = currentProviderType === 'github-copilot' || currentAuthMethod === 'github-copilot' || isA2aProviderType(currentProviderType) || Boolean(currentApiKey);
    updatePanelMeta();
  });

  loadThemePreference();
  loadLanguagePreference();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (changes.model) { currentModel = changes.model.newValue; updatePanelMeta(); }
    if (changes.endpoint) currentEndpoint = changes.endpoint.newValue || '';
    if (changes.providerType) currentProviderType = normalizeProviderType(changes.providerType.newValue || 'custom-provider');
    if (changes.authMethod) currentAuthMethod = changes.authMethod.newValue || 'api-key';
    if (changes.apiKey) currentApiKey = changes.apiKey.newValue || '';
    const a2aServersStorageName = (chrome.storage.local ? 'local' : 'sync');
    const a2aServersChanged = Boolean(changes.a2aServers) && (areaName === undefined || areaName === a2aServersStorageName);
    if (a2aServersChanged) a2aServers = changes.a2aServers.newValue || [];
    if (changes.endpoint || changes.providerType || changes.authMethod || a2aServersChanged) {
      currentProvider = getProviderLabel(currentProviderType || currentAuthMethod, currentEndpoint);
      updatePanelMeta();
    }
    if (changes.apiKey || changes.authMethod || changes.providerType || a2aServersChanged) {
      hasApiKey = currentProviderType === 'github-copilot' || currentAuthMethod === 'github-copilot' || isA2aProviderType(currentProviderType) || Boolean(currentApiKey);
    }
    if (changes.themePreference) applyTheme(changes.themePreference.newValue || 'dark');
    if (changes.languagePreference) applyLanguage(changes.languagePreference.newValue || 'en');
    if (changes.popupInitialWidth) popupInitialWidth = normalizePopupSizeValue(changes.popupInitialWidth.newValue, 300, 1200);
    if (changes.popupInitialHeight) popupInitialHeight = normalizePopupSizeValue(changes.popupInitialHeight.newValue, 180, 900);
  });

  function isA2aProviderType(providerType) {
    return typeof providerType === 'string' && providerType.startsWith('a2a:');
  }

  function getA2aServersStorageArea() {
    return chrome.storage.local || chrome.storage.sync;
  }

  function loadA2aServersFromStorage(callback) {
    getA2aServersStorageArea().get(['a2aServers'], local => {
      if (Array.isArray(local?.a2aServers)) {
        callback(local.a2aServers);
        return;
      }
      // Fall back to legacy sync storage until options.js migrates it.
      chrome.storage.sync.get(['a2aServers'], synced => {
        callback(Array.isArray(synced?.a2aServers) ? synced.a2aServers : []);
      });
    });
  }

  function normalizeProviderType(providerType) {
    return PROVIDER_LABELS[providerType] ? providerType : 'custom-provider';
  }

  function getA2aServerIdFromProviderType(providerType) {
    return isA2aProviderType(providerType) ? providerType.slice(4) : '';
  }

  function getA2aServerLabel(providerType) {
    const serverId = getA2aServerIdFromProviderType(providerType);
    return a2aServers.find(server => server.id === serverId)?.name || 'A2A';
  }

  function getProviderEntries() {
    return Object.entries(PROVIDER_LABELS)
      .map(([providerType, label]) => ({ providerType, label }));
  }

  function getProviderLabel(providerType, endpoint) {
    return PROVIDER_LABELS[normalizeProviderType(providerType)] || detectProvider(endpoint || '');
  }

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
      const actionLabels = {
        translate: label('translating'),
        'translate-en': label('translating'),
        'translate-zh': label('translating'),
        'translate-bidi': label('translating'),
        summarize: label('summarizing'),
        explain: label('explaining'),
        improve: label('improving'),
        sentiment: label('analyzing'),
        'code-explain': label('explaining'),
        'divide-paragraphs': label('dividing'),
        ask: label('asking'),
        'delegate-a2a': label('delegating'),
        'summarize-page': label('summarizingPage'),
        'summarize-github': label('summarizingGitHub')
      };
      titleEl.textContent = `✦ ${actionLabels[currentAction] || 'OmniPilot'}`;
    } else if (titleEl) {
      titleEl.textContent = '✦ OmniPilot';
    }
  }

  const ACTIONS = [
    { id: 'translate', labelKey: 'translate', icon: '🌍' },
    { id: 'summarize', labelKey: 'summarize', icon: '📝' },
    { id: 'explain', labelKey: 'explain', icon: '💡' },
    { id: 'improve', labelKey: 'improve', icon: '✨' },
    { id: 'sentiment', labelKey: 'sentiment', icon: '😊' },
    { id: 'code-explain', labelKey: 'codeExplain', icon: '🔧' },
    { id: 'divide-paragraphs', labelKey: 'divideParagraphs', icon: '📋' },
    { id: 'ask', labelKey: 'ask', icon: '❓' }
  ];

  const PAGE_CONTENT_MAX_CHARS = 12000;

  // ── Smart Page Content Extraction ─────────────────────────────────────────────

  const SITE_CONTENT_SELECTORS = {
    'scholar.google': ['#gs_res_ccl_mid'],
    'google': ['#search'],
    'bing': ['#b_results'],
    'wikipedia': ['#mw-content-text'],
    'github': ['[data-testid="issue-body"]', '.comment-body', '.markdown-body', '#readme'],
    'stackoverflow': ['#answers', '.js-post-body'],
    'reddit': ['[data-testid="post-container"]', '.Post'],
    'medium.com': ['article']
  };

  function getElementArea(el) {
    const rect = el.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function findLargestContentElement(root) {
    if (!root) return null;
    let maxArea = 0;
    let largest = null;
    const limitedArea = 0.8 * getElementArea(root);
    function traverse(node) {
      if (node.nodeType !== 1) return; // ELEMENT_NODE
      const area = getElementArea(node);
      if (area > maxArea && area < limitedArea) {
        maxArea = area;
        largest = node;
      }
      for (let i = 0; i < node.children.length; i++) traverse(node.children[i]);
    }
    traverse(root);
    return largest;
  }

  function cleanExtractedText(text) {
    return text.trim().replace(/\t/g, '').replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ');
  }

  function extractPageContent() {
    const hostname = location.hostname;

    // Try site-specific selectors first
    for (const [site, selectors] of Object.entries(SITE_CONTENT_SELECTORS)) {
      if (hostname.includes(site)) {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.innerText?.trim()) {
            const text = cleanExtractedText(el.innerText);
            if (text.length > 50) {
              return text.length > PAGE_CONTENT_MAX_CHARS
                ? text.slice(0, PAGE_CONTENT_MAX_CHARS) + '\n\n[Content truncated]'
                : text;
            }
          }
        }
        break;
      }
    }

    // Try <article> tag
    const article = document.querySelector('article');
    if (article?.innerText?.trim().length > 50) {
      const text = cleanExtractedText(article.innerText);
      return text.length > PAGE_CONTENT_MAX_CHARS
        ? text.slice(0, PAGE_CONTENT_MAX_CHARS) + '\n\n[Content truncated]'
        : text;
    }

    // Heuristic: find largest content element
    const largest = findLargestContentElement(document.body);
    if (largest) {
      const secondLargest = findLargestContentElement(largest);
      const target = (secondLargest && getElementArea(secondLargest) > 0.5 * getElementArea(largest))
        ? secondLargest : largest;
      const text = cleanExtractedText(target.innerText || '');
      if (text.length > 50) {
        return text.length > PAGE_CONTENT_MAX_CHARS
          ? text.slice(0, PAGE_CONTENT_MAX_CHARS) + '\n\n[Content truncated]'
          : text;
      }
    }

    // Fallback to body
    const text = cleanExtractedText(document.body?.innerText || '');
    if (!text) return '';
    return text.length > PAGE_CONTENT_MAX_CHARS
      ? text.slice(0, PAGE_CONTENT_MAX_CHARS) + '\n\n[Content truncated]'
      : text;
  }

  // ── GitHub Issue/PR Content Extraction ────────────────────────────────────────

  function isGitHubIssuePage() {
    return location.hostname === 'github.com' && /\/issues\/\d+/.test(location.pathname);
  }

  function isGitHubPullPage() {
    return location.hostname === 'github.com' && /\/pull\/\d+/.test(location.pathname);
  }

  function extractGitHubIssueContent() {
    const title = document.querySelector('.js-issue-title')?.textContent?.trim()
      || document.querySelector('[data-testid="issue-title"]')?.textContent?.trim()
      || document.title;

    const comments = [];
    const commentElements = document.querySelectorAll('.timeline-comment-group, .js-comment-container');
    commentElements.forEach((el, i) => {
      const author = (el.querySelector('.author') || el.querySelector('.author-name'))?.textContent?.trim() || 'Unknown';
      const date = el.querySelector('relative-time')?.getAttribute('datetime') || '';
      const body = el.querySelector('.comment-body')?.textContent?.trim() || '';
      if (body) {
        comments.push(`Comment ${i + 1} by ${author}${date ? ' on ' + date : ''}:\n${body}`);
      }
    });

    const type = isGitHubPullPage() ? 'Pull Request' : 'Issue';
    let prompt = `GitHub ${type}: ${title}\n\n`;
    prompt += comments.join('\n\n');
    return prompt.length > PAGE_CONTENT_MAX_CHARS
      ? prompt.slice(0, PAGE_CONTENT_MAX_CHARS) + '\n\n[Content truncated]'
      : prompt;
  }

  function hasEnabledA2aServers() {
    return a2aServers.some(server => server && server.enabled !== false);
  }

  function getDropdownActions() {
    return [...ACTIONS];
  }

  function getDropdownActionIds() {
    return getDropdownActions().map(action => action.id);
  }

  function normalizeA2aTag(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function findA2aServerByMention(tag) {
    const normalizedTag = normalizeA2aTag(tag);
    const enabledServers = a2aServers.filter(server => server && server.enabled !== false);
    const exactMatch = enabledServers.find(server => normalizeA2aTag(server.name || server.id || '') === normalizedTag);
    if (exactMatch) return exactMatch;
    if (normalizedTag === 'a2a' && enabledServers.length === 1) return enabledServers[0];
    return null;
  }

  function parseA2aMentionTask(text) {
    const match = String(text || '').trim().match(/^@(\S+)(?:\s+([\s\S]*))?$/);
    if (!match) return null;

    const rawTag = match[1];
    const normalizedTag = normalizeA2aTag(rawTag);
    if (!normalizedTag.startsWith('a2a')) return null;

    const server = findA2aServerByMention(rawTag);
    if (!server) return { error: `A2A server not found: @${rawTag}` };

    const task = String(match[2] || '').trim();
    if (!task) return { error: 'A2A task is required.' };

    return { server, task };
  }

  function getA2aDelegationContext() {
    const priorContext = conversationHistory
      .filter(message => typeof message?.content === 'string' && message.role === 'user' && message.kind !== 'selection-context' && !message.kind?.startsWith?.('a2a-') && !parseA2aMentionTask(message.content))
      .map(message => `${message.role === 'assistant' ? 'Popup assistant' : 'Popup user'}: ${message.content.trim()}`)
      .filter(Boolean)
      .join('\n\n');

    const selectionContextText = getActiveSelectionContextText();
    const selectionContext = selectionContextText ? buildSelectionContextMessage(selectionContextText) : '';
    const contextParts = [selectionContext, priorContext].filter(Boolean);
    return contextParts.join('\n\n') || selectionContextText || '';
  }

  // ── Bubble ──────────────────────────────────────────────────────────────────

  function createBubble() {
    const el = document.createElement('div');
    el.id = 'omnipilot-bubble';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', label('omnipilotBubbleLabel') || 'OmniPilot: AI actions for selected text');
    el.setAttribute('aria-haspopup', 'menu');
    el.setAttribute('aria-expanded', 'false');
    el.innerHTML = '<span class="omnipilot-icon">✦</span> OmniPilot';
    el.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleDropdown(el);
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        toggleDropdown(el);
      }
      if (e.key === 'Escape') {
        hideBubble();
        hideDropdown();
      }
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
      anchorEl.setAttribute('aria-expanded', 'false');
      return;
    }
    showDropdown(anchorEl);
    anchorEl.setAttribute('aria-expanded', 'true');
  }

  function createDropdown() {
    const el = document.createElement('div');
    el.id = 'omnipilot-dropdown';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', 'OmniPilot actions');

    if (!hasApiKey) {
      const item = document.createElement('div');
      item.className = 'omnipilot-dropdown-item omnipilot-setup-item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('tabindex', '0');
      item.innerHTML = `<span class="omnipilot-action-icon">⚙</span>${label('setupApiKey')}`;
      item.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
      item.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        showOnboardingPanel();
      });
      el.appendChild(item);
    } else {
      getDropdownActions().forEach(action => {
        const item = document.createElement('div');
        item.className = 'omnipilot-dropdown-item';
        item.setAttribute('role', 'menuitem');
        item.setAttribute('tabindex', '0');
        item.innerHTML = `<span class="omnipilot-action-icon">${action.icon}</span>${label(action.labelKey)}`;
        item.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
        item.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          if (action.id === 'delegate-a2a') {
            showA2aDelegationPanel();
          } else {
            runAction(action.id);
          }
        });
        el.appendChild(item);
      });
    }

    // Keyboard navigation for menu items
    el.addEventListener('keydown', e => {
      const items = Array.from(el.querySelectorAll('[role="menuitem"]'));
      const current = document.activeElement;
      const idx = items.indexOf(current);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = idx < items.length - 1 ? idx + 1 : 0;
        items[next]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = idx > 0 ? idx - 1 : items.length - 1;
        items[prev]?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        current?.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideDropdown();
        bubble?.focus();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        hideDropdown();
        bubble?.focus();
      }
    });

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
    // Focus first menu item for keyboard accessibility
    const firstItem = dropdown.querySelector('[role="menuitem"]');
    if (firstItem) setTimeout(() => firstItem.focus(), 0);
  }

  function hideDropdown() {
    if (dropdown) dropdown.style.display = 'none';
    if (bubble) bubble.setAttribute('aria-expanded', 'false');
  }

  // ── Result Panel ─────────────────────────────────────────────────────────────

  function showOnboardingPanel() {
    hideBubble();
    hideDropdown();
    if (!panel) {
      showPanel('', false, false);
    } else {
      panel.style.display = 'flex';
    }
    const body = panel.querySelector('.omnipilot-panel-body');
    const onboarding = document.createElement('div');
    onboarding.className = 'omnipilot-onboarding';
    onboarding.innerHTML = `
      <div class="omnipilot-onboarding-icon">✦</div>
      <div class="omnipilot-onboarding-title">${escapeHtml(label('welcomeTitle') || 'Welcome to OmniPilot')}</div>
      <div class="omnipilot-onboarding-desc">${escapeHtml(label('welcomeDesc') || 'Set up your AI provider to get started with text actions.')}</div>
      <ol class="omnipilot-onboarding-steps">
        <li>${escapeHtml(label('onboardingStep1') || 'Open Settings and choose a provider')}</li>
        <li>${escapeHtml(label('onboardingStep2') || 'Enter your API key or sign in')}</li>
        <li>${escapeHtml(label('onboardingStep3') || 'Select text on any page to use AI actions')}</li>
      </ol>
    `;
    const btn = document.createElement('button');
    btn.className = 'omnipilot-onboarding-btn';
    btn.textContent = label('openSettings') || 'Open Settings';
    btn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    onboarding.appendChild(btn);

    body.innerHTML = '';
    body.appendChild(onboarding);

    if (!panel.dataset.dragged) {
      positionPanel();
    }
  }

  function calcInitialPanelSize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = Math.max(300, vw - 32);
    const maxH = Math.max(180, vh - 32);
    const fallbackW = Math.max(420, Math.min(640, Math.round(vw * 0.4)));
    const fallbackH = Math.max(220, Math.min(400, Math.round(vh * 0.32)));
    const w = Math.min(popupInitialWidth || fallbackW, maxW);
    const h = Math.min(popupInitialHeight || fallbackH, maxH);
    return { w, h };
  }

  function showPanel(content, isLoading = false, isError = false) {
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'omnipilot-panel';

      const header = document.createElement('div');
      header.className = 'omnipilot-panel-header';
      header.innerHTML = `<a class="omnipilot-panel-title" href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer" title="Open OmniPilot on GitHub">✦ OmniPilot</a>
        <div class="omnipilot-meta">
          <span class="omnipilot-meta-action-wrap">
            <span class="omnipilot-meta-action">${currentAction ? label(ACTIONS.find(a => a.id === currentAction)?.labelKey || 'chat') : label('chat')}</span>
            <span class="omnipilot-meta-arrow">▾</span>
          </span>
          <span class="omnipilot-meta-sep">·</span>
          <span class="omnipilot-meta-provider-wrap">
            <span class="omnipilot-meta-provider">${escapeHtml(currentProvider)}</span>
            <span class="omnipilot-meta-arrow">▾</span>
          </span>
          <span class="omnipilot-meta-sep">·</span>
          <span class="omnipilot-meta-model-wrap">
            <span class="omnipilot-meta-model">${escapeHtml(currentModel)}</span>
            <span class="omnipilot-meta-arrow">▾</span>
          </span>
        </div>`;

      const titleLink = header.querySelector('.omnipilot-panel-title');
      titleLink.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        window.open(REPOSITORY_URL, '_blank', 'noopener,noreferrer');
      });

      // Action selector dropdown
      const actionWrap = header.querySelector('.omnipilot-meta-action-wrap');
      actionWrap.addEventListener('click', e => {
        e.stopPropagation();
        showActionSelector(actionWrap);
      });

      // Provider selector dropdown
      const providerWrap = header.querySelector('.omnipilot-meta-provider-wrap');
      providerWrap.addEventListener('click', e => {
        e.stopPropagation();
        showProviderSelector(providerWrap);
      });

      // Model selector dropdown
      const modelWrap = header.querySelector('.omnipilot-meta-model-wrap');
      modelWrap.addEventListener('click', e => {
        e.stopPropagation();
        showModelSelector(modelWrap);
      });

      const exportBtn = document.createElement('button');
      exportBtn.className = 'omnipilot-export-btn';
      exportBtn.innerHTML = '📋';
      exportBtn.setAttribute('title', label('exportConversation'));
      exportBtn.setAttribute('aria-label', label('exportConversation') || 'Copy conversation');
      exportBtn.addEventListener('click', e => {
        e.stopPropagation();
        const text = conversationHistory
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => `${m.role === 'user' ? 'You' : 'OmniPilot'}: ${m.content}`)
          .join('\n\n');
        navigator.clipboard.writeText(text).then(() => {
          exportBtn.innerHTML = '✓';
          setTimeout(() => { exportBtn.innerHTML = '📋'; }, 1500);
        });
      });
      header.appendChild(exportBtn);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'omnipilot-close-btn';
      closeBtn.innerHTML = '✕';
      closeBtn.setAttribute('aria-label', label('closePanel') || 'Close panel');
      closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        conversationHistory = [];
        lastAppendedSelectionContext = '';
        panelPositionFixed = false;
      });
      header.appendChild(closeBtn);

      // Drag support on header
      let dragging = false;
      let dragOffsetX = 0;
      let dragOffsetY = 0;

      header.addEventListener('mousedown', e => {
        if (e.target === closeBtn || e.target === exportBtn || e.target.closest('.omnipilot-panel-title') || e.target.closest('.omnipilot-meta-action-wrap') || e.target.closest('.omnipilot-meta-provider-wrap') || e.target.closest('.omnipilot-meta-model-wrap')) return;
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
        const newW = Math.max(300, resizeStartW + (e.clientX - resizeStartX));
        const newH = Math.max(180, resizeStartH + (e.clientY - resizeStartY));
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

      body.addEventListener('click', e => {
        const removeBtn = e.target.closest?.('.omnipilot-context-remove');
        if (removeBtn) {
          e.preventDefault();
          e.stopPropagation();
          removeSelectionContext(removeBtn.dataset.contextId || '');
          return;
        }

        const copyBtn = e.target.closest?.('.omnipilot-code-block-copy-btn');
        if (copyBtn) {
          e.preventDefault();
          e.stopPropagation();
          const codeBody = copyBtn.closest('.omnipilot-code-block-card')?.querySelector('.omnipilot-code-block-body');
          if (codeBody) {
            navigator.clipboard.writeText(codeBody.textContent).then(() => {
              const oldText = copyBtn.textContent;
              copyBtn.textContent = '✓';
              setTimeout(() => { copyBtn.textContent = oldText; }, 1500);
            });
          }
        }
      });

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
        const maxH = parseInt(input.style.maxHeight, 10) || 120;
        input.style.height = Math.min(input.scrollHeight, maxH) + 'px';
      });
      input.addEventListener('mousedown', e => e.stopPropagation());
      const sendBtn = document.createElement('button');
      sendBtn.className = 'omnipilot-send-btn';
      sendBtn.textContent = '→';
      sendBtn.setAttribute('aria-label', label('sendMessage') || 'Send message');
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

      // Observe panel size changes to scale textarea max-height proportionally
      const panelResizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const panelHeight = entry.contentRect.height;
          // Scale textarea max-height to ~20% of panel height, clamped between 80-200px
          const newMaxHeight = Math.max(80, Math.min(200, Math.round(panelHeight * 0.2)));
          input.style.maxHeight = `${newMaxHeight}px`;
          // Re-fit current content within the new max
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, newMaxHeight) + 'px';
        }
      });
      panelResizeObserver.observe(panel);
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
    const a2aMentionTask = parseA2aMentionTask(question);

    // Append user message to panel body
    const body = panel.querySelector('.omnipilot-panel-body');
    body.appendChild(createUserMessage(question));
    body.appendChild(createLoadingIndicator());
    body.scrollTop = body.scrollHeight;

    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      body.querySelector('.omnipilot-loading')?.remove();
      body.appendChild(createErrorElement(label('extensionContextUnavailable')));
      return;
    }

    abortController = new AbortController();
    const signal = abortController.signal;

    if (a2aMentionTask?.error) {
      body.querySelector('.omnipilot-loading')?.remove();
      body.appendChild(createErrorElement(escapeHtml(a2aMentionTask.error)));
      return;
    }

    // A2A delegation uses non-streaming sendMessage (A2A protocol is not SSE)
    if (a2aMentionTask?.server) {
      runtime.sendMessage(
        {
          type: 'A2A_DELEGATE_TASK',
          serverId: a2aMentionTask.server.id,
          task: a2aMentionTask.task,
          contextText: getA2aDelegationContext()
        },
        response => {
          if (signal.aborted) return;
          body.querySelector('.omnipilot-loading')?.remove();
          if (runtime.lastError) {
            body.appendChild(createErrorElement(humanizeError(runtime.lastError.message)));
            return;
          }
          if (!response || !response.success) {
            body.appendChild(createErrorElement(humanizeError(response?.error)));
            return;
          }
          conversationHistory.push({ role: 'assistant', content: response.result, kind: 'a2a-result' });
          body.appendChild(createAssistantMessage(response.result));
          body.scrollTop = body.scrollHeight;
        }
      );
      return;
    }

    // Use streaming for normal chat follow-ups
    streamChat(conversationHistory, body);
  }

  function buildSelectionContextMessage(selectedText) {
    return `Additional selected context:\n${selectedText}`;
  }

  function getActiveSelectionContextText() {
    return conversationHistory
      .filter(message => message.kind === 'selection-context' && typeof message.content === 'string')
      .map(message => message.content.replace(/^Additional selected context:\n/, '').trim())
      .filter(Boolean)
      .join('\n\n');
  }

  function renderSelectionContext(selectedText, contextId = '') {
    const truncated = selectedText.length > 200 ? selectedText.slice(0, 200) + '…' : selectedText;
    const contextAttr = contextId ? ` data-context-id="${escapeHtml(contextId)}"` : '';
    const removeButton = contextId ? `<button type="button" class="omnipilot-context-remove" data-context-id="${escapeHtml(contextId)}" title="${label('remove')}" aria-label="${label('remove')}">✕</button>` : '';
    return `<div class="omnipilot-selected-context"${contextAttr}><div class="omnipilot-context-header"><span class="omnipilot-context-label">${label('selectedText')}</span>${removeButton}</div><div class="omnipilot-context-text">${escapeHtml(truncated)}</div></div>`;
  }

  function removeSelectionContext(contextId) {
    if (!contextId) return;
    const index = conversationHistory.findIndex(message => message.kind === 'selection-context' && message.contextId === contextId);
    if (index === -1) return;

    const removedContent = conversationHistory[index].content;
    conversationHistory.splice(index, 1);

    const contextEl = panel?.querySelector(`.omnipilot-selected-context[data-context-id="${contextId}"]`);
    contextEl?.remove();

    const body = panel?.querySelector('.omnipilot-panel-body');
    if (body?.innerHTML?.includes(`data-context-id="${contextId}"`)) {
      const start = body.innerHTML.indexOf(`<div class="omnipilot-selected-context" data-context-id="${contextId}">`);
      const nextMarkers = [
        '<div class="omnipilot-selected-context"',
        '<div class="omnipilot-msg',
        '<div class="omnipilot-loading',
        '<div class="omnipilot-error',
        '<div class="omnipilot-cancelled'
      ];
      const end = nextMarkers
        .map(marker => body.innerHTML.indexOf(marker, start + 1))
        .filter(position => position > start)
        .sort((a, b) => a - b)[0] || body.innerHTML.length;
      if (start !== -1) body.innerHTML = body.innerHTML.slice(0, start) + body.innerHTML.slice(end);
    }

    if (removedContent === buildSelectionContextMessage(lastAppendedSelectionContext)) {
      const remainingSelection = conversationHistory
        .filter(message => message.kind === 'selection-context' && typeof message.content === 'string')
        .at(-1)?.content?.replace(/^Additional selected context:\n/, '').trim() || '';
      lastAppendedSelectionContext = remainingSelection;
    }
  }

  function appendSelectionToConversation(selectedText) {
    const text = selectedText.trim();
    if (!text || text === lastAppendedSelectionContext || !panel || panel.style.display === 'none') return;

    const contextId = `selection-context-${++selectionContextSeq}`;
    lastAppendedSelectionContext = text;
    conversationHistory.push({ role: 'user', content: buildSelectionContextMessage(text), kind: 'selection-context', contextId });

    const body = panel.querySelector('.omnipilot-panel-body');
    if (body) {
      const prevHtml = body.innerHTML || '';
      body.innerHTML = prevHtml + renderSelectionContext(text, contextId);
      body.scrollTop = body.scrollHeight;
    }
  }

  function showPanelForConversation(selectedText, contextId) {
    // Show panel immediately with selected text displayed and input ready
    if (!panel) {
      showPanel('', false, false); // creates the panel
    } else {
      panel.style.display = 'flex';
    }
    const body = panel.querySelector('.omnipilot-panel-body');
    // Show the selected text as context
    body.innerHTML = renderSelectionContext(selectedText, contextId);

    // Only position when opening fresh (not dragged)
    if (!panel.dataset.dragged) {
      positionPanel();
    }

    // Focus the input
    const input = panel.querySelector('.omnipilot-panel-input');
    if (input) setTimeout(() => input.focus(), 50);
  }

  function renderA2aDelegationForm() {
    const options = a2aServers
      .filter(server => server && server.enabled !== false)
      .map(server => `<option value="${escapeHtml(server.id || '')}">${escapeHtml(server.name || server.id || '')}</option>`)
      .join('');

    return `<div class="omnipilot-a2a-form">
      ${lastSelection ? renderSelectionContext(lastSelection) : ''}
      <select class="omnipilot-a2a-select">${options}</select>
      <textarea class="omnipilot-a2a-textarea" placeholder="${escapeHtml(label('a2aTaskPlaceholder'))}"></textarea>
      <button class="omnipilot-a2a-submit">${escapeHtml(label('delegate'))}</button>
    </div>`;
  }

  function showA2aDelegationPanel() {
    hideDropdown();
    hideBubble();

    currentAction = 'delegate-a2a';
    conversationHistory = [];
    lastAppendedSelectionContext = '';

    if (!panel) {
      showPanel('', false, false);
    } else {
      panel.style.display = 'flex';
    }

    const body = panel.querySelector('.omnipilot-panel-body');
    body.innerHTML = renderA2aDelegationForm();
    updatePanelMeta();

    const select = body.querySelector('.omnipilot-a2a-select');
    const textarea = body.querySelector('.omnipilot-a2a-textarea');
    const submit = body.querySelector('.omnipilot-a2a-submit');

    submit?.addEventListener('click', () => sendA2aDelegation(select?.value || '', textarea?.value || ''));
    textarea?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        sendA2aDelegation(select?.value || '', textarea.value || '');
      }
      if (e.key === 'Escape') e.stopPropagation();
    });

    positionPanel();
    panelPositionFixed = true;
    setTimeout(() => textarea?.focus(), 50);
  }

  function sendA2aDelegation(serverId, task) {
    const trimmedTask = task.trim();
    const body = panel?.querySelector('.omnipilot-panel-body');
    if (!body) return;

    if (!trimmedTask) {
      body.innerHTML = `${renderA2aDelegationForm()}<div class="omnipilot-error">${label('somethingWrong')}</div>`;
      const select = body.querySelector('.omnipilot-a2a-select');
      const textarea = body.querySelector('.omnipilot-a2a-textarea');
      const submit = body.querySelector('.omnipilot-a2a-submit');
      if (select && serverId) select.value = serverId;
      if (textarea) textarea.value = task;
      submit?.addEventListener('click', () => sendA2aDelegation(select?.value || '', textarea?.value || ''));
      textarea?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          sendA2aDelegation(select?.value || '', textarea.value || '');
        }
        if (e.key === 'Escape') e.stopPropagation();
      });
      setTimeout(() => textarea?.focus(), 50);
      return;
    }

    body.innerHTML = `<div class="omnipilot-loading"><div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">${label('delegating')}</span></div>`;

    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      body.innerHTML = `<div class="omnipilot-error">${label('extensionContextUnavailable')}</div>`;
      return;
    }

    runtime.sendMessage(
      { type: 'A2A_DELEGATE_TASK', serverId, task: trimmedTask, contextText: lastSelection || '' },
      response => {
        if (runtime.lastError) {
          body.innerHTML = `<div class="omnipilot-error">${humanizeError(runtime.lastError.message)}</div>`;
          return;
        }
        if (!response || !response.success) {
          body.innerHTML = `<div class="omnipilot-error">${humanizeError(response?.error)}</div>`;
          return;
        }
        conversationHistory.push({ role: 'user', content: trimmedTask, kind: 'a2a-delegation' });
        conversationHistory.push({ role: 'assistant', content: response.result, kind: 'a2a-result' });

        const userMsgHtml = `<div class="omnipilot-msg-container">
          <div class="omnipilot-msg-header omnipilot-msg-header-user">
            <span class="omnipilot-msg-header-avatar">U</span>
            <span>You</span>
          </div>
          <div class="omnipilot-msg omnipilot-msg-user">${escapeHtml(trimmedTask)}</div>
        </div>`;

        const assistantMsgHtml = `<div class="omnipilot-msg-container">
          <div class="omnipilot-msg-header">
            <span class="omnipilot-msg-header-avatar">✦</span>
            <span>OmniPilot</span>
          </div>
          <div class="omnipilot-msg omnipilot-msg-assistant">${formatResult(response.result)}</div>
        </div>`;

        body.innerHTML = `${lastSelection ? renderSelectionContext(lastSelection) : ''}${userMsgHtml}${assistantMsgHtml}`;
      }
    );
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
          runtime.sendMessage({ type: 'SET_MODEL', model });
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

  function showProviderSelector(anchorEl) {
    const existing = document.getElementById('omnipilot-provider-selector');
    if (existing) { existing.remove(); return; }

    const selector = document.createElement('div');
    selector.id = 'omnipilot-provider-selector';
    applyThemeTo(selector);

    getProviderEntries().forEach(({ providerType, label: providerLabel }) => {
      const item = document.createElement('div');
      item.className = 'omnipilot-model-item' + (providerType === currentProviderType ? ' omnipilot-model-current' : '');
      item.textContent = providerLabel;
      item.addEventListener('click', e => {
        e.stopPropagation();
        const runtime = globalThis.chrome?.runtime;
        if (runtime?.sendMessage) {
          runtime.sendMessage({ type: 'SET_PROVIDER', providerType });
        }
        selector.remove();
      });
      selector.appendChild(item);
    });

    document.body.appendChild(selector);

    const rect = anchorEl.getBoundingClientRect();
    selector.style.left = `${rect.left}px`;
    selector.style.top = `${rect.bottom + 4}px`;

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

        // When switching actions from the panel header, keep existing context
        // and run the new action as a continuation, not a fresh session.
        if (action.id && (lastSelection || getActiveSelectionContextText())) {
          runActionInContext(action.id);
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
    if (typeof text !== 'string') return '';

    // Extract and protect <think> blocks for collapsible rendering
    const thinkBlocks = [];
    let formatted = text.replace(/<think>([\s\S]*?)<\/think>/gi, (match, content) => {
      const placeholder = `__OP_THINK_PLACEHOLDER_${thinkBlocks.length}__`;
      thinkBlocks.push(content.trim());
      return placeholder;
    });

    // Extract fenced code blocks: ```lang\ncode\n```
    const blocks = [];
    formatted = formatted.replace(/```(\w*)\n([\s\S]*?)\n```/g, (match, lang, code) => {
      const placeholder = `__OP_CODE_BLOCK_PLACEHOLDER_${blocks.length}__`;
      blocks.push({ lang: lang || 'code', code });
      return placeholder;
    });

    // Protect inline code: `code`
    const inlineCodes = [];
    formatted = formatted.replace(/`([^`\n]+)`/g, (match, code) => {
      const placeholder = `__OP_INLINE_CODE_PLACEHOLDER_${inlineCodes.length}__`;
      inlineCodes.push(code);
      return placeholder;
    });

    // Extract markdown tables before escaping
    const tables = [];
    formatted = formatted.replace(/(?:^|\n)((?:\|[^\n]+\|\s*\n){2,})/gm, (match, tableBlock) => {
      const placeholder = `__OP_TABLE_PLACEHOLDER_${tables.length}__`;
      tables.push(tableBlock.trim());
      return '\n' + placeholder + '\n';
    });

    // Escape HTML
    formatted = escapeHtml(formatted);

    // Markdown Headings: ### text
    formatted = formatted.replace(/^#{3}\s+(.*?)$/gm, '<h4>$1</h4>');
    formatted = formatted.replace(/^#{2}\s+(.*?)$/gm, '<h3>$1</h3>');
    formatted = formatted.replace(/^#{1}\s+(.*?)$/gm, '<h3>$1</h3>');

    // Markdown Links: [text](url)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Strikethrough: ~~text~~
    formatted = formatted.replace(/~~(.*?)~~/g, '<del>$1</del>');

    // Bold: **text**
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic: *text*
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Blockquotes: > text
    formatted = formatted.replace(/^&gt;\s+(.*?)$/gm, '<blockquote>$1</blockquote>');

    // Horizontal rules: --- or ***
    formatted = formatted.replace(/^(---|\*\*\*)$/gm, '<hr>');

    // Unordered lists: - text
    formatted = formatted.replace(/^\s*-\s+(.*?)$/gm, '<ul><li>$1</li></ul>');
    formatted = formatted.replace(/<\/ul>\s*<ul>/g, '');

    // Ordered lists: 1. text
    formatted = formatted.replace(/^\s*\d+\.\s+(.*?)$/gm, '<ol><li>$1</li></ol>');
    formatted = formatted.replace(/<\/ol>\s*<ol>/g, '');

    // Newlines
    formatted = formatted.replace(/\n/g, '<br>');

    // Restore inline codes
    inlineCodes.forEach((code, index) => {
      formatted = formatted.replace(`__OP_INLINE_CODE_PLACEHOLDER_${index}__`, `<code>${escapeHtml(code)}</code>`);
    });

    // Restore tables as HTML tables
    tables.forEach((tableText, index) => {
      const rows = tableText.split('\n').filter(r => r.trim());
      if (rows.length < 2) {
        formatted = formatted.replace(`__OP_TABLE_PLACEHOLDER_${index}__`, escapeHtml(tableText));
        return;
      }
      const parseRow = row => row.split('|').map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length);
      const renderCell = cell => {
        // Restore inline code placeholders that were extracted before the
        // table was captured; escape everything else as plain text.
        const parts = cell.split(/(__OP_INLINE_CODE_PLACEHOLDER_\d+__)/);
        return parts.map(part => {
          const m = part.match(/^__OP_INLINE_CODE_PLACEHOLDER_(\d+)__$/);
          if (m) {
            const code = inlineCodes[Number(m[1])];
            return code !== undefined ? `<code>${escapeHtml(code)}</code>` : escapeHtml(part);
          }
          return escapeHtml(part);
        }).join('');
      };
      const headerCells = parseRow(rows[0]);
      const isSeparator = row => /^\|?[\s\-:|]+\|?$/.test(row);
      const dataStartIdx = isSeparator(rows[1]) ? 2 : 1;
      let tableHtml = '<table class="omnipilot-table"><thead><tr>';
      headerCells.forEach(cell => { tableHtml += `<th>${renderCell(cell)}</th>`; });
      tableHtml += '</tr></thead><tbody>';
      for (let i = dataStartIdx; i < rows.length; i++) {
        const cells = parseRow(rows[i]);
        tableHtml += '<tr>';
        cells.forEach(cell => { tableHtml += `<td>${renderCell(cell)}</td>`; });
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      formatted = formatted.replace(`__OP_TABLE_PLACEHOLDER_${index}__`, tableHtml);
    });

    // Restore code blocks
    blocks.forEach((block, index) => {
      const cardHtml = `<div class="omnipilot-code-block-card">
        <div class="omnipilot-code-block-header">
          <span>${escapeHtml(block.lang)}</span>
          <button class="omnipilot-code-block-copy-btn">Copy</button>
        </div>
        <pre class="omnipilot-code-block-body">${escapeHtml(block.code)}</pre>
      </div>`;
      formatted = formatted.replace(`__OP_CODE_BLOCK_PLACEHOLDER_${index}__`, cardHtml);
    });

    // Restore think blocks as collapsible sections
    thinkBlocks.forEach((content, index) => {
      const thinkHtml = `<details class="omnipilot-think-block" open>
        <summary class="omnipilot-think-summary"><span class="omnipilot-think-icon">💭</span> ${label('thinkingContent')}</summary>
        <div class="omnipilot-think-body">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
      </details>`;
      formatted = formatted.replace(`__OP_THINK_PLACEHOLDER_${index}__`, thinkHtml);
    });

    return formatted;
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── DOM Helpers (avoid innerHTML +=) ───────────────────────────────────────

  function createElementFromHtml(html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    const child = wrapper.children?.[0] || wrapper.firstChild;
    return child || null;
  }

  function appendHtmlToBody(body, html) {
    // Use a temporary container to parse HTML, then move children to body
    // This preserves existing children/listeners unlike innerHTML +=
    const temp = document.createElement('div');
    temp.innerHTML = html.trim();
    // In the real DOM, temp.children is an HTMLCollection; in mocks it's an array
    const children = Array.from(temp.children || []);
    if (children.length > 0) {
      children.forEach(child => body.appendChild(child));
      return children[0];
    }
    // Fallback: if no parsed children, append the HTML directly
    const prevHtml = body.innerHTML || '';
    body.innerHTML = prevHtml + html.trim();
    return null;
  }

  function createLoadingIndicator() {
    const loading = document.createElement('div');
    loading.className = 'omnipilot-loading';
    loading.innerHTML = `<div class="omnipilot-spinner"></div><span class="omnipilot-loading-text">${label('thinking')}</span>`;
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'omnipilot-cancel-btn';
    cancelBtn.setAttribute('title', label('cancel'));
    cancelBtn.setAttribute('aria-label', label('cancel') || 'Cancel');
    cancelBtn.textContent = '✕';
    cancelBtn.addEventListener('click', cancelRequest);
    loading.appendChild(cancelBtn);
    return loading;
  }

  // Remove every spinner in the body, not just the first. A panel can briefly
  // hold more than one loading indicator (e.g. an initial action still resolving
  // when a follow-up starts); terminal stream events must clear them all so no
  // orphan spinner is left behind.
  function removeLoadingIndicators(body) {
    if (!body) return;
    let loading = body.querySelector('.omnipilot-loading');
    let guard = 0;
    while (loading && guard++ < 50) {
      loading.remove();
      loading = body.querySelector('.omnipilot-loading');
    }
  }

  function createUserMessage(text) {
    const container = document.createElement('div');
    container.className = 'omnipilot-msg-container';
    const headerDiv = document.createElement('div');
    headerDiv.className = 'omnipilot-msg-header omnipilot-msg-header-user';
    headerDiv.innerHTML = `<span class="omnipilot-msg-header-avatar">U</span><span>You</span>`;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'omnipilot-msg omnipilot-msg-user';
    msgDiv.textContent = text;
    container.appendChild(headerDiv);
    container.appendChild(msgDiv);
    return container;
  }

  function createAssistantMessage(result) {
    const container = document.createElement('div');
    container.className = 'omnipilot-msg-container';
    const headerDiv = document.createElement('div');
    headerDiv.className = 'omnipilot-msg-header';
    headerDiv.innerHTML = `<span class="omnipilot-msg-header-avatar">✦</span><span>OmniPilot</span>`;

    // Message toolbar: copy + read aloud
    const toolbar = document.createElement('div');
    toolbar.className = 'omnipilot-msg-toolbar';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'omnipilot-msg-toolbar-btn';
    copyBtn.title = label('copyMessage');
    copyBtn.textContent = '📋';
    copyBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(result).then(() => {
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
      });
    });
    toolbar.appendChild(copyBtn);

    const readBtn = document.createElement('button');
    readBtn.className = 'omnipilot-msg-toolbar-btn';
    readBtn.title = label('readAloud');
    readBtn.textContent = '🔊';
    let speaking = false;
    readBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const synth = globalThis.speechSynthesis;
      if (!synth) return;
      if (speaking) {
        synth.cancel();
        speaking = false;
        readBtn.textContent = '🔊';
        return;
      }
      const utterance = new SpeechSynthesisUtterance(result);
      const voices = synth.getVoices();
      let voice;
      if (currentLanguage === 'zh') voice = voices.find(v => v.lang.startsWith('zh'));
      if (!voice) voice = voices.find(v => v.lang.startsWith(currentLanguage));
      if (!voice) voice = voices.find(v => v.lang.startsWith(navigator.language));
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      utterance.onend = () => { speaking = false; readBtn.textContent = '🔊'; };
      utterance.onerror = () => { speaking = false; readBtn.textContent = '🔊'; };
      synth.speak(utterance);
      speaking = true;
      readBtn.textContent = '🔇';
    });
    toolbar.appendChild(readBtn);
    headerDiv.appendChild(toolbar);

    const msgDiv = document.createElement('div');
    msgDiv.className = 'omnipilot-msg omnipilot-msg-assistant';
    msgDiv.innerHTML = formatResult(result);
    container.appendChild(headerDiv);
    container.appendChild(msgDiv);
    // Re-attach copy button handlers for code blocks
    if (container.querySelectorAll) {
      container.querySelectorAll('.omnipilot-code-block-copy-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const codeBody = btn.closest('.omnipilot-code-block-card')?.querySelector('.omnipilot-code-block-body');
          if (codeBody) {
            navigator.clipboard.writeText(codeBody.textContent).then(() => {
              const oldText = btn.textContent;
              btn.textContent = '✓';
              setTimeout(() => { btn.textContent = oldText; }, 1500);
            });
          }
        });
      });
    }
    return container;
  }

  function createErrorElement(message) {
    const el = document.createElement('div');
    el.className = 'omnipilot-error';
    el.innerHTML = message;
    return el;
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

  // Map a background 'status' signal to a localized spinner label. Falls back to
  // the generic thinking label for unknown statuses.
  function statusLabel(status) {
    if (status === 'delegating') return `${label('delegating')}…`;
    return label('thinking');
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
        const cancelled = document.createElement('div');
        cancelled.className = 'omnipilot-cancelled';
        cancelled.textContent = label('cancelled');
        body.appendChild(cancelled);
      }
    }
  }

  // ── Streaming Helpers ──────────────────────────────────────────────────────────

  function createStreamingAssistantMessage() {
    const container = document.createElement('div');
    container.className = 'omnipilot-msg-container';
    const headerDiv = document.createElement('div');
    headerDiv.className = 'omnipilot-msg-header';
    headerDiv.innerHTML = `<span class="omnipilot-msg-header-avatar">✦</span><span>OmniPilot</span>`;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'omnipilot-msg omnipilot-msg-assistant omnipilot-streaming';
    msgDiv.textContent = '';
    container.appendChild(headerDiv);
    container.appendChild(msgDiv);
    return { container, msgDiv };
  }

  function finalizeStreamingMessage(msgDiv) {
    msgDiv.classList.remove('omnipilot-streaming');
    const rawText = msgDiv.textContent;
    msgDiv.innerHTML = formatResult(rawText);
    // Re-attach copy button handlers for code blocks
    const container = msgDiv.closest('.omnipilot-msg-container');
    if (container?.querySelectorAll) {
      container.querySelectorAll('.omnipilot-code-block-copy-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          const codeBody = btn.closest('.omnipilot-code-block-card')?.querySelector('.omnipilot-code-block-body');
          if (codeBody) {
            navigator.clipboard.writeText(codeBody.textContent).then(() => {
              const oldText = btn.textContent;
              btn.textContent = '✓';
              setTimeout(() => { btn.textContent = oldText; }, 1500);
            });
          }
        });
      });
    }
  }

  function streamAction(actionId, text, body) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.connect) {
      body.querySelector('.omnipilot-loading')?.remove();
      body.appendChild(createErrorElement(label('extensionContextUnavailable')));
      return;
    }

    abortController = new AbortController();
    const signal = abortController.signal;

    const port = runtime.connect({ name: 'omnipilot-stream' });
    let accumulated = '';
    let streamingMsg = null;
    let streamMsgDiv = null;

    port.onMessage.addListener(msg => {
      if (signal.aborted) { try { port.disconnect(); } catch {} return; }

      if (msg.type === 'chunk') {
        if (!streamingMsg) {
          body.querySelector('.omnipilot-loading')?.remove();
          const created = createStreamingAssistantMessage();
          streamingMsg = created.container;
          streamMsgDiv = created.msgDiv;
          body.appendChild(streamingMsg);
        }
        accumulated += msg.text;
        streamMsgDiv.textContent = accumulated;
        body.scrollTop = body.scrollHeight;
      } else if (msg.type === 'error') {
        body.querySelector('.omnipilot-loading')?.remove();
        if (!accumulated) {
          body.appendChild(createErrorElement(humanizeError(msg.error || label('unknownError'))));
        }
      } else if (msg.type === 'done') {
        body.querySelector('.omnipilot-loading')?.remove();
        if (accumulated && streamMsgDiv) {
          finalizeStreamingMessage(streamMsgDiv);
          conversationHistory.push({ role: 'assistant', content: accumulated });
        } else if (!accumulated && !body.querySelector('.omnipilot-error')) {
          body.appendChild(createErrorElement(label('noResponse')));
        }
        currentAction = '';
        updatePanelMeta();
        body.scrollTop = body.scrollHeight;
        try { port.disconnect(); } catch {}
      }
    });

    port.onDisconnect.addListener(() => {
      if (!accumulated && !signal.aborted) {
        body.querySelector('.omnipilot-loading')?.remove();
        if (!body.querySelector('.omnipilot-error') && !body.querySelector('.omnipilot-msg-assistant')) {
          body.appendChild(createErrorElement(label('noResponse')));
        }
        currentAction = '';
        updatePanelMeta();
      }
    });

    port.postMessage({ type: 'AI_ACTION_STREAM', action: actionId, text });
  }

  function streamChat(messages, body) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.connect) {
      body.querySelector('.omnipilot-loading')?.remove();
      body.appendChild(createErrorElement(label('extensionContextUnavailable')));
      return;
    }

    abortController = new AbortController();
    const signal = abortController.signal;

    const port = runtime.connect({ name: 'omnipilot-stream' });
    let accumulated = '';
    let streamingMsg = null;
    let streamMsgDiv = null;
    let settled = false;

    // Watchdog: if the service worker is suspended or an A2A delegation hangs,
    // the port can go quiet (or disconnect) without ever sending 'done'. Without
    // this, the spinner would spin forever / vanish silently. Any message resets
    // the timer, so long-but-alive streams and delegations are never cut short.
    let watchdog = null;
    function clearWatchdog() {
      if (watchdog !== null && typeof clearTimeout === 'function') clearTimeout(watchdog);
      watchdog = null;
    }
    function armWatchdog() {
      if (typeof setTimeout !== 'function') return;
      clearWatchdog();
      watchdog = setTimeout(() => {
        if (settled || signal.aborted) return;
        settled = true;
        removeLoadingIndicators(body);
        if (!accumulated && !body.querySelector('.omnipilot-error')) {
          body.appendChild(createErrorElement(label('noResponse')));
        }
        currentAction = '';
        updatePanelMeta();
        try { port.disconnect(); } catch {}
      }, STREAM_WATCHDOG_MS);
      // A watchdog must never keep a process alive on its own. In the browser
      // timer handles are numbers (no-op); under Node's test vm they expose
      // unref(), so a leaked watchdog can't hold the event loop open.
      if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
    }

    port.onMessage.addListener(msg => {
      if (signal.aborted) { try { port.disconnect(); } catch {} return; }
      armWatchdog();

      if (msg.type === 'chunk') {
        if (!streamingMsg) {
          body.querySelector('.omnipilot-loading')?.remove();
          const created = createStreamingAssistantMessage();
          streamingMsg = created.container;
          streamMsgDiv = created.msgDiv;
          body.appendChild(streamingMsg);
        }
        accumulated += msg.text;
        streamMsgDiv.textContent = accumulated;
        body.scrollTop = body.scrollHeight;
      } else if (msg.type === 'status') {
        // Non-streaming step in progress (e.g. delegating to an A2A agent).
        // Keep the spinner but relabel it so the wait is explained.
        const loadingText = body.querySelector('.omnipilot-loading-text');
        if (loadingText) loadingText.textContent = statusLabel(msg.status);
      } else if (msg.type === 'error') {
        removeLoadingIndicators(body);
        if (!accumulated) {
          body.appendChild(createErrorElement(humanizeError(msg.error || label('unknownError'))));
        }
      } else if (msg.type === 'done') {
        settled = true;
        clearWatchdog();
        removeLoadingIndicators(body);
        if (accumulated && streamMsgDiv) {
          finalizeStreamingMessage(streamMsgDiv);
          conversationHistory.push({ role: 'assistant', content: accumulated });
        } else if (!accumulated && !body.querySelector('.omnipilot-error')) {
          body.appendChild(createErrorElement(label('noResponse')));
        }
        currentAction = '';
        updatePanelMeta();
        body.scrollTop = body.scrollHeight;
        try { port.disconnect(); } catch {}
      }
    });

    port.onDisconnect.addListener(() => {
      clearWatchdog();
      if (settled || signal.aborted) return;
      settled = true;
      // Premature disconnect (worker died / crashed before 'done'). Previously
      // this path silently removed the spinner and left the panel blank — the
      // exact silent failure this fix targets. Surface an error instead. Judge
      // "did this turn produce output?" from local state (accumulated /
      // streamMsgDiv), never from body-wide selectors, which also match earlier
      // turns' messages and would wrongly suppress this turn's error.
      removeLoadingIndicators(body);
      if (accumulated && streamMsgDiv) {
        // Partial stream arrived, then the worker vanished: keep what we have.
        finalizeStreamingMessage(streamMsgDiv);
        conversationHistory.push({ role: 'assistant', content: accumulated });
      } else if (!body.querySelector('.omnipilot-error')) {
        body.appendChild(createErrorElement(label('noResponse')));
      }
      currentAction = '';
      updatePanelMeta();
    });

    port.postMessage({ type: 'AI_CHAT_STREAM', messages });
  }

  // ── Action Runner ─────────────────────────────────────────────────────────────

  // Run an action while preserving existing conversation context.
  // Called when switching actions from the panel header selector.
  function runActionInContext(actionId) {
    const text = lastSelection || getActiveSelectionContextText();
    if (!text) return;

    currentAction = actionId;
    updatePanelMeta();

    // Ensure panel is visible
    if (!panel) {
      showPanel('', false, false);
    } else {
      panel.style.display = 'flex';
    }

    const body = panel.querySelector('.omnipilot-panel-body');

    // Add a visual separator showing the action switch
    const actionObj = ACTIONS.find(a => a.id === actionId);
    const actionLabel = actionObj ? `${actionObj.icon} ${label(actionObj.labelKey)}` : actionId;
    const divider = document.createElement('div');
    divider.className = 'omnipilot-action-divider';
    divider.textContent = actionLabel;
    body.appendChild(divider);

    // Add loading indicator
    body.appendChild(createLoadingIndicator());
    body.scrollTop = body.scrollHeight;

    streamAction(actionId, text, body);
  }

  // Run an action as a fresh session (called from the initial dropdown).
  function runAction(actionId) {
    hideDropdown();
    hideBubble();

    // Prefer the live page selection, but fall back to the context already captured
    // in the open panel. A stray page click clears lastSelection, and without this
    // fallback re-running an action from the header selector would silently no-op.
    const text = lastSelection || getActiveSelectionContextText();
    if (!text) return;

    // Set current action and update panel title
    currentAction = actionId;

    const contextId = `selection-context-${++selectionContextSeq}`;
    conversationHistory = [{ role: 'user', content: buildSelectionContextMessage(text), kind: 'selection-context', contextId }];
    lastAppendedSelectionContext = text;

    // Show panel immediately with loading state
    showPanelForConversation(text, contextId);
    updatePanelMeta();
    const body = panel.querySelector('.omnipilot-panel-body');
    body.appendChild(createLoadingIndicator());

    streamAction(actionId, text, body);
  }

  // ── Page Summary ─────────────────────────────────────────────────────────────

  function runPageSummary() {
    hideBubble();
    hideDropdown();

    const pageContent = extractPageContent();
    if (!pageContent) return;

    currentAction = 'summarize-page';

    const contextId = `page-summary-${++selectionContextSeq}`;
    conversationHistory = [{ role: 'user', content: pageContent, kind: 'page-context', contextId }];
    lastAppendedSelectionContext = '';

    // Show panel immediately with loading state
    showPanel('', false, false);
    updatePanelMeta();
    const body = panel.querySelector('.omnipilot-panel-body');

    // Show page summary context indicator
    const pageIndicator = document.createElement('div');
    pageIndicator.className = 'omnipilot-selected-context';
    pageIndicator.textContent = `📄 ${label('summarizingPage')}`;
    body.appendChild(pageIndicator);

    body.appendChild(createLoadingIndicator());

    streamAction('summarize-page', pageContent, body);
  }

  function runGitHubSummary() {
    hideBubble();
    hideDropdown();

    if (!isGitHubIssuePage() && !isGitHubPullPage()) {
      runPageSummary(); // Fallback to page summary
      return;
    }

    const githubContent = extractGitHubIssueContent();
    if (!githubContent) return;

    currentAction = 'summarize-github';

    const contextId = `github-summary-${++selectionContextSeq}`;
    conversationHistory = [{ role: 'user', content: githubContent, kind: 'github-context', contextId }];
    lastAppendedSelectionContext = '';

    showPanel('', false, false);
    updatePanelMeta();
    const body = panel.querySelector('.omnipilot-panel-body');

    const indicator = document.createElement('div');
    indicator.className = 'omnipilot-selected-context';
    indicator.textContent = `🐙 ${label('summarizingGitHub')}`;
    body.appendChild(indicator);

    body.appendChild(createLoadingIndicator());
    streamAction('summarize-github', githubContent, body);
  }

  // ── Context Menu Handler ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'CONTEXT_MENU_ACTION') {
      lastSelection = request.text;
      runAction(request.action);
      sendResponse({ success: true });
      return true;
    }
    if (request.type === 'CONTEXT_MENU_PAGE_SUMMARY') {
      runPageSummary();
      sendResponse({ success: true });
      return true;
    }
    if (request.type === 'CONTEXT_MENU_GITHUB_SUMMARY') {
      runGitHubSummary();
      sendResponse({ success: true });
      return true;
    }
  });

  // ── Selection Detection ───────────────────────────────────────────────────────

  document.addEventListener('mouseup', e => {
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    // Capture whether this mouseup landed on our UI *now*, while the event target
    // is still attached. Handlers on our UI (e.g. removing a context) may detach
    // the target before the delayed check runs, which would otherwise misclassify
    // the click as a page click and re-append the just-removed selection.
    const targetIsOmniPilot = isOmniPilotElement(e.target);
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
        } else if (!targetIsOmniPilot) {
          appendSelectionToConversation(text);
        }
      } else {
        // Check if click was on our UI elements
        if (!targetIsOmniPilot) {
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
      if (panel) { panel.style.display = 'none'; panelPositionFixed = false; lastAppendedSelectionContext = ''; }
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

  globalThis.getProviderLabel = getProviderLabel;
  globalThis.getProviderEntries = getProviderEntries;
  globalThis.__omnipilotTestApi = {
    getDropdownActionIds,
    parseA2aMentionTask
  };

})();
