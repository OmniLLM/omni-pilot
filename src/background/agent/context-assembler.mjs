// OmniPilot agent primitives — ContextAssembler.
//
// Prioritized packing of prompt sections into a token-bounded context.
// Sections are (priority, name, content); lower priority number =
// kept first. Once the running token estimate would exceed maxTokens,
// the offending section is dropped (recorded in the returned `dropped`
// array) and later sections continue to be tried in case they fit.
//
// Token estimate is Math.ceil(str.length / 4) — a well-known heuristic
// that's fine for budgeting decisions.
//
// Concatenated into dist/background.js; do not add `export`s.

function estimateTokens(str) {
  if (!str) return 0;
  return Math.ceil(String(str).length / 4);
}

function createContextAssembler({ maxTokens = CONTEXT_DEFAULT_MAX_TOKENS } = {}) {
  const sections = [];

  function addSection(priority, name, content) {
    if (!content) return;
    sections.push({
      priority: Number.isFinite(priority) ? priority : 100,
      name: String(name || 'unnamed'),
      content: String(content),
      tokens: estimateTokens(content)
    });
  }

  function buildMessages(baseMessages = []) {
    const ordered = [...sections].sort((a, b) => a.priority - b.priority);

    let used = 0;
    const kept = [];
    const dropped = [];
    for (const s of ordered) {
      if (used + s.tokens <= maxTokens) {
        kept.push(s);
        used += s.tokens;
      } else {
        dropped.push({ name: s.name, priority: s.priority, tokens: s.tokens });
      }
    }

    const systemPrompt = kept.map(s => s.content).join('\n\n');
    const messages = pinAndTrimMessages(baseMessages, maxTokens - used);

    return {
      systemPrompt,
      messages,
      dropped: dropped.map(item => ({
        name: item.name,
        priority: item.priority,
        tokens: item.tokens
      }))
    };
  }

  function pinAndTrimMessages(messages, budget) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    if (budget <= 0) {
      const last = messages[messages.length - 1];
      return last ? [last] : [];
    }
    const included = [];
    let remaining = budget;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      const cost = estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
      if (cost > remaining && i !== messages.length - 1) break;
      included.unshift(m);
      remaining -= cost;
    }
    return included;
  }

  return { addSection, buildMessages };
}
