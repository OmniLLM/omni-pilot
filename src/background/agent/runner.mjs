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
  deadline,
  maxTurns = A2A_MAX_ROUNDS
}) {
  function safeEmit(type, data) { try { onEvent(type, data); } catch {} }

  async function run() {
    let lastSettled = null;
    let apiShape = null;
    let nudged = false;

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
      // Keep the spinner alive across follow-up provider rounds. Round 0 is
      // already covered by the UI's default "Thinking…" label, but later
      // rounds — the nudge round, or a post-dispatch round that only produces
      // text — would otherwise leave a stale "Delegating…" on screen while
      // the model is actually working.
      if (round > 0) onStatus?.('working');
      const response = await fetch(built.requestUrl, {
        method: 'POST',
        headers: built.requestHeaders,
        body: JSON.stringify(requestBody),
        ...(deadline?.signal ? { signal: deadline.signal } : {})
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
        // A model that announces a delegation ("I'll query X for you.") but
        // emits no tool call would otherwise have that preamble returned as
        // the final answer — the user sees an intent with no result. Nudge
        // once to convert the stated intent into an actual call. Bounded by
        // `nudged` so a model that simply has nothing to call still ends the
        // turn normally on the next pass.
        if (content && !nudged && !lastSettled && looksLikeUnfulfilledToolIntent(content)) {
          nudged = true;
          safeEmit('runner.nudge', { round, textLen: content.length });
          session.appendMessage({ role: 'assistant', content });
          session.appendMessage({
            role: 'user',
            content: 'You stated an intent to use a tool but did not emit a tool call. '
              + 'Emit the tool call now, or explain plainly that you cannot. Do not restate the intent.'
          });
          continue;
        }
        if (content) return content;
        if (lastSettled) return renderA2aSettledSections(lastSettled);
        throw new Error('The API returned an empty or unexpected response.');
      }

      const runnable = [];
      const roundSeen = new Set();
      for (const call of toolCalls) {
        const tool = toolRegistry.get(call.toolName);
        if (!tool) continue;
        const parsedArgs = call.parsedArgs && typeof call.parsedArgs === 'object' ? call.parsedArgs : {};
        const hasArgs = Object.keys(parsedArgs).length > 0;
        if (!call.task && !hasArgs) continue;
        const key = `${tool.meta.serverId} ${call.toolName} ${hasArgs ? JSON.stringify(parsedArgs) : call.task}`;
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
          if (!first.task && !Object.keys(first.parsedArgs || {}).length) throw new Error('A2A tool selected empty arguments.');
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

// Heuristic: does this final text read as a stated-but-unfulfilled intent to
// call a tool? Deliberately conservative — it only fires on short text (a real
// answer carries substance) that announces a forthcoming action in the first
// person. Over-matching would burn a round trip and delay a legitimate short
// reply, so ambiguous cases are left alone.
const UNFULFILLED_TOOL_INTENT_RE = new RegExp(
  String.raw`^\s*(?:i(?:'ll| will| am going to)|let me|checking|querying|looking up|fetching|searching)\b`,
  'i'
);
const UNFULFILLED_TOOL_INTENT_MAX_LEN = 240;

function looksLikeUnfulfilledToolIntent(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.length > UNFULFILLED_TOOL_INTENT_MAX_LEN) return false;
  if (!UNFULFILLED_TOOL_INTENT_RE.test(trimmed)) return false;
  // A question is a clarifying request, not an unfulfilled delegation.
  if (trimmed.endsWith('?')) return false;
  return true;
}
