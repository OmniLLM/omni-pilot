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
  const recorder = config.observabilityEnabled === false ? createNoopTraceRecorder() : createTraceRecorder();
  const maxTokens = Number(config.contextMaxTokens) || CONTEXT_DEFAULT_MAX_TOKENS;

  async function logCompletion({ action, userLen, assistantLen }) {
    if (!memory) return;
    try {
      await memory.appendDailyLog(buildLogEntry({ action, userLen, assistantLen }));
      recorder.event('memory.append', { ok: true });
    } catch (error) {
      recorder.event('memory.append', { ok: false });
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
    recorder.startRun('chat');
    try {
      const basePrompt = overrides.systemPrompt || CHAT_SYSTEM_PROMPT;
      const built = assembleContext(basePrompt, messages);
      recorder.event('context.built', {
        tokens: built.systemPrompt.length,
        dropped: built.dropped.map(d => d.name)
      });
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
            onStatus: overrides.onStatus,
            onEvent: (type, data) => recorder.event(type, data)
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
        recorder.event('provider.request', {
          requestUrl: buildApiRequest({ config, messages: built.messages, systemPrompt: built.systemPrompt, copilotToken, tools: [] }).requestUrl,
          apiShape: config.apiShape || inferApiShape(config.endpoint),
          model: config.model,
          round: 0
        });
        recorder.event('provider.response', {
          round: 0,
          toolCallCount: 0,
          textLen: String(result || '').length
        });
      }
      const userLen = String(messages[messages.length - 1]?.content || '').length;
      const assistantLen = String(result || '').length;
      await logCompletion({ action: 'chat', userLen, assistantLen });
      await recorder.endRun('ok');
      return result;
    } catch (error) {
      recorder.event('error', { message: error?.message || String(error) });
      await recorder.endRun('error');
      throw error;
    }
  }

  async function chatStreaming({ messages, onChunk, onStatus, onDone, onError }) {
    recorder.startRun('chat-streaming');
    try {
      const basePrompt = overrides.systemPrompt || CHAT_SYSTEM_PROMPT;
      const built = assembleContext(basePrompt, messages);
      recorder.event('context.built', {
        tokens: built.systemPrompt.length,
        dropped: built.dropped.map(d => d.name)
      });

      if (shouldAutoRouteA2a(config)) {
        let a2aServers = [];
        try {
          a2aServers = await ensureEnabledA2aServersDiscovered();
        } catch (error) {
          console.warn(`OmniPilot A2A discovery failed; streaming without tools: ${error?.message || error}`);
        }
        if (a2aServers.length) {
          const result = await withA2aDelegationTimeout(executeApiRequestWithA2aRouting({
            config,
            messages: built.messages,
            systemPrompt: built.systemPrompt,
            a2aServers,
            toolSchemas: buildA2aToolSchemas(a2aServers),
            onStatus,
            onEvent: (type, data) => recorder.event(type, data)
          }));
          onChunk(result);
          onDone();
          await logCompletion({
            action: 'chat-streaming',
            userLen: String(messages[messages.length - 1]?.content || '').length,
            assistantLen: String(result || '').length
          });
          await recorder.endRun('ok');
          return;
        }
      }

      let ended = false;
      recorder.event('provider.request', {
        requestUrl: buildStreamingApiRequest({ config, messages: built.messages, systemPrompt: built.systemPrompt, copilotToken }).requestUrl,
        apiShape: config.apiShape || inferApiShape(config.endpoint),
        model: config.model,
        round: 0
      });
      const wrappedDone = () => {
        if (ended) return;
        ended = true;
        recorder.event('provider.response', {
          round: 0,
          toolCallCount: 0,
          textLen: 0
        });
        logCompletion({
          action: 'chat-streaming',
          userLen: String(messages[messages.length - 1]?.content || '').length,
          assistantLen: 0
        }).finally(() => recorder.endRun('ok').then(() => onDone()));
      };
      const wrappedError = (msg) => {
        if (ended) return;
        ended = true;
        recorder.event('error', { message: msg });
        recorder.endRun('error').then(() => onError(msg));
      };
      await executeApiRequestStreaming({
        config,
        messages: built.messages,
        systemPrompt: built.systemPrompt,
        onChunk,
        onDone: wrappedDone,
        onError: wrappedError
      });
    } catch (error) {
      const msg = error?.message || String(error);
      recorder.event('error', { message: msg });
      await recorder.endRun('error');
      onError(msg);
    }
  }

  async function action(actionName, text) {
    recorder.startRun('action');
    try {
      const basePrompt = ACTION_PROMPTS[actionName];
      if (!basePrompt) throw new Error(`Unknown action: ${actionName}`);
      const messages = [{ role: 'user', content: text }];
      const built = assembleContext(basePrompt, messages);
      recorder.event('context.built', {
        tokens: built.systemPrompt.length,
        dropped: built.dropped.map(d => d.name)
      });
      const result = await executeApiRequestWithConfig({
        config,
        messages: built.messages,
        systemPrompt: built.systemPrompt,
        copilotToken,
        allowModelFallback: provider.usesCopilotAuth
      });
      recorder.event('provider.request', {
        requestUrl: buildApiRequest({ config, messages: built.messages, systemPrompt: built.systemPrompt, copilotToken, tools: [] }).requestUrl,
        apiShape: config.apiShape || inferApiShape(config.endpoint),
        model: config.model,
        round: 0
      });
      recorder.event('provider.response', {
        round: 0,
        toolCallCount: 0,
        textLen: String(result || '').length
      });
      await logCompletion({
        action: actionName,
        userLen: String(text || '').length,
        assistantLen: String(result || '').length
      });
      await recorder.endRun('ok');
      return result;
    } catch (error) {
      recorder.event('error', { message: error?.message || String(error) });
      await recorder.endRun('error');
      throw error;
    }
  }

  return { chat, action, chatStreaming, config, memory };
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
