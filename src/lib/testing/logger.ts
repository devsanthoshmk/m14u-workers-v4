export interface LogEntry {
  type: 'ACTION' | 'WAIT' | 'ASSERT' | 'ERROR' | 'NAV';
  name: string;
  payload?: unknown;
  result?: unknown;
  error?: string;
  timestamp: number;
  duration?: number;
}

let _enabled = false;
const _entries: LogEntry[] = [];
type ErrorListener = (entry: LogEntry) => void | Promise<void>;
const _errorListeners = new Set<{ callback: ErrorListener }>();

export function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'Unknown error';
  }
}

function reportListenerError(error: unknown) {
  // Observer failures must not replace the command error or emit recursive ERROR entries.
  console.error('[m14u] onError callback failed:', error);
}

export function logEntry(entry: Omit<LogEntry, 'timestamp'>) {
  const full: LogEntry = { ...entry, timestamp: Date.now() };
  if (_enabled) _entries.push(full);
  if (entry.type === 'ERROR') {
    for (const { callback } of [..._errorListeners]) {
      try {
        void Promise.resolve(callback(full)).catch(reportListenerError);
      } catch (error) {
        reportListenerError(error);
      }
    }
  }
  if (_enabled && entry.type === 'ERROR') {
    console.error(`[m14u] ${entry.name}:`, entry.error);
  }
}

export function onErrorEntry(callback: ErrorListener) {
  const listener = { callback };
  _errorListeners.add(listener);
  return () => { _errorListeners.delete(listener); };
}

export const logger = {
  enable() { _enabled = true; },
  disable() { _enabled = false; },
  get() { return [..._entries]; },
  last(n = 5) { return n >= 1 ? _entries.slice(-n) : []; },
  clear() { _entries.length = 0; },
  errors() { return _entries.filter(e => e.type === 'ERROR'); },
};
