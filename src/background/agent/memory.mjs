// OmniPilot agent primitives — Memory.
//
// Cross-session memory backed by chrome.storage.local. Two tiers:
//   * Long-term memory: a single user-editable string (MEMORY.md-equivalent).
//   * Daily logs: agent-appended entries grouped by YYYY-MM-DD, pruned
//     to a rolling MEMORY_RETENTION_DAYS window on every write.
//
// Concatenated into dist/background.js; do not add `export`s.
// All storage APIs go through the existing storageGet/storageSet
// helpers in src/background/index.mjs so tests hit the same fakes.

function createMemory({ now = () => new Date() } = {}) {
  async function getLongTerm() {
    const stored = await storageGet([MEMORY_LONG_TERM_KEY], chrome.storage.local);
    return stored[MEMORY_LONG_TERM_KEY] || '';
  }

  async function setLongTerm(text) {
    await storageSet({ [MEMORY_LONG_TERM_KEY]: String(text || '') }, chrome.storage.local);
  }

  async function getDailyLogs() {
    const stored = await storageGet([MEMORY_DAILY_LOGS_KEY], chrome.storage.local);
    return (stored[MEMORY_DAILY_LOGS_KEY] && typeof stored[MEMORY_DAILY_LOGS_KEY] === 'object')
      ? stored[MEMORY_DAILY_LOGS_KEY]
      : {};
  }

  async function setDailyLogs(logs) {
    await storageSet({ [MEMORY_DAILY_LOGS_KEY]: logs }, chrome.storage.local);
  }

  function todayKey() {
    return now().toISOString().slice(0, 10);
  }

  async function appendDailyLog(entry) {
    if (!entry) return;
    const logs = await getDailyLogs();
    const key = todayKey();
    const day = Array.isArray(logs[key]) ? logs[key].slice() : [];
    day.push(String(entry));
    logs[key] = day;

    // Prune: keep only the newest MEMORY_RETENTION_DAYS distinct dates.
    const dates = Object.keys(logs).sort();
    while (dates.length > MEMORY_RETENTION_DAYS) {
      delete logs[dates.shift()];
    }

    await setDailyLogs(logs);
  }

  async function getRecent(days = MEMORY_RETENTION_DAYS) {
    const logs = await getDailyLogs();
    const sorted = Object.keys(logs).sort();
    const window = sorted.slice(-days);
    return window.map(date => ({ date, entries: logs[date] }));
  }

  async function clearDailyLogs() {
    await storageSet({ [MEMORY_DAILY_LOGS_KEY]: {} }, chrome.storage.local);
  }

  async function summary() {
    const longTerm = await getLongTerm();
    const recent = await getRecent(MEMORY_RETENTION_DAYS);
    if (!longTerm && recent.length === 0) return '';

    const parts = ['## Memory'];
    if (longTerm) {
      parts.push('', longTerm.trim());
    }
    if (recent.length) {
      parts.push('', '### Recent activity');
      for (const { date, entries } of recent) {
        parts.push(`- ${date}`);
        for (const entry of entries) parts.push(`  - ${entry}`);
      }
    }
    return parts.join('\n');
  }

  return { getLongTerm, setLongTerm, appendDailyLog, getRecent, clearDailyLogs, summary };
}
