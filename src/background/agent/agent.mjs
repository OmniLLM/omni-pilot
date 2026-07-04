// OmniPilot agent primitives — Agent.
//
// High-level entry point. Owns provider selection (loadConfig,
// getCopilotAccessToken when applicable), assembles per-turn context
// via createContextAssembler, and delegates to createRunner (via
// executeApiRequestWithA2aRouting) or the plain executeApiRequestWithConfig.

async function createAgent(overrides = {}) {
  const config = overrides.config || await loadConfig();
  const provider = getProvider(config);
  let copilotToken = '';
  if (provider.usesCopilotAuth) {
    try {
      copilotToken = await getCopilotAccessToken();
      config.apiKey = copilotToken;
    } catch {
      throw new Error('GitHub Copilot authentication failed. Please re-authenticate in Settings.');
    }
  } else if (!config.apiKey) {
    throw new Error('No API key configured. Click the OmniPilot icon to set up.');
  }

  const memory = (config.memoryEnabled === false || !chrome.storage?.local?.set) ? null : createMemory();
  const memoryLongTerm = memory ? await memory.getLongTerm() : '';
  const memoryRecentSections = memory ? await memory.getRecent() : [];
  const maxTokens = Number(config.contextMaxTokens) || CONTEXT_DEFAULT_MAX_TOKENS;

  async function logCompletion({ action, userLen, assistantLen }) {
    if (!memory) return;
    try {
      await memory.appendDailyLog(buildLogEntry({ action, userLen, assistantLen }));
    } catch (error) {
      console.warn('OmniPilot: failed to append daily log', error?.message || error);
    }
  }

  function assembleContext(basePrompt, messages) {
    const asm = createContextAssembler({ maxTokens });
    asm.addSection(10, 'system-prompt', basePrompt);
    if (memoryLongTerm) asm.addSection(20, 'memory-long-term', memoryLongTerm);
    if (memoryRecentSections.length) {
      const recentText = formatRecentActivity(memoryRecentSections);
      asm.addSection(40, 'memory-recent-activity', recentText);
    }
    return asm.buildMessages(messages);
  }

  async function chat(messages) {
    const basePrompt = overrides.systemPrompt || CHAT_SYSTEM_PROMPT;
    const built = assembleContext(basePrompt, messages);
    let result;
    if (shouldAutoRouteA2a(config)) {
      const a2aServers = await ensureEnabledA2aServersDiscovered();
      if (a2aServers.length) {
        result = await executeApiRequestWithA2aRouting({
          config,
          messages: built.messages,
          systemPrompt: built.systemPrompt,
          a2aServers,
          toolSchemas: buildA2aToolSchemas(a2aServers),
          onStatus: overrides.onStatus
        });
      }
    }
    if (result === undefined) {
      result = await executeApiRequestWithConfig({
        config,
        messages: built.messages,
        systemPrompt: built.systemPrompt,
        copilotToken,
        allowModelFallback: provider.usesCopilotAuth
      });
    }
    const userLen = String(messages[messages.length - 1]?.content || '').length;
    const assistantLen = String(result || '').length;
    await logCompletion({ action: 'chat', userLen, assistantLen });
    return result;
  }

  async function action(actionName, text) {
    const basePrompt = ACTION_PROMPTS[actionName];
    if (!basePrompt) throw new Error(`Unknown action: ${actionName}`);
    const messages = [{ role: 'user', content: text }];
    const built = assembleContext(basePrompt, messages);
    const result = await executeApiRequestWithConfig({
      config,
      messages: built.messages,
      systemPrompt: built.systemPrompt,
      copilotToken,
      allowModelFallback: provider.usesCopilotAuth
    });
    await logCompletion({
      action: actionName,
      userLen: String(text || '').length,
      assistantLen: String(result || '').length
    });
    return result;
  }

  return { chat, action, config, memory };
}

function formatRecentActivity(recent) {
  const parts = ['### Recent activity'];
  for (const { date, entries } of recent) {
    parts.push(`- ${date}`);
    for (const entry of entries) parts.push(`  - ${entry}`);
  }
  return parts.join('\n');
}

function buildLogEntry({ action, userLen, assistantLen, now = new Date() }) {
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} action=${action} user_len=${userLen} assistant_len=${assistantLen}`;
}
