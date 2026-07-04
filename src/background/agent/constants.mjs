// OmniPilot agent primitives — shared constants.
//
// Concatenated into dist/background.js by build.mjs before the entry file,
// so declarations here are visible as top-level bindings to the rest of
// the background script and to the vm.runInContext test harness.

const A2A_POLL_INTERVAL_MS = 500;
const A2A_MAX_POLL_ATTEMPTS = 600;
const A2A_STATUS_HEARTBEAT_MS = 10000;
// Upper bound for a single non-streaming A2A delegation before we surface a
// timeout error to the chat UI.
const A2A_DELEGATION_TIMEOUT_MS = 330000;
const A2A_TOOL_NAME_PREFIX = 'a2a__';
const A2A_TOOL_NAME_MAX_LEN = 64;
const A2A_TOOL_DESCRIPTION_MAX_LEN = 1024;
// Cap on how many LLM->tools->LLM rounds a single auto-route request may
// run through per user turn. Round 0 is the initial call; each subsequent
// round feeds prior tool_result messages back and lets the model either
// summarize or emit more tool calls.
const A2A_MAX_ROUNDS = 3;

// Memory subsystem — storage keys and retention policy.
// Long-term memory (MEMORY.md-equivalent) is user-editable; daily logs
// are agent-appended and rolled over every MEMORY_RETENTION_DAYS days.
const MEMORY_LONG_TERM_KEY = 'omnipilotMemoryLongTerm';
const MEMORY_DAILY_LOGS_KEY = 'omnipilotMemoryDailyLogs';
const MEMORY_RETENTION_DAYS = 7;

// Context assembly — default token budget for the assembled per-turn
// context. Overridable via chrome.storage.sync `contextMaxTokens`.
const CONTEXT_DEFAULT_MAX_TOKENS = 8000;
