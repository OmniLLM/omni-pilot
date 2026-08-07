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
    const packed = pinAndTrimMessages(baseMessages, maxTokens - used);

    return {
      systemPrompt,
      messages: packed.messages,
      mandatoryOverflow: packed.mandatoryOverflow,
      dropped: dropped.map(item => ({
        name: item.name,
        priority: item.priority,
        tokens: item.tokens
      }))
    };
  }

  function pinAndTrimMessages(messages, budget) {
    if (!Array.isArray(messages) || messages.length === 0) {
      return { messages: [], mandatoryOverflow: null };
    }

    const messageCost = message => estimateTokens(
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content || '')
    );
    const lastIndex = messages.length - 1;
    const pinnedIndexes = new Set([lastIndex]);
    messages.forEach((message, index) => {
      if (message?.kind === 'selection-context') pinnedIndexes.add(index);
    });

    let remaining = budget;
    let mandatoryTokens = 0;
    for (const index of pinnedIndexes) {
      const cost = messageCost(messages[index]);
      mandatoryTokens += cost;
      remaining -= cost;
    }

    const includedIndexes = new Set(pinnedIndexes);
    if (remaining >= 0) {
      for (let i = lastIndex - 1; i >= 0; i -= 1) {
        if (includedIndexes.has(i)) continue;
        const cost = messageCost(messages[i]);
        if (cost > remaining) continue;
        includedIndexes.add(i);
        remaining -= cost;
      }
    }

    return {
      messages: messages.filter((_, index) => includedIndexes.has(index)),
      mandatoryOverflow: mandatoryTokens > budget
        ? {
            requiredTokens: mandatoryTokens,
            availableTokens: Math.max(0, budget),
            hasSelectionContext: messages.some(message => message?.kind === 'selection-context')
          }
        : null
    };
  }

  return { addSection, buildMessages };
}
