// Send only public progress metadata to the transcript. Trace payloads can
// include URLs, arguments and errors, so never forward a recorder event whole.
function publicRequestActivity(type, data = {}) {
  if (type === 'tool.details') {
    return {
      type, callId: String(data.callId || '').slice(0, 200),
      toolName: String(data.toolName || '').slice(0, 160),
      serverName: String(data.serverName || '').slice(0, 160),
      skillName: String(data.skillName || '').slice(0, 160),
      ...(Number.isFinite(data.durationMs) ? { durationMs: Math.max(0, data.durationMs) } : {}),
      ...(Number.isFinite(data.textLen) ? { textLen: Math.max(0, data.textLen) } : {})
    };
  }
  if (type === 'tools.available') {
    return { type, tools: (data.tools || []).slice(0, 100).map(tool => ({
      name: String(tool.name || '').slice(0, 160),
      serverName: String(tool.meta?.serverName || '').slice(0, 160),
      skillName: String(tool.meta?.skillName || '').slice(0, 160)
    })), count: (data.tools || []).length };
  }
  if (['context.built', 'tools.discovery', 'provider.request', 'provider.tools_unsupported', 'runner.nudge'].includes(type)) return { type };
  if (type === 'tool.dispatch' || type === 'tool.result') {
    return { type, toolName: String(data.toolName || '').slice(0, 160), callId: String(data.callId || data.toolName || '').slice(0, 200), ...(type === 'tool.result' ? { ok: data.ok !== false } : {}) };
  }
  return null;
}

function emitReasoningSummary(data, onActivity) {
  // Explicit public summaries from the Responses API; encrypted reasoning and
  // private provider thinking blocks are not transcript content.
  if (!onActivity) return;
  if (data?.type === 'response.reasoning_summary_text.delta' && typeof data.delta === 'string') {
    onActivity({ type: 'reasoning.summary', text: data.delta.slice(0, 16000) });
  }
  for (const item of data?.output || []) {
    if (item.type !== 'reasoning') continue;
    for (const part of item.summary || []) {
      if (part.type === 'summary_text' && typeof part.text === 'string') onActivity({ type: 'reasoning.summary', text: part.text.slice(0, 16000) });
    }
  }
}
