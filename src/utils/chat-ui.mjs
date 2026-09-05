// Shared transcript navigation and presentation of public request activity.
// Composer arrows recall prompts; Alt + arrows explicitly scrolls the transcript.
function createPromptHistory(getPrompts) {
  let index = null;
  let draft = '';
  const reset = () => { index = null; draft = ''; };
  function keydown(event) {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return false;
    const input = event.target;
    const prompts = getPrompts();
    if (!input || !prompts.length || input.selectionStart !== input.selectionEnd) return false;
    const up = event.key === 'ArrowUp';
    // Keep native movement within an edited multiline draft. Once browsing,
    // each arrow advances one prompt, including multiline historical prompts.
    if (index === null) {
      if (!up || input.value.slice(0, input.selectionStart).includes('\n')) return false;
      draft = input.value;
      index = prompts.length;
    }
    event.preventDefault();
    event.stopPropagation();
    index = Math.max(0, Math.min(prompts.length, index + (up ? -1 : 1)));
    input.value = index === prompts.length ? draft : prompts[index];
    input.setSelectionRange(input.value.length, input.value.length);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    if (index === prompts.length) reset();
    return true;
  }
  return { keydown, reset };
}

function createChatNavigation(body, onChange = () => {}) {
  let following = true;
  const atEnd = () => body.scrollHeight - body.clientHeight - body.scrollTop < 32;
  const update = () => { following = atEnd(); onChange(!following); };
  body.addEventListener('scroll', update, { passive: true });
  function latest() {
    following = true;
    body.scrollTop = body.scrollHeight;
    onChange(false);
  }
  function refresh() {
    if (following) body.scrollTop = body.scrollHeight;
    onChange(!following);
  }
  function keydown(event) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    const composer = target?.tagName === 'TEXTAREA';
    if (target !== body && !composer) return;
    if (composer && !event.altKey) return;
    let delta;
    if (event.key === 'ArrowUp') delta = -72;
    if (event.key === 'ArrowDown') delta = 72;
    if (!composer && event.key === 'PageUp') delta = -body.clientHeight * 0.8;
    if (!composer && event.key === 'PageDown') delta = body.clientHeight * 0.8;
    if (!composer && event.key === 'Home') delta = -body.scrollHeight;
    if (!composer && event.key === 'End') delta = body.scrollHeight;
    if (delta === undefined) return;
    event.preventDefault();
    body.scrollTop += delta;
    update();
  }
  return { latest, refresh, keydown, dispose: () => body.removeEventListener('scroll', update) };
}

function createRequestActivity() {
  return { entries: [{ id: 'start', label: 'Request sent', state: 'complete' }], summary: '', status: 'Thinking…', ended: false };
}

function updateRequestActivity(activity, event) {
  if (!event || activity.ended) return activity;
  const next = { ...activity, entries: activity.entries.map(entry => ({ ...entry })) };
  if (event.type === 'request.details') {
    next.request = `${String(event.provider || 'Provider').slice(0, 100)} · ${String(event.model || 'Selected model').slice(0, 160)} · ${Number(event.messageCount) || 0} context messages`;
    return next;
  }
  if (event.type === 'tools.available') {
    next.availableTools = (Array.isArray(event.tools) ? event.tools : []).slice(0, 100);
    next.toolAvailability = `${Number(event.count) || next.availableTools.length} tools available to the model`;
    return next;
  }
  if (event.type === 'tools.unavailable') {
    const reasons = {
      discovery_failed: 'Tool discovery failed. Continuing without tools.',
      none_configured: 'No enabled agent tools are available. Configure agents in Settings → Advanced.',
      routing_disabled: 'Automatic tool routing is disabled for this request.'
    };
    // A discovery failure is more specific than the subsequent empty result.
    if (!next.discoveryFailed) next.toolAvailability = reasons[event.reason] || 'No tools are available for this request.';
    if (event.reason === 'discovery_failed') next.discoveryFailed = true;
    return next;
  }
  if (event.type === 'tool.details') {
    const entry = next.entries.find(item => item.id === `tool:${String(event.callId || event.toolName).slice(0, 200)}`);
    if (entry) {
      entry.detail = [event.serverName, event.skillName,
        Number.isFinite(event.durationMs) ? `${(event.durationMs / 1000).toFixed(1)}s` : '',
        Number.isFinite(event.textLen) ? `${event.textLen} response characters` : ''
      ].filter(Boolean).map(value => String(value).slice(0, 180)).join(' · ');
    }
    return next;
  }
  const labels = {
    'context.built': 'Context prepared',
    'tools.discovery': 'Finding available tools',
    'provider.request': 'Thinking…',
    'provider.tools_unsupported': 'This provider does not support tools; continuing without them',
    'runner.nudge': 'Checking the next step',
    'response.streaming': 'Writing response…'
  };
  if (event.type === 'reasoning.summary' && typeof event.text === 'string') {
    next.summary = (next.summary + event.text).slice(0, 16000);
    next.status = 'Thinking…';
  } else if (event.type === 'tool.dispatch' || event.type === 'tool.result') {
    if (typeof event.toolName !== 'string') return activity;
    if (event.type === 'tool.dispatch') {
      next.entries.forEach(entry => { if (!entry.id.startsWith('tool:') && entry.state === 'running') entry.state = 'complete'; });
    }
    const id = `tool:${String(event.callId || event.toolName).slice(0, 200)}`;
    let entry = next.entries.find(item => item.id === id);
    if (!entry) {
      entry = { id, label: event.toolName.slice(0, 160), state: 'running' };
      next.entries.push(entry);
    }
    entry.state = event.type === 'tool.dispatch' ? 'running' : event.ok === false ? 'error' : 'complete';
    next.status = event.type === 'tool.dispatch' ? `Using ${entry.label}…` : `${entry.label} ${entry.state === 'error' ? 'failed' : 'completed'}`;
  } else if (event.type === 'status') {
    const status = { thinking: 'Thinking…', working: 'Preparing response…', delegating: 'Waiting for tools…' }[event.status];
    if (status) next.status = status;
  } else if (labels[event.type]) {
    const label = labels[event.type];
    next.status = label;
    if (next.entries.at(-1)?.label !== label) {
      next.entries.forEach(entry => { if (!entry.id.startsWith('tool:') && entry.state === 'running') entry.state = 'complete'; });
      const running = ['tools.discovery', 'provider.request', 'runner.nudge', 'response.streaming'].includes(event.type);
      next.entries.push({ id: `${event.type}:${next.entries.length}`, label, state: running ? 'running' : 'complete' });
    }
  } else return activity;
  // Bound UI memory independently of provider heartbeats or a long tool run.
  next.entries = next.entries.slice(-60);
  return next;
}

function finishRequestActivity(activity, outcome = 'complete') {
  return {
    ...activity, ended: true,
    status: { complete: 'Response complete', error: 'Request failed', interrupted: 'Response interrupted', cancelled: 'Request cancelled' }[outcome] || 'Response complete',
    entries: activity.entries.map(entry => entry.state === 'running'
      ? { ...entry, state: outcome === 'complete' && !entry.id.startsWith('tool:') ? 'complete' : outcome === 'error' ? 'error' : 'interrupted' }
      : entry)
  };
}

function renderRequestActivity(activity) {
  const states = { running: 'Running', complete: 'Done', error: 'Failed', interrupted: 'Interrupted' };
  const entries = activity.entries.map(entry => `<li data-state="${escapeHtml(entry.state)}"><span>${escapeHtml(entry.label)}${entry.detail ? `<span class="op-activity-detail">${escapeHtml(entry.detail)}</span>` : ''}</span><small>${states[entry.state] || ''}</small></li>`).join('');
  const summaryText = activity.summary || (activity.ended
    ? 'This provider did not share a reasoning summary.'
    : 'Waiting for a reasoning summary from the provider…');
  const summary = `<section class="op-activity-reasoning"><h3>Reasoning summary</h3><p>${escapeHtml(summaryText)}</p></section>`;
  const calls = activity.entries.filter(entry => entry.id.startsWith('tool:'));
  const used = calls.length ? `${calls.length} tool calls` : activity.ended
    ? 'No tool calls were reported for this request.' : 'No tools called yet.';
  const available = (activity.availableTools || []).map(tool => `<li><span>${escapeHtml(tool.skillName || tool.name)}<span class="op-activity-detail">${escapeHtml(tool.serverName || '')} · ${escapeHtml(tool.name || '')}</span></span></li>`).join('');
  const tools = `<section class="op-activity-tools"><h3>Tools</h3><p>${escapeHtml(used)}</p>${activity.toolAvailability ? `<p>${escapeHtml(activity.toolAvailability)}</p>` : ''}${available ? `<details><summary>Available tools</summary><ul>${available}</ul></details>` : ''}</section>`;
  const request = activity.request ? `<p class="op-activity-request">${escapeHtml(activity.request)}</p>` : '';
  return `${request}${tools}${summary}<ol>${entries}</ol>`;
}

export { createPromptHistory, createChatNavigation, createRequestActivity, updateRequestActivity, finishRequestActivity, renderRequestActivity };
