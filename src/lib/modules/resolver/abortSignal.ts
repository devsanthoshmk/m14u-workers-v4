export function anyAbortSignal(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any(active), cleanup() {} };
  }
  const controller = new AbortController();
  for (const source of active) {
    if (source.aborted) {
      controller.abort(source.reason);
      return { signal: controller.signal, cleanup() {} };
    }
  }
  const listeners: Array<[AbortSignal, () => void]> = [];
  const cleanup = () => {
    for (const [source, listener] of listeners) {
      source.removeEventListener('abort', listener);
    }
    listeners.length = 0;
  };
  for (const source of active) {
    if (typeof source.addEventListener !== 'function') continue;
    const onAbort = () => {
      cleanup();
      controller.abort(source.reason);
    };
    listeners.push([source, onAbort]);
    source.addEventListener('abort', onAbort, { once: true });
  }
  return { signal: controller.signal, cleanup };
}

export function timeoutAbortSignal(ms: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), cleanup() {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error('Signal timed out');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, ms);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}
