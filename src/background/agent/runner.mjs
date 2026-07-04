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
  maxTurns = A2A_MAX_ROUNDS
}) {
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

      const response = await fetch(built.requestUrl, {
        method: 'POST',
        headers: built.requestHeaders,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (round === 0 && isToolsUnsupportedError(response.status, errorText)) {
          return executeApiRequest({ config, messages: session.messages, systemPrompt });
        }
        throwApiResponseError(response, errorText, built.requestUrl, apiShape, config.model);
      }

      const data = await response.json();
      const toolCalls = extractA2aToolCallsFromResponse(data, apiShape);

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

      const settled = await Promise.all(runnable.map(async ({ call, tool, key }) => {
        session.markDispatched(key);
        try {
          const text = await withA2aStatusHeartbeat(
            toolRegistry.dispatch(call.toolName, { task: call.task }),
            onStatus
          );
          const serverName = tool.meta.serverName || tool.meta.serverId;
          return {
            call,
            server: { id: tool.meta.serverId, name: serverName, agentCard: { name: serverName } },
            tool: { skillName: tool.meta.skillName || '' },
            text,
            error: null
          };
        } catch (error) {
          const serverName = tool.meta.serverName || tool.meta.serverId;
          return {
            call,
            server: { id: tool.meta.serverId, name: serverName, agentCard: { name: serverName } },
            tool: { skillName: tool.meta.skillName || '' },
            text: '',
            error: error?.message || String(error)
          };
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
