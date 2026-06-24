(function () {
  'use strict';

  const DEFAULT_LANGUAGE = 'en';
  const SUPPORTED_LANGUAGES = ['en', 'zh'];

  const MESSAGES = {
    en: {
      apiEndpoint: 'API Endpoint',
      apiFormat: 'API Format',
      apiKey: 'API Key',
      apiKeyNotSet: 'API key not set',
      apiKeyRejected: 'Your API key was rejected.',
      askFollowUp: 'Ask a follow-up question...',
      authMethod: 'Authentication',
      cancel: 'Cancel',
      cancelled: 'Cancelled',
      chat: 'Chat',
      checkSettings: 'Check Settings',
      checking: 'Checking…',
      connection: 'Connection',
      copilotCodeCopied: 'Code copied! Paste it on the GitHub page.',
      copilotConnected: 'Connected to GitHub',
      copilotError: 'Error:',
      copilotExpired: 'Code expired. Please try again.',
      copilotFailed: 'Authorization failed. Please try again.',
      copilotGoTo: 'Go to',
      copilotAndEnter: 'and enter:',
      copilotNotConnected: 'Not connected',
      copilotSignIn: 'Sign in with GitHub',
      copilotSignOut: 'Sign out',
      copilotStarting: 'Starting…',
      copilotWaiting: 'Waiting for authorization…',
      dark: 'Dark',
      defaultApiShapeHint: 'Default is OpenAI-compatible. Choose Anthropic or Responses only when your provider supports that API shape.',
      emptyResponseError: 'The model returned an empty response. Try a different model.',
      endpointHint: 'Use the provider base URL, such as http://localhost:5000/v1. The API format below controls the request shape.',
      enterModelManually: 'Enter model name manually',
      errorPrefix: 'Error:',
      explain: 'Explain',
      explaining: 'Explaining',
      extensionContextUnavailable: 'Extension context unavailable. Refresh the page.',
      fetchModels: 'Fetch models',
      fetchingModels: 'Fetching models…',
      improve: 'Improve',
      improving: 'Improving',
      language: 'Language',
      light: 'Light',
      loadingModels: 'Loading models…',
      model: 'Model',
      networkError: 'Network error. Check your connection and endpoint.',
      noMatches: 'No matches',
      noResponse: 'No response. Try refreshing the page.',
      ready: 'Ready',
      rateLimit: 'Rate limit reached. Wait a moment and try again.',
      save: 'Save',
      saved: '✓ Saved',
      selectTextDesc: 'Select text on any page for AI actions.',
      selectedText: 'Selected text:',
      settings: 'Settings',
      setupApiKey: 'Set up API key',
      somethingWrong: 'Something went wrong. Try again.',
      summarize: 'Summarize',
      summarizing: 'Summarizing',
      theme: 'Theme',
      thinking: 'Thinking…',
      toggleDarkMode: 'Toggle dark mode',
      translate: 'Translate',
      translating: 'Translating',
      typeToFilter: 'Type to filter…',
      unknownError: 'Unknown error'
    },
    zh: {
      apiEndpoint: 'API 端点',
      apiFormat: 'API 格式',
      apiKey: 'API 密钥',
      apiKeyNotSet: '未设置 API 密钥',
      apiKeyRejected: '你的 API 密钥被拒绝。',
      askFollowUp: '询问后续问题...',
      authMethod: '认证方式',
      cancel: '取消',
      cancelled: '已取消',
      chat: '聊天',
      checkSettings: '检查设置',
      checking: '检查中…',
      connection: '连接',
      copilotCodeCopied: '验证码已复制！请在 GitHub 页面粘贴。',
      copilotConnected: '已连接 GitHub',
      copilotError: '错误：',
      copilotExpired: '验证码已过期。请重试。',
      copilotFailed: '授权失败。请重试。',
      copilotGoTo: '前往',
      copilotAndEnter: '并输入：',
      copilotNotConnected: '未连接',
      copilotSignIn: '使用 GitHub 登录',
      copilotSignOut: '退出登录',
      copilotStarting: '启动中…',
      copilotWaiting: '等待授权…',
      dark: '深色',
      defaultApiShapeHint: '默认使用 OpenAI 兼容格式。仅当提供商支持时才选择 Anthropic 或 Responses。',
      emptyResponseError: '模型返回了空响应。请尝试其他模型。',
      endpointHint: '使用提供商基础 URL，例如 http://localhost:5000/v1。下面的 API 格式会控制请求结构。',
      enterModelManually: '手动输入模型名称',
      errorPrefix: '错误：',
      explain: '解释',
      explaining: '解释中',
      extensionContextUnavailable: '扩展上下文不可用。请刷新页面。',
      fetchModels: '获取模型',
      fetchingModels: '正在获取模型…',
      improve: '润色',
      improving: '润色中',
      language: '语言',
      light: '浅色',
      loadingModels: '正在加载模型…',
      model: '模型',
      networkError: '网络错误。请检查连接和端点。',
      noMatches: '无匹配项',
      noResponse: '没有响应。请尝试刷新页面。',
      ready: '就绪',
      rateLimit: '已达到速率限制。请稍后重试。',
      save: '保存',
      saved: '✓ 已保存',
      selectTextDesc: '在任意页面选择文本即可使用 AI 操作。',
      selectedText: '已选文本：',
      settings: '设置',
      setupApiKey: '设置 API 密钥',
      somethingWrong: '出了点问题。请重试。',
      summarize: '总结',
      summarizing: '总结中',
      theme: '主题',
      thinking: '思考中…',
      toggleDarkMode: '切换深色模式',
      translate: '翻译',
      translating: '翻译中',
      typeToFilter: '输入以筛选…',
      unknownError: '未知错误'
    }
  };

  function normalizeLanguage(language) {
    return SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
  }

  function t(key, language = DEFAULT_LANGUAGE) {
    const normalized = normalizeLanguage(language);
    return MESSAGES[normalized][key] || MESSAGES[DEFAULT_LANGUAGE][key] || key;
  }

  function applyTranslations(root, language = DEFAULT_LANGUAGE) {
    const normalized = normalizeLanguage(language);

    root.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n, normalized);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder, normalized);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle, normalized);
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel, normalized));
    });
  }

  globalThis.OmniPilotI18n = {
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    MESSAGES,
    normalizeLanguage,
    t,
    applyTranslations
  };
})();
