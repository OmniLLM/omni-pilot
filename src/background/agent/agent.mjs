// OmniPilot agent primitives — Agent.
//
// High-level entry point. Owns provider selection (loadConfig,
// getCopilotAccessToken when applicable), assembles a ToolRegistry
// from currently-enabled A2A servers when auto-routing is on, and
// delegates the loop to createRunner. When memoryEnabled is on
// (default), loads long-term + daily-log memory and prepends a
// Memory block to the system prompt, then appends one log entry
// per completed chat/action.

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
  const memoryPrefix = memory ? (await memory.summary()) : '';

  function combinedSystemPrompt(base) {
    if (!memoryPrefix) return base;
    return `${memoryPrefix}\n\n${base}`;
  }

  async function chat(messages) {
    const systemPrompt = combinedSystemPrompt(overrides.systemPrompt || CHAT_SYSTEM_PROMPT);
    let result;
    if (shouldAutoRouteA2a(config)) {
      const a2aServers = await ensureEnabledA2aServersDiscovered();
      if (a2aServers.length) {
        result = await executeApiRequestWithA2aRouting({
          config,
          messages,
          systemPrompt,
          a2aServers,
          toolSchemas: buildA2aToolSchemas(a2aServers),
          onStatus: overrides.onStatus
        });
      }
    }
    if (result === undefined) {
      result = await executeApiRequestWithConfig({
        config,
        messages,
        systemPrompt,
        copilotToken,
        allowModelFallback: provider.usesCopilotAuth
      });
    }
    if (memory) {
      const userLen = String(messages[messages.length - 1]?.content || '').length;
      const assistantLen = String(result || '').length;
      await memory.appendDailyLog(buildLogEntry({ action: 'chat', userLen, assistantLen }));
    }
    return result;
  }

  async function action(actionName, text) {
    const basePrompt = ACTION_PROMPTS[actionName];
    if (!basePrompt) throw new Error(`Unknown action: ${actionName}`);
    const systemPrompt = combinedSystemPrompt(basePrompt);
    const result = await executeApiRequestWithConfig({
      config,
      messages: [{ role: 'user', content: text }],
      systemPrompt,
      copilotToken,
      allowModelFallback: provider.usesCopilotAuth
    });
    if (memory) {
      await memory.appendDailyLog(buildLogEntry({
        action: actionName,
        userLen: String(text || '').length,
        assistantLen: String(result || '').length
      }));
    }
    return result;
  }

  return { chat, action, config, memory };
}

function buildLogEntry({ action, userLen, assistantLen, now = new Date() }) {
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} action=${action} user_len=${userLen} assistant_len=${assistantLen}`;
}
