// OmniPilot agent primitives — State.
//
// Opaque scratch storage for a single Runner.run() invocation. Phase 4
// (guardrails) and phase 5 (observability) hang per-run counters, timing
// data, and audit records here.

function createState() {
  const store = new Map();
  return {
    get(key) { return store.get(key); },
    set(key, value) { store.set(key, value); return value; },
    incr(key, delta = 1) {
      const next = (store.get(key) || 0) + delta;
      store.set(key, next);
      return next;
    },
    has(key) { return store.has(key); },
    keys() { return Array.from(store.keys()); }
  };
}
