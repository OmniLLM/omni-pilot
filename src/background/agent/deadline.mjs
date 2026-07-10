function createResponseDeadline(timeoutMs, dependencies = {}) {
  const normalizedTimeoutMs = normalizeResponseTimeoutMs(timeoutMs);
  const AbortControllerImpl = dependencies.AbortController || globalThis.AbortController;
  const setTimer = dependencies.setTimeout || globalThis.setTimeout;
  const clearTimer = dependencies.clearTimeout || globalThis.clearTimeout;
  const now = dependencies.now || Date.now;
  const startedAt = now();
  const controller = typeof AbortControllerImpl === 'function' ? new AbortControllerImpl() : null;
  let timedOut = false;
  let timer = null;

  if (controller && typeof setTimer === 'function') {
    timer = setTimer(() => {
      timedOut = true;
      controller.abort();
    }, normalizedTimeoutMs);
    timer?.unref?.();
  }

  function remainingMs() {
    return Math.max(0, normalizedTimeoutMs - (now() - startedAt));
  }

  function throwIfExpired() {
    if (timedOut || remainingMs() <= 0) {
      timedOut = true;
      throw new Error(createResponseTimeoutMessage(normalizedTimeoutMs));
    }
  }

  function toError(error) {
    if (timedOut || (controller?.signal?.aborted && remainingMs() <= 0)) {
      return new Error(createResponseTimeoutMessage(normalizedTimeoutMs));
    }
    return error instanceof Error ? error : new Error(String(error || 'Unexpected extension error'));
  }

  function clear() {
    if (timer !== null && typeof clearTimer === 'function') clearTimer(timer);
    timer = null;
  }

  return {
    timeoutMs: normalizedTimeoutMs,
    signal: controller?.signal,
    remainingMs,
    throwIfExpired,
    toError,
    clear,
    get timedOut() { return timedOut; }
  };
}

export { createResponseDeadline };
