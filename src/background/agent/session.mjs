// OmniPilot agent primitives — Session.
//
// Holds the message list for a single Runner.run() invocation plus the
// (serverId, task) dedup set used to break agentic-loop retries.
// Delegates the shape-specific follow-up message construction to the
// existing `buildA2aFollowUpMessages` free function (still in index.mjs
// for now; moved out in Task 5).

function createSession({ messages = [] } = {}) {
  const dispatched = new Set();
  const state = { messages: [...messages] };

  return {
    get messages() { return state.messages; },
    appendMessage(msg) { state.messages.push(msg); },
    appendFollowUp(apiShape, rawResponse, settled) {
      const followUps = buildA2aFollowUpMessages(apiShape, rawResponse, settled);
      state.messages.push(...followUps);
    },
    hasDispatched(key) { return dispatched.has(key); },
    markDispatched(key) { dispatched.add(key); }
  };
}
