// OmniPilot agent primitives — Observability (trace recorder).
//
// createTraceRecorder({ maxRuns, maxEventsPerRun }) returns a ring-
// buffered per-run event log persisted to chrome.storage.local under
// TRACES_KEY. Each run has { id, label, startedAt, endedAt, status,
// events: [{ ts, type, data }] }.
//
// Persistence is best-effort — failures are warned and swallowed.
//
// Concatenated into dist/background.js; do not add `export`s.

function createTraceRecorder({
  maxRuns = TRACES_MAX_RUNS,
  maxEventsPerRun = TRACES_MAX_EVENTS_PER_RUN
} = {}) {
  let current = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function newRunId() {
    return `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }

  function startRun(label) {
    current = {
      id: newRunId(),
      label: String(label || 'run'),
      startedAt: nowIso(),
      endedAt: null,
      status: 'in-progress',
      events: []
    };
    return current.id;
  }

  function event(type, data) {
    if (!current) return;
    current.events.push({ ts: nowIso(), type: String(type || 'unknown'), data: data || {} });
    while (current.events.length > maxEventsPerRun) current.events.shift();
  }

  async function persist(run) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return;
    try {
      const stored = await storageGet([TRACES_KEY], chrome.storage.local);
      const runs = Array.isArray(stored[TRACES_KEY]) ? stored[TRACES_KEY] : [];
      runs.push(run);
      while (runs.length > maxRuns) runs.shift();
      await storageSet({ [TRACES_KEY]: runs }, chrome.storage.local);
    } catch (error) {
      console.warn('OmniPilot: failed to persist trace', error?.message || error);
    }
  }

  async function endRun(status) {
    if (!current) return;
    current.endedAt = nowIso();
    current.status = String(status || 'ok');
    const finished = current;
    current = null;
    await persist(finished);
  }

  async function snapshot() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) return [];
    try {
      const stored = await storageGet([TRACES_KEY], chrome.storage.local);
      const runs = Array.isArray(stored[TRACES_KEY]) ? stored[TRACES_KEY] : [];
      return JSON.parse(JSON.stringify(runs));
    } catch {
      return [];
    }
  }

  async function clear() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return;
    try {
      await storageSet({ [TRACES_KEY]: [] }, chrome.storage.local);
    } catch (error) {
      console.warn('OmniPilot: failed to clear traces', error?.message || error);
    }
  }

  return { startRun, event, endRun, snapshot, clear };
}

function createNoopTraceRecorder() {
  return {
    startRun: () => null,
    event: () => {},
    endRun: async () => {},
    snapshot: async () => [],
    clear: async () => {}
  };
}
