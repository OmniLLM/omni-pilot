// OmniPilot - content script
// Detects text selection and shows AI action bubble

import { t, normalizeLanguage } from '../utils/i18n.mjs';
import { createAppearanceController } from '../utils/appearance.mjs';
import { PROVIDER_LABELS, getProviderEntries, ACTIONS } from '../utils/catalog.mjs';
import { renderMarkdown, escapeHtml } from '../utils/markdown.mjs';

(function () {
  'use strict';

  let bubble = null;
  let dropdown = null;
  let panel = null;
  let minimizedOrb = null; // floating icon shown while the panel is minimized
  let panelMinimized = false;
  let lastSelection = '';
  let lastSelectionRect = null;
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
  let streamWatchdogMs = RESPONSE_TIMEOUT_DEFAULT_MS;

  function label(key) {
    return t(key, currentLanguage);
  }

  function applyLanguage(language) {
    currentLanguage = normalizeLanguage(language);
    ensureOmniPilotRoot().lang = currentLanguage;
    updatePanelMeta();
  }

  let omniPilotRoot = null;
  let omniPilotHost = null;

  // The UI lives inside a shadow root so that neither our styles nor the host
  // page's styles can reach across. Before this, dist/styles.css was injected
  // into every page by the manifest, which is why the content script could
  // never safely use a CSS framework.
  function ensureOmniPilotRoot() {
    if (omniPilotRoot?.isConnected === true || (omniPilotRoot?.isConnected === undefined && omniPilotRoot?.parentNode)) {
      return omniPilotRoot;
    }
    if (omniPilotHost?.parentNode) omniPilotHost.remove();
    omniPilotRoot = null;
    omniPilotHost = null;

    omniPilotHost = document.createElement('div');
    omniPilotHost.id = 'omnipilot-extension-host-7f3a9c';
    omniPilotHost.setAttribute('data-omnipilot-owned', 'true');

    // Open, so Playwright locators and debugging still pierce it.
    let mount = omniPilotHost;
    if (typeof omniPilotHost.attachShadow === 'function') {
      const shadow = omniPilotHost.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = typeof OMNIPILOT_CONTENT_CSS === 'string' ? OMNIPILOT_CONTENT_CSS : '';
      shadow.appendChild(style);
      mount = shadow;
    }

    omniPilotRoot = document.createElement('div');
    omniPilotRoot.id = 'omnipilot-extension-root-7f3a9c';
    omniPilotRoot.setAttribute('data-omnipilot-owned', 'true');
    omniPilotRoot.setAttribute('data-appearance-root', '');
    omniPilotRoot.setAttribute('data-surface', 'content');
    omniPilotRoot.setAttribute('data-theme-preference', 'dark');
    omniPilotRoot.setAttribute('data-theme', 'dark');
    omniPilotRoot.setAttribute('data-visual-style', 'current');
    mount.appendChild(omniPilotRoot);

    if (document.body && !omniPilotHost.parentNode) {
      document.body.appendChild(omniPilotHost);
    }
    return omniPilotRoot;
  }

  function getUiMount() {
    return ensureOmniPilotRoot();
  }

  // Our UI lives in a shadow root, so by the time an event reaches a listener on
  // `document` the browser has retargeted `event.target` to the shadow host.
  // `el.contains(e.target)` therefore always reports false for our own elements.
  // `composedPath()` still carries the real inner target, so hit-test with that.
  function eventPathContains(e, el) {
    if (!el) return false;
    const path = typeof e?.composedPath === 'function' ? e.composedPath() : null;
    if (path && path.length) return path.indexOf(el) !== -1;
    return typeof el.contains === 'function' && el.contains(e?.target);
  }

  function loadLanguagePreference() {
    safeStorageGet(chrome.storage?.sync, { languagePreference: 'en' }, config => {
      applyLanguage(config.languagePreference);
    });
  }

  function normalizePopupSizeValue(value, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(min, Math.min(max, parsed));
  }

  // Load config from storage
  safeStorageGet(chrome.storage?.sync, { model: 'claude-sonnet-4-5', endpoint: 'https://api.omnillm.com/v1', apiKey: '', providerType: 'custom-provider', authMethod: 'api-key', popupInitialWidth: null, popupInitialHeight: null, responseTimeoutMs: RESPONSE_TIMEOUT_DEFAULT_MS }, cfg => {
    currentModel = cfg.model || 'claude-sonnet-4-5';
    currentProviderType = normalizeProviderType(cfg.providerType || 'custom-provider');
    currentAuthMethod = cfg.authMethod || 'api-key';
    currentApiKey = cfg.apiKey || '';
    currentEndpoint = cfg.endpoint || '';
    popupInitialWidth = normalizePopupSizeValue(cfg.popupInitialWidth, 300, 1200);
    popupInitialHeight = normalizePopupSizeValue(cfg.popupInitialHeight, 180, 900);
    streamWatchdogMs = normalizeResponseTimeoutMs(cfg.responseTimeoutMs);
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

  loadLanguagePreference();


  safeAddListener(chrome.storage?.onChanged, (changes, areaName) => {
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
    if (changes.languagePreference) applyLanguage(changes.languagePreference.newValue || 'en');
    if (changes.popupInitialWidth) popupInitialWidth = normalizePopupSizeValue(changes.popupInitialWidth.newValue, 300, 1200);
    if (changes.popupInitialHeight) popupInitialHeight = normalizePopupSizeValue(changes.popupInitialHeight.newValue, 180, 900);
    if (changes.responseTimeoutMs) streamWatchdogMs = normalizeResponseTimeoutMs(changes.responseTimeoutMs.newValue);
  });

  function isA2aProviderType(providerType) {
    return typeof providerType === 'string' && providerType.startsWith('a2a:');
  }

  function getA2aServersStorageArea() {
    return chrome.storage.local || chrome.storage.sync;
  }

  function loadA2aServersFromStorage(callback) {
    safeStorageGet(getA2aServersStorageArea(), ['a2aServers'], local => {
      if (Array.isArray(local?.a2aServers)) {
        callback(local.a2aServers);
        return;
      }
      // Fall back to legacy sync storage until options.js migrates it.
      safeStorageGet(chrome.storage?.sync, ['a2aServers'], synced => {
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

  // Elements that carry chrome rather than content. Banners, nav, cookie
  // dialogs and promo strips are what made "summarize this page" occasionally
  // summarize an advertisement instead of the article.
  const BOILERPLATE_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object',
    'nav', 'header', 'footer', 'aside', 'form', 'dialog', 'button', 'select', 'option',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
    '[role="search"]', '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="menubar"]',
    '[role="toolbar"]', '[role="tablist"]', '[aria-hidden="true"]', '[hidden]'
  ].join(',');

  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
    'TABLE', 'TR', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'BLOCKQUOTE', 'PRE', 'BR', 'HR', 'FIGURE', 'FIGCAPTION'
  ]);

  // Below this, a candidate is treated as too thin to be the page's main
  // content — a promo banner or a breadcrumb rather than an article — and the
  // next candidate is tried.
  const MIN_MAIN_CONTENT_CHARS = 400;

  function getElementArea(el) {
    const rect = el.getBoundingClientRect();
    return rect.width * rect.height;
  }

  /**
   * Text of `root` with boilerplate subtrees skipped and block boundaries kept
   * as newlines. Walks the live tree rather than cloning, because `innerText`
   * on a detached clone has no layout and collapses to `textContent`.
   */
  function collectText(root) {
    if (!root || root.nodeType !== 1) return '';
    const out = [];

    const visit = node => {
      if (node.nodeType === 3) {                 // TEXT_NODE
        const text = node.nodeValue;
        if (text && text.trim()) out.push(text.replace(/\s+/g, ' ').trim());
        return;
      }
      if (node.nodeType !== 1) return;           // ELEMENT_NODE
      if (node.matches?.(BOILERPLATE_SELECTOR)) return;
      if (isOmniPilotElement(node)) return;

      const isBlock = BLOCK_TAGS.has(node.tagName);
      if (isBlock) out.push('\n');
      for (let i = 0; i < node.childNodes.length; i++) visit(node.childNodes[i]);
      if (isBlock) out.push('\n');
    };

    visit(root);
    return cleanExtractedText(out.join(' ').replace(/[ \t]*\n[ \t]*/g, '\n'));
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
          const text = collectText(el);
          if (text.length > 50) return truncateContent(text);
        }
        break;
      }
    }

    // Candidates in descending order of how likely they are to BE the content.
    // The first tier carrying enough text wins; the richest seen is kept as a
    // fallback for pages that are legitimately short.
    //
    // Articles form a tier of their own, resolved among themselves before the
    // generic heuristics get a turn. Otherwise a container holding both a promo
    // card and the real article would out-measure the article and win.
    const tiers = [
      [document.querySelector('main')],
      [document.querySelector('[role="main"]')],
      // Not `querySelector('article')` — taking the first article in document
      // order picks up promo and announcement cards that sites place above the
      // real one. Rank them by how much text they actually carry.
      Array.from(document.querySelectorAll('article')),
      [document.querySelector('#main-content'), document.querySelector('#content'), document.querySelector('.content'), document.querySelector('#main')],
      [findLargestContentElement(document.body)],
      [document.body]
    ];

    let best = '';
    for (const tier of tiers) {
      let tierBest = '';
      for (const candidate of tier) {
        if (!candidate) continue;
        const text = collectText(candidate);
        if (text.length > tierBest.length) tierBest = text;
      }
      if (tierBest.length >= MIN_MAIN_CONTENT_CHARS) return truncateContent(tierBest);
      if (tierBest.length > best.length) best = tierBest;
    }

    return best ? truncateContent(best) : '';
  }

  function truncateContent(text) {
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
    getUiMount().appendChild(el);
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

    getUiMount().appendChild(el);
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
      restorePanel();
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
      try { chrome.runtime.openOptionsPage(); }
      catch (err) {
        if (!isExtensionContextInvalidatedError(err)) throw err;
        // Extension context invalidated — nothing else to do; the page has to
        // be refreshed for the extension to work again.
      }
    });
    onboarding.appendChild(btn);

    body.innerHTML = '';
    body.appendChild(onboarding);

    if (!panel.dataset.dragged) {
      positionPanel();
    }
  }

  // ── Session persistence (survive page refresh) ───────────────────────────────
  // The panel is only dismissed when the user explicitly closes it, so its state
  // is mirrored into sessionStorage (per-tab, cleared when the tab closes) and
  // rehydrated on load.

  const SESSION_KEY = 'omnipilot:panel-session:v1';
  let sessionRestoring = false;
  let saveSessionTimer = null;

  function readSessionState() {
    try {
      const raw = window.sessionStorage?.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function clearSessionState() {
    try { window.sessionStorage?.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  function saveSessionState() {
    if (sessionRestoring || !panel) return;
    if (panel.style.display === 'none' && !panelMinimized) return;
    try {
      const body = panel.querySelector('.omnipilot-panel-body');
      const state = {
        minimized: panelMinimized,
        html: body ? body.innerHTML : '',
        history: conversationHistory,
        action: currentAction,
        lastAppendedSelectionContext,
        selectionContextSeq,
        dragged: panel.dataset.dragged === '1',
        userResized: panel.dataset.userResized === '1',
        left: panel.style.left,
        top: panel.style.top,
        width: panel.style.width,
        height: panel.style.height,
        orbLeft: minimizedOrb?.style.left || '',
        orbTop: minimizedOrb?.style.top || ''
      };
      window.sessionStorage?.setItem(SESSION_KEY, JSON.stringify(state));
    } catch { /* quota / serialization issues are non-fatal */ }
  }

  function scheduleSessionSave() {
    if (sessionRestoring) return;
    if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') { saveSessionState(); return; }
    clearTimeout(saveSessionTimer);
    saveSessionTimer = setTimeout(saveSessionState, 250);
  }

  function restoreSessionState() {
    const state = readSessionState();
    if (!state || (!state.html && !(state.history || []).length)) return;

    sessionRestoring = true;
    try {
      conversationHistory = Array.isArray(state.history) ? state.history : [];
      currentAction = state.action || currentAction;
      lastAppendedSelectionContext = state.lastAppendedSelectionContext || '';
      selectionContextSeq = Number(state.selectionContextSeq) || 0;

      showPanel('', false, false);
      const body = panel.querySelector('.omnipilot-panel-body');
      if (body) {
        body.innerHTML = state.html || '';
        // A request that was in flight when the page reloaded is gone — drop any
        // stale spinners so the user is not left staring at one forever.
        removeLoadingIndicators(body);
        body.scrollTop = body.scrollHeight;
      }

      if (state.left) panel.style.left = state.left;
      if (state.top) panel.style.top = state.top;
      if (state.width) panel.style.width = state.width;
      if (state.height) panel.style.height = state.height;
      if (state.dragged) panel.dataset.dragged = '1';
      if (state.userResized) panel.dataset.userResized = '1';
      panelPositionFixed = true;
      updatePanelMeta();

      if (state.minimized) {
        minimizePanel();
        if (state.orbLeft && minimizedOrb) {
          minimizedOrb.style.left = state.orbLeft;
          minimizedOrb.style.top = state.orbTop;
          minimizedOrb.style.right = 'auto';
          minimizedOrb.style.bottom = 'auto';
        }
      }
    } finally {
      sessionRestoring = false;
    }
  }

  // Rehydrate a panel left open before a refresh/navigation in this tab. Must run
  // after the session helpers above are initialized (they use `const` bindings).
  function initSessionRestore() {
    if (document.body) restoreSessionState();
    else document.addEventListener('DOMContentLoaded', restoreSessionState, { once: true });
    window.addEventListener?.('pagehide', saveSessionState);
  }

  // ── Minimize / restore ───────────────────────────────────────────────────────

  function ensureMinimizedOrb() {
    if (minimizedOrb) return minimizedOrb;
    const orb = document.createElement('button');
    orb.id = 'omnipilot-minimized-orb';
    orb.type = 'button';
    orb.innerHTML = '<span class="omnipilot-orb-icon">✦</span>';
    orb.setAttribute('title', label('restorePanel') || 'Restore OmniPilot');
    orb.setAttribute('aria-label', label('restorePanel') || 'Restore OmniPilot');

    // Drag support — click without drag restores the panel.
    let dragging = false;
    let moved = false;
    let offsetX = 0;
    let offsetY = 0;

    orb.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      const rect = orb.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      moved = true;
      const size = orb.offsetWidth || 44;
      const left = Math.max(4, Math.min(window.innerWidth - size - 4, e.clientX - offsetX));
      const top = Math.max(4, Math.min(window.innerHeight - size - 4, e.clientY - offsetY));
      orb.style.left = `${left}px`;
      orb.style.top = `${top}px`;
      orb.style.right = 'auto';
      orb.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (moved) scheduleSessionSave();
      else restorePanel();
    });

    orb.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        restorePanel();
      }
    });

    getUiMount().appendChild(orb);
    minimizedOrb = orb;
    return orb;
  }

  function minimizePanel() {
    if (!panel) return;
    panelMinimized = true;
    panel.style.display = 'none';
    const orb = ensureMinimizedOrb();
    orb.style.display = 'flex';
    saveSessionState();
  }

  function restorePanel() {
    panelMinimized = false;
    if (minimizedOrb) minimizedOrb.style.display = 'none';
    if (panel) panel.style.display = 'flex';
    scheduleSessionSave();
  }

  function hideMinimizedOrb() {
    panelMinimized = false;
    if (minimizedOrb) minimizedOrb.style.display = 'none';
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

      const minimizeBtn = document.createElement('button');
      minimizeBtn.className = 'omnipilot-minimize-btn';
      minimizeBtn.innerHTML = '—';
      minimizeBtn.setAttribute('title', label('minimizePanel') || 'Minimize panel');
      minimizeBtn.setAttribute('aria-label', label('minimizePanel') || 'Minimize panel');
      minimizeBtn.addEventListener('click', e => {
        e.stopPropagation();
        minimizePanel();
      });
      header.appendChild(minimizeBtn);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'omnipilot-close-btn';
      closeBtn.innerHTML = '✕';
      closeBtn.setAttribute('aria-label', label('closePanel') || 'Close panel');
      closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        hideMinimizedOrb();
        conversationHistory = [];
        lastAppendedSelectionContext = '';
        panelPositionFixed = false;
        clearSessionState();
      });
      header.appendChild(closeBtn);

      // Drag support on header
      let dragging = false;
      let dragOffsetX = 0;
      let dragOffsetY = 0;

      header.addEventListener('mousedown', e => {
        if (e.target === closeBtn || e.target === exportBtn || e.target === minimizeBtn || e.target.closest('.omnipilot-panel-title') || e.target.closest('.omnipilot-meta-action-wrap') || e.target.closest('.omnipilot-meta-provider-wrap') || e.target.closest('.omnipilot-meta-model-wrap')) return;
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
          scheduleSessionSave();
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
          scheduleSessionSave();
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
      getUiMount().appendChild(panel);

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

      // Persist panel content whenever it changes so a refresh can rehydrate it.
      if (typeof MutationObserver === 'function') {
        new MutationObserver(scheduleSessionSave).observe(body, { childList: true, subtree: true, characterData: true });
      }
    }

    const body = panel.querySelector('.omnipilot-panel-body');
    restorePanel();
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
      const sent = safeSendMessage(
        runtime,
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
      if (!sent) {
        body.querySelector('.omnipilot-loading')?.remove();
        body.appendChild(createErrorElement(label('extensionContextUnavailable')));
      }
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
    const contextAttr = contextId ? ` data-context-id="${escapeHtml(contextId)}"` : '';
    const removeButton = contextId ? `<button type="button" class="omnipilot-context-remove" data-context-id="${escapeHtml(contextId)}" title="${label('remove')}" aria-label="${label('remove')}">✕</button>` : '';
    return `<div class="omnipilot-selected-context"${contextAttr}><div class="omnipilot-context-header"><span class="omnipilot-context-label">${label('selectedText')}</span>${removeButton}</div><div class="omnipilot-context-text">${escapeHtml(selectedText)}</div></div>`;
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
      restorePanel();
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
      restorePanel();
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

    const sent = safeSendMessage(
      runtime,
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
    if (!sent) {
      body.innerHTML = `<div class="omnipilot-error">${label('extensionContextUnavailable')}</div>`;
    }
  }

  // ── Floating selectors (component-rendered) ───────────────────────────────
  //
  // The action / provider / model chips each open a small floating list. They
  // share one lifecycle (toggle, position below the anchor, dismiss on outside
  // click) and one item shape, so both live here once rather than three times.

  const { html: sHtml, render: sRender, useState: sUseState, useEffect: sUseEffect, useRef: sUseRef } = htmPreact;

  function SelectorItem({ icon, text, current, onChoose }) {
    return sHtml`
      <div
        class=${'omnipilot-model-item' + (current ? ' omnipilot-model-current' : '')}
        onClick=${e => { e.stopPropagation(); onChoose(); }}
      >
        ${icon ? sHtml`<span style="margin-right:6px">${icon}</span>` : null}${text}
      </div>`;
  }

  // Mounts a component into a positioned, dismissable floating host. Returns
  // early (closing the open one) when the same chip is clicked twice.
  function openFloatingSelector({ id, anchorEl, render: renderBody }) {
    const mount = getUiMount();
    const existing = mount.querySelector(`#${id}`);
    if (existing) { existing.remove(); return null; }

    const selector = document.createElement('div');
    selector.id = id;
    mount.appendChild(selector);

    const rect = anchorEl.getBoundingClientRect();
    selector.style.left = `${rect.left}px`;
    selector.style.top = `${rect.bottom + 4}px`;

    const close = () => {
      // Unmount first so component effects are torn down, then detach.
      sRender(null, selector);
      selector.remove();
      document.removeEventListener('mousedown', closeHandler);
    };

    // Our UI is inside a shadow root, so `e.target` seen from `document` is the
    // shadow host. `eventPathContains` looks through the boundary instead.
    const closeHandler = e => {
      if (!eventPathContains(e, selector) && !eventPathContains(e, anchorEl)) close();
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);

    sRender(renderBody(close), selector);
    return { selector, close };
  }

  function ModelSelector({ runtime, onChoose }) {
    const [models, setModels] = sUseState(null);
    const [filter, setFilter] = sUseState('');
    const inputRef = sUseRef(null);

    sUseEffect(() => {
      const sent = safeSendMessage(runtime, { type: 'GET_MODELS' }, response => {
        setModels(response?.models?.length ? response.models : [currentModel]);
        inputRef.current?.focus();
      });
      // Extension context died between opening the panel and clicking the chip.
      // Close rather than leave a permanent "loading models…" spinner.
      if (!sent) onChoose(null);
    }, []);

    const query = filter.toLowerCase();
    const visible = models === null
      ? null
      : (query ? models.filter(m => m.toLowerCase().includes(query)) : models);

    return sHtml`
      <input
        class="omnipilot-model-filter"
        placeholder=${label('typeToFilter')}
        ref=${inputRef}
        value=${filter}
        onInput=${e => setFilter(e.target.value)}
        onMouseDown=${e => e.stopPropagation()}
        onKeyDown=${e => e.stopPropagation()}
      />
      <div class="omnipilot-model-list">
        ${visible === null
          ? sHtml`<div class="omnipilot-model-loading">${label('loadingModels')}</div>`
          : visible.length
            ? visible.map(model => sHtml`
                <${SelectorItem}
                  key=${model}
                  text=${model}
                  current=${model === currentModel}
                  onChoose=${() => onChoose(model)}
                />`)
            : sHtml`<div class="omnipilot-model-loading">${label('noMatches')}</div>`}
      </div>`;
  }

  function showModelSelector(anchorEl) {
    const runtime = globalThis.chrome?.runtime;
    const opened = openFloatingSelector({
      id: 'omnipilot-model-selector',
      anchorEl,
      render: close => sHtml`
        <${ModelSelector}
          runtime=${runtime}
          onChoose=${model => {
            if (model !== null) {
              currentModel = model;
              safeSendMessage(runtime, { type: 'SET_MODEL', model });
              updatePanelMeta();
            }
            close();
          }}
        />`
    });
    // Nothing to fetch models with — don't leave an empty box on screen.
    if (opened && !runtime?.sendMessage) opened.close();
  }

  function showProviderSelector(anchorEl) {
    openFloatingSelector({
      id: 'omnipilot-provider-selector',
      anchorEl,
      render: close => getProviderEntries().map(({ providerType, label: providerLabel }) => sHtml`
        <${SelectorItem}
          key=${providerType}
          text=${providerLabel}
          current=${providerType === currentProviderType}
          onChoose=${() => {
            const runtime = globalThis.chrome?.runtime;
            if (runtime?.sendMessage) safeSendMessage(runtime, { type: 'SET_PROVIDER', providerType });
            close();
          }}
        />`)
    });
  }

  function showActionSelector(anchorEl) {
    const allActions = [
      { id: '', labelKey: 'chat', icon: '💬' },
      ...ACTIONS
    ];

    openFloatingSelector({
      id: 'omnipilot-action-selector',
      anchorEl,
      render: close => allActions.map(action => sHtml`
        <${SelectorItem}
          key=${action.id}
          icon=${action.icon}
          text=${label(action.labelKey)}
          current=${action.id === currentAction}
          onChoose=${() => {
            currentAction = action.id;
            updatePanelMeta();
            close();
            // Switching actions from the panel header keeps existing context and
            // runs the new action as a continuation, not a fresh session.
            if (action.id && (lastSelection || getActiveSelectionContextText())) {
              runActionInContext(action.id);
            }
          }}
        />`)
    });
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

  // Rendering lives in src/utils/markdown.mjs so the side panel formats replies
  // identically. Only the localized <think> label differs per surface.
  function formatResult(text) {
    return renderMarkdown(text, { thinkingLabel: label('thinkingContent') });
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
    if (/extension context invalidated/i.test(s)) return label('extensionContextUnavailable');
    if (/401|403|api key/i.test(s)) return `${label('apiKeyRejected')} <a class="omnipilot-error-link" href="#">${label('checkSettings')}</a>`;
    if (/429|rate.?limit|quota/i.test(s)) return label('rateLimit');
    if (/network|fetch|timeout|ECONNREFUSED/i.test(s)) return label('networkError');
    if (/empty.*response/i.test(s)) return label('emptyResponseError');
    return s;
  }

  // Chrome keeps chrome.runtime defined on the page after the extension is
  // reloaded/updated, but every call into it throws synchronously with
  // "Extension context invalidated." until the page is refreshed. Detect that
  // specific error so callers can surface a "refresh the page" message instead
  // of letting it bubble as an uncaught exception.
  function isExtensionContextInvalidatedError(err) {
    const msg = err && (err.message || err.toString?.() || String(err));
    return typeof msg === 'string' && /extension context invalidated/i.test(msg);
  }

  // Wrap chrome.runtime.sendMessage so a synchronous throw (extension context
  // invalidated) does not bubble to the page. Returns true on success, false
  // when the runtime is invalidated — callers can then render a local error.
  function safeSendMessage(runtime, message, callback) {
    if (!runtime?.sendMessage) return false;
    try {
      runtime.sendMessage(message, callback);
      return true;
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) return false;
      throw err;
    }
  }

  // Wrap chrome.runtime.connect + port.postMessage the same way. Returns the
  // connected port on success, or null if the runtime is invalidated at either
  // step. When postMessage throws after a successful connect, the port is
  // disconnected so no dangling listeners are left behind.
  function safeConnectPort(runtime, connectOpts) {
    if (!runtime?.connect) return null;
    try {
      return runtime.connect(connectOpts);
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) return null;
      throw err;
    }
  }

  function safePortPostMessage(port, message) {
    if (!port) return false;
    try {
      port.postMessage(message);
      return true;
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) {
        try { port.disconnect(); } catch {}
        return false;
      }
      throw err;
    }
  }

  // chrome.storage.sync.get / .local.get and .onChanged.addListener also throw
  // synchronously with "Extension context invalidated." once the extension has
  // been reloaded and the content script is still resident. Wrap all storage
  // reads and the onChanged subscription; also wrap the callback body so a
  // late-firing listener that touches other chrome.* APIs cannot escape as an
  // uncaught error either.
  function safeStorageGet(area, defaults, callback) {
    if (!area || typeof area.get !== 'function') return false;
    try {
      area.get(defaults, function (result) {
        try { callback(result); }
        catch (err) {
          if (!isExtensionContextInvalidatedError(err)) throw err;
        }
      });
      return true;
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) return false;
      throw err;
    }
  }

  function safeAddListener(target, listener) {
    if (!target || typeof target.addListener !== 'function') return false;
    // Wrap the listener so a late-firing invocation whose body touches an
    // invalidated chrome.* API cannot bubble as an uncaught error.
    const wrapped = function () {
      try { return listener.apply(null, arguments); }
      catch (err) {
        if (isExtensionContextInvalidatedError(err)) return undefined;
        throw err;
      }
    };
    try {
      target.addListener(wrapped);
      return true;
    } catch (err) {
      if (isExtensionContextInvalidatedError(err)) return false;
      throw err;
    }
  }

  const appearanceController = createAppearanceController({
    root: ensureOmniPilotRoot(),
    surface: 'content',
    readPreferences(defaults, callback) {
      safeStorageGet(chrome.storage?.sync, defaults, callback);
    },
    subscribeToChanges(listener) {
      let active = true;
      const subscribed = safeAddListener(chrome.storage?.onChanged, (...args) => {
        if (active) listener(...args);
      });
      return subscribed ? () => { active = false; } : undefined;
    },
    matchMedia: typeof globalThis.matchMedia === 'function'
      ? globalThis.matchMedia.bind(globalThis)
      : undefined
  });

  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => {
      const root = ensureOmniPilotRoot();
      if (!root.parentNode) document.body?.appendChild(root);
    }, { once: true });
  }

  // Map a background 'status' signal to a localized spinner label. Falls back to
  // the generic thinking label for unknown statuses.
  function statusLabel(status) {
    if (status === 'delegating') return `${label('delegating')}…`;
    if (status === 'working') return `${label('working')}…`;
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

  // ── Shared Streaming Infrastructure ────────────────────────────────────────
  //
  // createStreamPort extracts the common port lifecycle (connect, chunk/error/done
  // listeners, abort, disconnect) shared by streamAction and streamChat.
  // Options:
  //   useWatchdog  — arm a watchdog timer that fires if no messages arrive within streamWatchdogMs
  //   onStatus     — optional handler for 'status' messages (A2A delegation progress)

  function createStreamPort(body, { useWatchdog = false, onStatus } = {}) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.connect) {
      removeLoadingIndicators(body);
      body.appendChild(createErrorElement(label('extensionContextUnavailable')));
      return null;
    }

    abortController = new AbortController();
    const signal = abortController.signal;

    // runtime.connect() throws synchronously with "Extension context invalidated"
    // after the extension has been reloaded/updated while this content script is
    // still resident in the page. Surface that as a localized in-panel error
    // instead of letting it bubble as an uncaught exception (dist/content.js:2010
    // in the original crash trace).
    const port = safeConnectPort(runtime, { name: 'omnipilot-stream' });
    if (!port) {
      // The runtime is dead — every pending spinner in this panel will hang
      // forever, so clear them all along with the fresh one for this stream.
      removeLoadingIndicators(body);
      body.appendChild(createErrorElement(label('extensionContextUnavailable')));
      return null;
    }
    let accumulated = '';
    let streamingMsg = null;
    let streamMsgDiv = null;
    let settled = false;

    let watchdog = null;
    function clearWatchdog() {
      if (watchdog !== null && typeof clearTimeout === 'function') clearTimeout(watchdog);
      watchdog = null;
    }
    function armWatchdog() {
      if (!useWatchdog || typeof setTimeout !== 'function') return;
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
      }, streamWatchdogMs);
      if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
    }

    port.onMessage.addListener(msg => {
      if (signal.aborted) { try { port.disconnect(); } catch {} return; }
      if (settled) return;
      if (useWatchdog) armWatchdog();

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
      } else if (msg.type === 'status' && onStatus) {
        onStatus(msg);
      } else if (msg.type === 'error') {
        settled = true;
        clearWatchdog();
        removeLoadingIndicators(body);
        if (accumulated && streamMsgDiv) {
          finalizeStreamingMessage(streamMsgDiv);
          conversationHistory.push({ role: 'assistant', content: accumulated, incomplete: true });
        }
        body.appendChild(createErrorElement(humanizeError(msg.error || label('unknownError'))));
        currentAction = '';
        updatePanelMeta();
        body.scrollTop = body.scrollHeight;
        try { port.disconnect(); } catch {}
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
      removeLoadingIndicators(body);
      if (accumulated && streamMsgDiv) {
        finalizeStreamingMessage(streamMsgDiv);
        conversationHistory.push({ role: 'assistant', content: accumulated });
      } else if (!body.querySelector('.omnipilot-error')) {
        body.appendChild(createErrorElement(label('noResponse')));
      }
      currentAction = '';
      updatePanelMeta();
    });

    return port;
  }

  function streamAction(actionId, text, body) {
    const port = createStreamPort(body);
    if (!port) return;
    const sent = safePortPostMessage(port, { type: 'AI_ACTION_STREAM', action: actionId, text });
    if (!sent) {
      removeLoadingIndicators(body);
      if (!body.querySelector('.omnipilot-error')) {
        body.appendChild(createErrorElement(label('extensionContextUnavailable')));
      }
    }
  }

  function streamChat(messages, body) {
    const port = createStreamPort(body, {
      useWatchdog: true,
      onStatus: msg => {
        const loadingText = body.querySelector('.omnipilot-loading-text');
        if (loadingText) loadingText.textContent = statusLabel(msg.status);
      }
    });
    if (!port) return;
    const sent = safePortPostMessage(port, { type: 'AI_CHAT_STREAM', messages });
    if (!sent) {
      removeLoadingIndicators(body);
      if (!body.querySelector('.omnipilot-error')) {
        body.appendChild(createErrorElement(label('extensionContextUnavailable')));
      }
    }
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
      restorePanel();
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

  chrome.runtime?.onMessage && safeAddListener(chrome.runtime.onMessage, (request, sender, sendResponse) => {
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
    // Asked by the side panel so it can talk about the page the user is on.
    if (request.type === 'GET_PAGE_CONTEXT') {
      sendResponse({
        success: true,
        title: document.title || '',
        url: location.href,
        content: extractPageContent() || ''
      });
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
      el.closest?.('#omnipilot-panel') ||
      el.closest?.('#omnipilot-extension-root-7f3a9c')
    );
  }

  // Expose test helpers only in the vm sandbox (Node test runner), not
  // in production where globalThis === window and these would leak to
  // the page. The Node test runner installs its own mock `window` on
  // the vm context, so `typeof window === 'undefined'` is NOT a
  // reliable discriminator — check `globalThis !== window` instead.
  if (typeof globalThis === 'undefined' || typeof window === 'undefined' || globalThis !== window) {
    globalThis.getProviderLabel = getProviderLabel;
    globalThis.getProviderEntries = getProviderEntries;
    globalThis.__omnipilotTestApi = {
      getDropdownActionIds,
      parseA2aMentionTask
    };
  }

  initSessionRestore();
})();
