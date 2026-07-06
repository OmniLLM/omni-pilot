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

// Guardrails — classification tiers and audit-log cap.
const GUARDRAIL_TIERS = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' };
const GUARDRAIL_AUDIT_KEY = 'omnipilotGuardrailsAudit';
const GUARDRAIL_AUDIT_MAX_ENTRIES = 200;
const GUARDRAIL_DESTRUCTIVE_TAGS = ['destructive', 'delete', 'admin', 'payments'];

// Observability — trace ring buffer stored in chrome.storage.local.
const TRACES_KEY = 'omnipilotTraces';
const TRACES_MAX_RUNS = 20;
const TRACES_MAX_EVENTS_PER_RUN = 200;

// Omni Agent Hub — JSON-RPC error codes.
// See client-integration-guide.md §10.
const A2A_RPC_ERROR_TASK_NOT_FOUND = -32001;
const A2A_RPC_ERROR_UPSTREAM_HTTP = -32002;
const A2A_RPC_ERROR_UPSTREAM_INVALID = -32003;
const A2A_RPC_ERROR_UPSTREAM_UNAVAILABLE = -32010;
const A2A_RPC_ERROR_NO_ROUTE = -32011;

// Retry policy for -32010 (circuit breaker open): back off and retry
// up to this many times before surfacing the error to the user.
const A2A_RPC_BREAKER_MAX_RETRIES = 2;
const A2A_RPC_BREAKER_BACKOFF_MS = 3000;
