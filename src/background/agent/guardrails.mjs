// OmniPilot agent primitives — Guardrails.
//
// Enforces a permission policy on every ToolRegistry.dispatch call.
// Modes:
//   * 'off'       — no enforcement (wrap is a no-op).
//   * 'deny-list' — everything allowed except denied domains or tools
//                   with destructive skill tags (see GUARDRAIL_DESTRUCTIVE_TAGS).
// Denied calls throw an Error with "guardrail" in the message so the
// Runner's fanout code can convert them into tool_result errors.
//
// Audit log entries go into chrome.storage.local under
// GUARDRAIL_AUDIT_KEY, capped at GUARDRAIL_AUDIT_MAX_ENTRIES (oldest
// dropped on overflow). Audit failures are swallowed.
//
// Concatenated into dist/background.js; do not add `export`s.

function createGuardrails({ mode = 'deny-list', denyDomains = [], servers = [] } = {}) {
  const serverById = new Map();
  for (const s of servers || []) {
    if (s && s.id) serverById.set(s.id, s);
  }
  const denyList = (denyDomains || []).map(d => String(d || '').toLowerCase()).filter(Boolean);

  function domainOf(server) {
    try {
      const url = new URL(server?.endpoint || '');
      return url.hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  function isDeniedDomain(server) {
    const host = domainOf(server);
    if (!host) return false;
    return denyList.some(pattern => host === pattern || host.endsWith('.' + pattern));
  }

  function hasDestructiveTag(tool) {
    const tags = Array.isArray(tool?.meta?.skillTags) ? tool.meta.skillTags : [];
    return tags.some(tag => GUARDRAIL_DESTRUCTIVE_TAGS.includes(String(tag || '').toLowerCase()));
  }

  function classify(tool /*, args */) {
    if (mode === 'off') {
      return { tier: GUARDRAIL_TIERS.LOW, allow: true, reason: 'guardrails off' };
    }
    const serverId = tool?.meta?.serverId;
    const server = serverId ? serverById.get(serverId) : null;
    if (server && isDeniedDomain(server)) {
      return {
        tier: GUARDRAIL_TIERS.CRITICAL,
        allow: false,
        reason: `denied by domain: ${domainOf(server)}`
      };
    }
    if (hasDestructiveTag(tool)) {
      return {
        tier: GUARDRAIL_TIERS.CRITICAL,
        allow: false,
        reason: `denied by destructive tag on tool ${tool?.name}`
      };
    }
    return { tier: GUARDRAIL_TIERS.HIGH, allow: true, reason: 'ok' };
  }

  async function appendAudit(entry) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return;
    try {
      const stored = await storageGet([GUARDRAIL_AUDIT_KEY], chrome.storage.local);
      const log = Array.isArray(stored[GUARDRAIL_AUDIT_KEY]) ? stored[GUARDRAIL_AUDIT_KEY] : [];
      log.push(entry);
      while (log.length > GUARDRAIL_AUDIT_MAX_ENTRIES) log.shift();
      await storageSet({ [GUARDRAIL_AUDIT_KEY]: log }, chrome.storage.local);
    } catch (error) {
      console.warn('OmniPilot: failed to append guardrail audit', error?.message || error);
    }
  }

  function wrap(registry, onEvent = () => {}) {
    if (mode === 'off') return registry; // no-op
    function safeEmit(type, data) { try { onEvent(type, data); } catch {} }
    const originalDispatch = registry.dispatch;
    registry.dispatch = async function guardedDispatch(name, args) {
      const tool = registry.get(name);
      const verdict = tool
        ? classify(tool, args)
        : { tier: GUARDRAIL_TIERS.CRITICAL, allow: false, reason: `unknown tool ${name}` };
      const ts = new Date().toISOString();
      appendAudit({
        ts,
        toolName: name,
        serverId: tool?.meta?.serverId || null,
        tier: verdict.tier,
        allow: verdict.allow,
        reason: verdict.reason
      });
      if (!verdict.allow) {
        safeEmit('guardrail.denied', { toolName: name, reason: verdict.reason });
        throw new Error(`Guardrail denied: ${verdict.reason}`);
      }
      safeEmit('guardrail.allowed', { toolName: name, tier: verdict.tier });
      return originalDispatch.call(registry, name, args);
    };
    return registry;
  }

  return { classify, wrap };
}
