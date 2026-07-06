// OmniPilot agent primitives — Runner.
//
// The think-act-observe agentic loop from the harness guide. Every user
// turn is one Runner.run() invocation which drives up to `maxTurns`
// LLM<->tool cycles. Terminates when the model produces final text with
// no tool calls, when every call in a round is a duplicate of a prior
// dispatch, or when the round cap is hit (in which case the last
// fanned-out tool result is rendered as the answer).
//
// The Runner is transport-agnostic — it delegates request building /
// call extraction / body decoration to free functions currently living
// in index.mjs (buildApiRequest, extractA2aToolCallsFromResponse,
// applyA2aToolsToRequestBody). Phase 4 wraps toolRegistry.dispatch to
// enforce guardrails; phase 5 attaches an onEvent callback for tracing.

function createRunner({
  config,
  copilotToken = '',
  systemPrompt,
  toolRegistry,
  session,
  onStatus,
  onEvent = () => {},
  maxTurns = A2A_MAX_ROUNDS
}) {
  function safeEmit(type, data) { try { onEvent(type, data); } catch {} }

  async function run() {
    let lastSettled = null;
    let apiShape = null;

    for (let round = 0; round < maxTurns; round += 1) {
      const built = buildApiRequest({
        config,
        messages: session.messages,
        systemPrompt,
        copilotToken
      });
      apiShape = built.apiShape;
      const toolSchemas = toolRegistry.schemasFor(apiShape);
      const requestBody = toolSchemas.length
        ? applyA2aToolsToRequestBody(built.requestBody, apiShape, toolSchemas)
        : built.requestBody;

      safeEmit('provider.request', { requestUrl: built.requestUrl, apiShape, model: config.model, round });
      const response = await fetch(built.requestUrl, {
        method: 'POST',
        headers: built.requestHeaders,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (round === 0 && isToolsUnsupportedError(response.status, errorText)) {
          // Tools rejected by provider — retry without tools so the model
          // can at least produce a text response. It won't be able to call
          // the hub, but the user gets *some* answer instead of a 400.
          safeEmit('provider.tools_unsupported', { status: response.status, body: errorText.slice(0, 200) });
          try {
            return await executeApiRequest({ config, messages: session.messages, systemPrompt });
          } catch (fallbackErr) {
            // Both attempts failed — surface a helpful error explaining that
            // the current model/provider can't handle tool-augmented requests.
            throw new Error(
              `Provider rejected tools (${response.status}) and no-tools fallback also failed: ${fallbackErr?.message || fallbackErr}. `
              + 'Try switching to a different model, or disable A2A auto-routing in settings.'
            );
          }
        }
        throwApiResponseError(response, errorText, built.requestUrl, apiShape, config.model);
      }

      const data = await response.json();
      const toolCalls = extractA2aToolCallsFromResponse(data, apiShape);
      safeEmit('provider.response', { round, toolCallCount: toolCalls.length, textLen: (built.parseContent(data) || '').length });

      if (!toolCalls.length) {
        const content = built.parseContent(data);
        if (content) return content;
        if (lastSettled) return renderA2aSettledSections(lastSettled);
        throw new Error('The API returned an empty or unexpected response.');
      }

      const runnable = [];
      const roundSeen = new Set();
      for (const call of toolCalls) {
        const tool = toolRegistry.get(call.toolName);
        if (!tool) continue;
        if (!call.task) continue;
        const key = `${tool.meta.serverId} ${call.task}`;
        if (roundSeen.has(key)) continue;
        if (session.hasDispatched(key)) continue;
        roundSeen.add(key);
        runnable.push({ call, tool, key });
      }

      if (!runnable.length) {
        if (round === 0) {
          const first = toolCalls[0];
          const tool = toolRegistry.get(first.toolName);
          if (!tool) throw new Error('A2A tool selected an unknown server.');
          if (!first.task) throw new Error('A2A tool selected an empty task.');
        }
        break;
      }

      onStatus?.('delegating');

      /*
       * TRANSITIONAL compatibility shim: settled A2A results are still rebuilt into
       * the legacy { call, server, tool, text, error } shape consumed today by
       * renderA2aSettledSections() and buildA2aFollowUpMessages(). That shape was
       * carried over from the pre-restructure inline code path.
       *
       * A future phase should either migrate those helpers to consume Tool.meta
       * directly, or formalize a SettledResult type in agent/ that owns this
       * compatibility shape explicitly.
       *
       * Future callers must not rely on the synthetic server.agentCard.name field;
       * read Tool.meta.serverName instead.
       */
      function buildSettledEntry(call, tool, text, error) {
        const serverName = tool.meta.serverName || tool.meta.serverId;
        return {
          call,
          server: { id: tool.meta.serverId, name: serverName, agentCard: { name: serverName } },
          tool: { skillName: tool.meta.skillName || '' },
          text,
          error
        };
      }

      const settled = await Promise.all(runnable.map(async ({ call, tool, key }) => {
        session.markDispatched(key);
        safeEmit('tool.dispatch', { toolName: call.toolName, serverId: tool.meta.serverId });
        try {
          // Pass all parsed arguments — meta-tools (hub invoke_skill) need
          // skill_id in addition to task; standard tools ignore extra fields.
          const dispatchArgs = call.parsedArgs || { task: call.task };
          const text = await withA2aStatusHeartbeat(
            toolRegistry.dispatch(call.toolName, dispatchArgs),
            onStatus
          );
          const entry = buildSettledEntry(call, tool, text, null);
          safeEmit('tool.result', { toolName: call.toolName, ok: true, textLen: (entry.text || '').length, error: entry.error });
          return entry;
        } catch (error) {
          const entry = buildSettledEntry(call, tool, '', error?.message || String(error));
          safeEmit('tool.result', { toolName: call.toolName, ok: false, textLen: (entry.text || '').length, error: entry.error });
          return entry;
        }
      }));

      lastSettled = settled;
      session.appendFollowUp(apiShape, data, settled);
    }

    if (lastSettled) return renderA2aSettledSections(lastSettled);
    throw new Error('Runner exceeded maxTurns without producing a response.');
  }

  return { run };
}
