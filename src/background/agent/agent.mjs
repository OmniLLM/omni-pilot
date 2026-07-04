// OmniPilot agent primitives — Agent.
//
// High-level entry point. Owns provider selection (loadConfig,
// getCopilotAccessToken when applicable), assembles a ToolRegistry
// from currently-enabled A2A servers when auto-routing is on, and
// delegates the loop to createRunner.
//
// The existing chrome runtime handlers (handleAIChat / handleAIAction
// / handleAIChatStreaming) become thin wrappers that build an Agent.
// Streaming remains outside the Runner in this phase.

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

  async function chat(messages) {
    const systemPrompt = overrides.systemPrompt || CHAT_SYSTEM_PROMPT;
    if (shouldAutoRouteA2a(config)) {
      const a2aServers = await ensureEnabledA2aServersDiscovered();
      if (a2aServers.length) {
        return await executeApiRequestWithA2aRouting({
          config,
          messages,
          systemPrompt,
          a2aServers,
          toolSchemas: buildA2aToolSchemas(a2aServers),
          onStatus: overrides.onStatus
        });
      }
    }
    return await executeApiRequest({ config, messages, systemPrompt });
  }

  async function action(actionName, text) {
    const systemPrompt = ACTION_PROMPTS[actionName];
    if (!systemPrompt) throw new Error(`Unknown action: ${actionName}`);
    return await executeApiRequest({
      config,
      messages: [{ role: 'user', content: text }],
      systemPrompt
    });
  }

  return { chat, action, config, copilotToken };
}
