export interface LogEntry {
  type: 'ACTION' | 'WAIT' | 'ASSERT' | 'ERROR' | 'NAV';
  name: string;
  payload?: any;
  result?: any;
  error?: string;
  timestamp: number;
  duration?: number;
}

let _enabled = false;
const _entries: LogEntry[] = [];
const _errorListeners: Array<(entry: LogEntry) => void> = [];

export function logEntry(entry: Omit<LogEntry, 'timestamp'>) {
  const full: LogEntry = { ...entry, timestamp: Date.now() };
  if (_enabled) _entries.push(full);
  if (entry.type === 'ERROR') {
    _errorListeners.forEach(fn => fn(full));
  }
  if (_enabled && entry.type === 'ERROR') {
    console.error(`[m14u] ${entry.name}:`, entry.error);
  }
}

export function onErrorEntry(cb: (entry: LogEntry) => void) {
  _errorListeners.push(cb);
  return () => {
    const i = _errorListeners.indexOf(cb);
    if (i >= 0) _errorListeners.splice(i, 1);
  };
}

export const logger = {
  enable() { _enabled = true; },
  disable() { _enabled = false; },
  get() { return [..._entries]; },
  last(n = 5) { return _entries.slice(-n); },
  clear() { _entries.length = 0; },
  errors() { return _entries.filter(e => e.type === 'ERROR'); },
};
