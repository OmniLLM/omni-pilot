// GitHub Copilot model → API shape mapping.
//
// Copilot exposes two request shapes for chat-style traffic:
//   * OpenAI Chat Completions  (POST /chat/completions)
//   * OpenAI Responses         (POST /responses)
//
// Each model is served by ONE OR BOTH of these endpoints. The Copilot
// `GET /models` response includes a `supported_endpoints` array that is
// the ground truth for which endpoint a given model accepts. When we send
// a request to the wrong endpoint we get:
//
//   HTTP 400 { "error": { "code": "unsupported_api_for_model",
//              "message": "model \"gpt-5.4-mini\" is not accessible via
//                          the /chat/completions endpoint" } }
//
// The map below is a snapshot of Copilot's `/models` response taken on
// 2026-07-07 (see docs/superpowers/specs/2026-07-07-copilot-model-handling-design.md).
// It lets the extension route to the correct endpoint on the very first
// request, without waiting for a live GET /models round-trip and without
// paying the cost of a wrong-endpoint 400 + retry.
//
// The map is intentionally exhaustive for models that appear in Copilot's
// `/models` response. For any model NOT in the map (e.g. a brand-new
// model Copilot rolls out) we fall back to a family heuristic that
// mirrors the omnillm sibling project's rule.
//
// Values:
//   'responses' — model MUST be reached at POST /responses
//   'chat'      — model MUST or MAY be reached at POST /chat/completions
//                 (models that support both list 'chat' so we prefer the
//                 endpoint that is most compatible with our request builder)
//
// See also: `copilotModelUsesMaxCompletionTokens` below, which controls
// whether a chat/completions request sends `max_tokens` or the newer
// `max_completion_tokens` param that reasoning-family models require.

const COPILOT_MODEL_SHAPES = Object.freeze({
  // Anthropic models on Copilot — chat-completions compatible
  'claude-opus-4.6':          'chat',
  'claude-opus-4.7':          'chat',
  'claude-opus-4.8':          'chat',
  'claude-sonnet-4.5':        'chat',
  'claude-sonnet-4.6':        'chat',
  'claude-sonnet-5':          'chat',
  'claude-haiku-4.5':         'chat',

  // Google models on Copilot
  'gemini-2.5-pro':           'chat',
  'gemini-3-flash-preview':   'chat',
  'gemini-3.1-pro-preview':   'chat',
  'gemini-3.5-flash':         'chat',

  // OpenAI GPT-5 family on Copilot
  // gpt-5.4 supports BOTH endpoints; we prefer chat for compatibility.
  'gpt-5.4':                  'chat',
  // gpt-5-mini supports BOTH endpoints; we prefer chat.
  'gpt-5-mini':               'chat',
  // Responses-only models — sending them to /chat/completions produces
  // `unsupported_api_for_model`. These are the bug reports.
  'gpt-5.3-codex':            'responses',
  'gpt-5.4-mini':             'responses',
  'gpt-5.5':                  'responses',

  // Microsoft AI models on Copilot — responses-only
  'mai-code-1-flash-picker':  'responses',

  // Classic OpenAI models — chat-completions
  'gpt-3.5-turbo':            'chat',
  'gpt-3.5-turbo-0613':       'chat',
  'gpt-4':                    'chat',
  'gpt-4-0125-preview':       'chat',
  'gpt-4-0613':               'chat',
  'gpt-4-o-preview':          'chat',
  'gpt-4.1':                  'chat',
  'gpt-4.1-2025-04-14':       'chat',
  'gpt-41-copilot':           'chat',
  'gpt-4o':                   'chat',
  'gpt-4o-2024-05-13':        'chat',
  'gpt-4o-2024-08-06':        'chat',
  'gpt-4o-2024-11-20':        'chat',
  'gpt-4o-mini':              'chat',
  'gpt-4o-mini-2024-07-18':   'chat',

  // Utility
  'trajectory-compaction':    'chat'
});

// True when the given model name is a member of the GPT-5 family, based
// on Copilot's naming scheme (`gpt-5`, `gpt-5.4`, `gpt-5-mini`,
// `gpt-5.3-codex`, `gpt-5o`, …). Matches the omnillm `IsGPT5Family` rule.
function isCopilotGpt5Family(model) {
  return /^gpt-5(\.|-|o|$)/i.test(String(model || '').trim());
}

// True for models whose Copilot chat-completions body needs
// `max_completion_tokens` instead of `max_tokens`. This includes the
// entire o1/o3/o4/gpt-5 reasoning family, NOT just gpt-5.4.
function isCopilotReasoningModel(model) {
  const lower = String(model || '').trim().toLowerCase();
  return /^o[134]([-.]|$)/.test(lower) || isCopilotGpt5Family(lower);
}

function copilotModelUsesMaxCompletionTokens(model) {
  return isCopilotReasoningModel(model);
}

// Returns the API shape for a Copilot model. Values:
//
//   'chat'      — POST /chat/completions (OpenAI Chat Completions)
//   'responses' — POST /responses         (OpenAI Responses)
//   'messages'  — POST /v1/messages       (Anthropic Messages)
//   'gemini'    — POST /gemini            (Google Gemini)
//
// Priority:
//   1. Exact map lookup (case-insensitive) — the ground truth from
//      Copilot's /models `supported_endpoints`.
//   2. Fallback heuristic on the raw model name (used for models that
//      Copilot ships but our snapshot hasn't captured yet):
//        - name contains 'claude' → 'messages'
//        - name contains 'mai' or 'gpt' → 'responses'
//        - name contains 'gemini' → 'gemini'
//        - anything else → 'chat'
//
// NOTE: only 'chat' and 'responses' are currently wired through
// `buildApiRequest` in `src/background/index.mjs`. 'messages' and
// 'gemini' are returned by the mapping so callers know what the model
// naturally wants, but at the request-builder layer they currently
// fall through to 'chat' (the safe default) until the corresponding
// Copilot endpoints get wired up. `isCopilotResponsesOnlyModel` below
// bridges this by returning true ONLY for 'responses'.
function selectCopilotShape(model) {
  const raw = String(model || '').trim();
  if (!raw) return 'chat';
  const key = raw.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(COPILOT_MODEL_SHAPES, key)) {
    return COPILOT_MODEL_SHAPES[key];
  }

  // Fallback heuristic by substring on the LOWERCASE model name.
  // Order matters: check 'claude' first because a hypothetical
  // "claude-gpt-relay" name would otherwise be swallowed by the gpt rule.
  if (key.includes('claude')) return 'messages';
  if (key.includes('gemini')) return 'gemini';
  if (key.includes('mai') || key.includes('gpt')) return 'responses';

  return 'chat';
}

// True when the model MUST be reached at Copilot's /responses endpoint.
// A shape of 'messages' or 'gemini' does NOT count as responses-only —
// those get the current chat-completions fallback until their
// endpoints are wired up in buildApiRequest.
function isCopilotResponsesOnlyModel(model) {
  return selectCopilotShape(model) === 'responses';
}

export {
  COPILOT_MODEL_SHAPES,
  copilotModelUsesMaxCompletionTokens,
  isCopilotGpt5Family,
  isCopilotReasoningModel,
  isCopilotResponsesOnlyModel,
  selectCopilotShape
};
