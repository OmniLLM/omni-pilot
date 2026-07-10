const RESPONSE_TIMEOUT_DEFAULT_MS = 5 * 60 * 1000;
const RESPONSE_TIMEOUT_MIN_MS = 30 * 1000;
const RESPONSE_TIMEOUT_MAX_MS = 30 * 60 * 1000;

function normalizeResponseTimeoutMs(value) {
  if (value === '' || value === null || value === undefined) return RESPONSE_TIMEOUT_DEFAULT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return RESPONSE_TIMEOUT_DEFAULT_MS;
  return Math.max(RESPONSE_TIMEOUT_MIN_MS, Math.min(RESPONSE_TIMEOUT_MAX_MS, Math.round(parsed)));
}

function responseTimeoutMinutesToMs(minutes) {
  if (minutes === '' || minutes === null || minutes === undefined) return RESPONSE_TIMEOUT_DEFAULT_MS;
  const parsed = Number(minutes);
  if (!Number.isFinite(parsed) || parsed <= 0) return RESPONSE_TIMEOUT_DEFAULT_MS;
  return normalizeResponseTimeoutMs(parsed * 60 * 1000);
}

function responseTimeoutMsToMinutes(milliseconds) {
  return normalizeResponseTimeoutMs(milliseconds) / (60 * 1000);
}

function formatResponseTimeoutDuration(milliseconds) {
  const normalized = normalizeResponseTimeoutMs(milliseconds);
  if (normalized < 60 * 1000) return `${Math.round(normalized / 1000)} seconds`;
  const minutes = normalized / (60 * 1000);
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

function createResponseTimeoutMessage(milliseconds) {
  return `Response timed out after ${formatResponseTimeoutDuration(milliseconds)}.`;
}

export {
  RESPONSE_TIMEOUT_DEFAULT_MS,
  RESPONSE_TIMEOUT_MIN_MS,
  RESPONSE_TIMEOUT_MAX_MS,
  normalizeResponseTimeoutMs,
  responseTimeoutMinutesToMs,
  responseTimeoutMsToMinutes,
  formatResponseTimeoutDuration,
  createResponseTimeoutMessage
};
