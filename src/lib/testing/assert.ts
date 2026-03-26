import { usePlayerStore } from '@/stores/playerStore';
import { useSearchStore } from '@/lib/stores/search';
import { routerRef } from './router-ref';
import { logEntry } from './logger';

class AssertionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AssertionError';
  }
}

function fail(name: string, msg: string): never {
  logEntry({ type: 'ASSERT', name, error: msg });
  logEntry({ type: 'ERROR', name, error: msg });
  throw new AssertionError(msg);
}

function pass(name: string, result?: any) {
  logEntry({ type: 'ASSERT', name, result: result ?? 'PASS' });
}

const player = () => usePlayerStore.getState();

export const assert = {
  isPlaying(expected = true) {
    const actual = player().isPlaying;
    if (actual !== expected) fail('assert.isPlaying', `Expected isPlaying=${expected}, got ${actual}`);
    pass('assert.isPlaying', actual);
  },
  isPaused() {
    const actual = player().isPlaying;
    if (actual) fail('assert.isPaused', `Expected paused, but isPlaying=true`);
    pass('assert.isPaused');
  },
  nowPlaying(titleSubstr: string) {
    const title = player().currentSong?.title ?? '';
    if (!title.toLowerCase().includes(titleSubstr.toLowerCase()))
      fail('assert.nowPlaying', `Expected title to contain "${titleSubstr}", got "${title}"`);
    pass('assert.nowPlaying', title);
  },
  route(path: string) {
    const actual = routerRef.location?.pathname ?? '';
    if (actual !== path) fail('assert.route', `Expected route "${path}", got "${actual}"`);
    pass('assert.route', actual);
  },
  queueLength(n: number) {
    const actual = player().queue.length;
    if (actual !== n) fail('assert.queueLength', `Expected queue length ${n}, got ${actual}`);
    pass('assert.queueLength', actual);
  },
  volume(v: number) {
    const actual = player().volume;
    if (Math.abs(actual - v) > 0.01) fail('assert.volume', `Expected volume ${v}, got ${actual}`);
    pass('assert.volume', actual);
  },
  isFavorite(id: string, expected = true) {
    const actual = player().isFavorite(id);
    if (actual !== expected) fail('assert.isFavorite', `Expected isFavorite("${id}")=${expected}, got ${actual}`);
    pass('assert.isFavorite', actual);
  },
  hasResults() {
    const len = useSearchStore.getState().results.length;
    if (len === 0) fail('assert.hasResults', 'Expected search results, got 0');
    pass('assert.hasResults', len);
  },
  noError() {
    const err = player().error;
    if (err) fail('assert.noError', `Playback error present: "${err}"`);
    pass('assert.noError');
  },
};
