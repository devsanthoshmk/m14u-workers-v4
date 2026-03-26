import { usePlayerStore } from '@/stores/playerStore';
import { useSearchStore } from '@/lib/stores/search';
import { routerRef } from './router-ref';
import { logEntry } from './logger';

class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`wait.${label} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

function poll(predicate: () => boolean, label: string, timeout = 10000, interval = 100): Promise<void> {
  const start = Date.now();
  logEntry({ type: 'WAIT', name: `wait.${label}`, payload: { timeout } });

  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        logEntry({ type: 'WAIT', name: `wait.${label}.resolved`, duration: Date.now() - start });
        resolve();
      } else if (Date.now() - start >= timeout) {
        const err = new TimeoutError(label, timeout);
        logEntry({ type: 'ERROR', name: `wait.${label}.timeout`, error: err.message, duration: Date.now() - start });
        reject(err);
      } else {
        setTimeout(check, interval);
      }
    };
    check();
  });
}

const player = () => usePlayerStore.getState();
const search = () => useSearchStore.getState();

export const wait = {
  forPlaybackStart(timeout?: number) {
    return poll(() => player().isPlaying && !player().isBuffering, 'forPlaybackStart', timeout);
  },
  forPlaybackPause(timeout?: number) {
    return poll(() => !player().isPlaying, 'forPlaybackPause', timeout);
  },
  forRoute(path: string, timeout?: number) {
    return poll(() => routerRef.location?.pathname === path, 'forRoute', timeout);
  },
  forResults(timeout?: number) {
    return poll(() => search().results.length > 0, 'forResults', timeout);
  },
  forQueueLength(n: number, timeout?: number) {
    return poll(() => player().queue.length >= n, 'forQueueLength', timeout);
  },
  forTime(seconds: number, timeout?: number) {
    return poll(() => player().currentTime >= seconds, 'forTime', timeout ?? Math.max(10000, (seconds + 5) * 1000));
  },
  forBuffering(timeout?: number) {
    return poll(() => !player().isBuffering, 'forBuffering', timeout);
  },
  forSong(titleSubstr: string, timeout?: number) {
    return poll(
      () => !!player().currentSong?.title?.toLowerCase().includes(titleSubstr.toLowerCase()),
      'forSong',
      timeout,
    );
  },
  for(predicate: () => boolean, label: string, timeout?: number) {
    return poll(predicate, label, timeout);
  },
};
