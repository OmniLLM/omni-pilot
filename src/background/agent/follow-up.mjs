// OmniPilot agent primitives — follow-up message construction.
//
// After an agentic-loop round dispatches tools, the assistant turn plus
// per-call tool_result messages must be appended to the conversation
// before the next model call. Each API shape has its own convention:
// OpenAI Chat wants a tool-role message per call; Anthropic wants a
// user-role message containing tool_result blocks; OpenAI Responses
// wants function_call_output items appended to the flat input list.

function buildA2aFollowUpMessages(apiShape, data, settled) {
  if (apiShape === API_SHAPES.ANTHROPIC_MESSAGES) {
    const assistantContent = Array.isArray(data?.content) ? data.content : [];
    const userContent = settled.map(({ call, text, error }) => ({
      type: 'tool_result',
      tool_use_id: call.id,
      content: error ? `A2A delegation failed: ${error}` : (text || ''),
      ...(error ? { is_error: true } : {})
    }));
    return [
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: userContent }
    ];
  }

  if (apiShape === API_SHAPES.OPENAI_RESPONSES) {
    const items = Array.isArray(data?.output) ? data.output : [];
    const outputs = settled.map(({ call, text, error }) => ({
      type: 'function_call_output',
      call_id: call.id,
      output: error ? `A2A delegation failed: ${error}` : (text || '')
    }));
    return [...items, ...outputs];
  }

  const assistantMessage = data?.choices?.[0]?.message || {};
  const toolMessages = settled.map(({ call, text, error }) => ({
    role: 'tool',
    tool_call_id: call.id,
    content: error ? `A2A delegation failed: ${error}` : (text || '')
  }));
  return [
    {
      role: 'assistant',
      content: assistantMessage.content ?? null,
      ...(Array.isArray(assistantMessage.tool_calls) ? { tool_calls: assistantMessage.tool_calls } : {})
    },
    ...toolMessages
  ];
}
