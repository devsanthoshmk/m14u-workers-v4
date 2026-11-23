import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { getSuggestionsWithResults, searchWithResults, useSearchStore } from '@/lib/stores/search';
import { useListStore } from '@/lib/stores/list';
import type { TrackItem } from '@/types/music';
import { routerRef } from './router-ref';
import { errorMessage, logEntry, logger, onErrorEntry, type LogEntry } from './logger';
import { wait } from './wait';
import { assert } from './assert';
import { highlight, highlightButton, clearHighlights } from './highlight';

const player = () => usePlayerStore.getState();
const ui = () => useUIStore.getState();
const search = () => useSearchStore.getState();
const list = () => useListStore.getState();

let _lastError: LogEntry | null = null;

onErrorEntry((entry) => {
  _lastError = entry;
});

function act<T>(name: string, fn: () => T, payload?: unknown): T {
  const start = Date.now();
  try {
    const result = fn();
    logEntry({ type: 'ACTION', name, payload, result: result ?? 'ok', duration: Date.now() - start });
    return result;
  } catch (e) {
    logEntry({ type: 'ERROR', name, payload, error: errorMessage(e), duration: Date.now() - start });
    throw e;
  }
}

async function actAsync<T>(name: string, fn: () => Promise<T>, payload?: unknown): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logEntry({ type: 'ACTION', name, payload, result: result ?? 'ok', duration: Date.now() - start });
    return result;
  } catch (e) {
    logEntry({ type: 'ERROR', name, payload, error: errorMessage(e), duration: Date.now() - start });
    throw e;
  }
}

// Both tracks and list results pass through this display-only projection.
function simpleSong(s: Partial<Pick<TrackItem, 'id' | 'videoId' | 'title' | 'name' | 'author' | 'artist' | 'duration'>> | null) {
  if (!s) return null;
  return { id: s.id || s.videoId, title: s.title || s.name, author: s.author || s.artist?.name, duration: s.duration };
}

function isQueueIndex(index: number, length: number) {
  return Number.isInteger(index) && index >= 0 && index < length;
}

function simpleQueue() {
  return player().queue.map((q, i) => ({
    index: i,
    queueId: q.queueId,
    title: q.song.title || q.song.name,
    author: q.song.author || q.song.artist?.name,
    id: q.song.id || q.song.videoId,
  }));
}

const api = {
  // --- Navigation ---
  route(path: string) {
    return act('route', () => {
      if (!routerRef.navigate) throw new Error('Router not initialized — AppShell not mounted yet');
      logEntry({ type: 'NAV', name: 'navigate', payload: path });
      routerRef.navigate(path);
    }, path);
  },
  currentRoute() {
    return routerRef.location?.pathname ?? '/';
  },

  // --- Search ---
  async search(query: string, filter?: string) {
    return actAsync('search', async () => {
      const results = await searchWithResults(query, filter);
      return results?.map(simpleSong) ?? [];
    }, { query, filter });
  },
  async suggest(query: string) {
    return actAsync('suggest', async () => (await getSuggestionsWithResults(query)) ?? [], query);
  },
  clearSearch() {
    return act('clearSearch', () => search().clearSearch());
  },

  // --- Playback ---
  async play(songOrIndex?: TrackItem | number | string) {
    return actAsync('play', async () => {
      if (songOrIndex === undefined) {
        await player().togglePlay();
        return;
      }
      if (typeof songOrIndex === 'number') {
        const q = player().queue;
        if (!isQueueIndex(songOrIndex, q.length))
          throw new Error(`play: queue index ${songOrIndex} out of range (queue length: ${q.length})`);
        await player().playFromQueue(songOrIndex);
        return;
      }
      if (typeof songOrIndex === 'string') {
        const results = await searchWithResults(songOrIndex);
        // A newer search or Clear may have replaced these results before this continuation ran.
        const track = results && results === search().results
          ? results.find((r): r is TrackItem => r.type === 'song' || r.type === 'video')
          : undefined;
        if (!track) throw new Error(`play: no song found for "${songOrIndex}"`);
        await player().playSong(track);
        return;
      }
      await player().playSong(songOrIndex);
    }, songOrIndex);
  },
  pause() {
    return act('pause', () => {
      if (player().isPlaying) player().pause();
    });
  },
  async toggle() {
    return actAsync('toggle', () => player().togglePlay());
  },
  async next() {
    return actAsync('next', () => player().next());
  },
  async prev() {
    return actAsync('prev', () => player().previous());
  },
  seek(seconds: number) {
    return act('seek', () => player().seek(seconds), seconds);
  },
  nowPlaying() {
    const p = player();
    return {
      title: p.currentSong?.title || p.currentSong?.name || null,
      author: p.currentSong?.author || p.currentSong?.artist?.name || null,
      id: p.currentSong?.id || p.currentSong?.videoId || null,
      currentTime: p.currentTime,
      duration: p.duration,
      isPlaying: p.isPlaying,
    };
  },

  // --- Volume ---
  volume(level?: number) {
    if (level === undefined) return player().volume;
    return act('volume', () => player().setVolume(Math.max(0, Math.min(1, level))), level);
  },
  mute() { return act('mute', () => { if (!player().isMuted) player().toggleMute(); }); },
  unmute() { return act('unmute', () => { if (player().isMuted) player().toggleMute(); }); },
  toggleMute() { return act('toggleMute', () => player().toggleMute()); },

  // --- Queue ---
  queue: {
    list() { return simpleQueue(); },
    add(song: TrackItem) { return act('queue.add', () => player().addToQueue(song), simpleSong(song)); },
    addNext(song: TrackItem) { return act('queue.addNext', () => player().addNext(song), simpleSong(song)); },
    remove(index: number) {
      return act('queue.remove', () => {
        const q = player().queue;
        if (!isQueueIndex(index, q.length)) throw new Error(`queue.remove: index ${index} out of range`);
        player().removeFromQueue(q[index].queueId);
      }, index);
    },
    clear() { return act('queue.clear', () => player().clearQueue()); },
    async playAt(index: number) {
      return actAsync('queue.playAt', async () => {
        if (!isQueueIndex(index, player().queue.length))
          throw new Error(`queue.playAt: index ${index} out of range`);
        await player().playFromQueue(index);
      }, index);
    },
    reorder(from: number, to: number) {
      return act('queue.reorder', () => {
        const { queue, reorderQueue } = player();
        if (!isQueueIndex(from, queue.length) || !isQueueIndex(to, queue.length))
          throw new Error(`queue.reorder: indices ${from}, ${to} out of range (queue length: ${queue.length})`);
        reorderQueue(from, to);
      }, { from, to });
    },
    length() { return player().queue.length; },
  },

  // --- Shuffle & Repeat ---
  shuffle() { return act('shuffle', () => player().toggleShuffle()); },
  repeat(mode?: Parameters<ReturnType<typeof player>['setRepeatMode']>[0]) {
    if (mode === undefined) return player().repeatMode;
    return act('repeat', () => player().setRepeatMode(mode), mode);
  },

  // --- Favorites ---
  favorites: {
    list() { return player().favorites.map(f => simpleSong(f.song)); },
    toggle(song: TrackItem) { return act('favorites.toggle', () => player().toggleFavorite(song), simpleSong(song)); },
    isFav(videoId: string) { return player().isFavorite(videoId); },
    async playAll() {
      return actAsync('favorites.playAll', async () => {
        const favs = player().favorites;
        if (!favs.length) throw new Error('favorites.playAll: no favorites');
        const songs = favs.map(f => f.song);
        await player().setQueue(songs, 0);
      });
    },
    async shufflePlay() {
      return actAsync('favorites.shufflePlay', async () => {
        const favs = player().favorites;
        if (!favs.length) throw new Error('favorites.shufflePlay: no favorites');
        const songs = favs.map(f => f.song);
        // Shuffle the input without changing the player's shuffle mode.
        for (let i = songs.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [songs[i], songs[j]] = [songs[j], songs[i]];
        }
        await player().setQueue(songs, 0);
      });
    },
    count() { return player().favorites.length; },
  },

  // --- History ---
  history() {
    return player().listeningHistory.map(h => ({
      ...simpleSong(h.song),
      playedAt: h.playedAt,
      listenedDuration: h.listenedDuration,
    }));
  },

  // --- UI Panels ---
  panels: {
    toggleQueue() { return act('panels.toggleQueue', () => ui().toggleQueue()); },
    toggleLyrics() { return act('panels.toggleLyrics', () => ui().toggleLyrics()); },
    toggleSidebar() { return act('panels.toggleSidebar', () => ui().toggleSidebar()); },
    openQueue() { return act('panels.openQueue', () => ui().setQueueOpen(true)); },
    closeQueue() { return act('panels.closeQueue', () => ui().setQueueOpen(false)); },
    openLyrics() { return act('panels.openLyrics', () => ui().setLyricsOpen(true)); },
    closeLyrics() { return act('panels.closeLyrics', () => ui().setLyricsOpen(false)); },
    state() {
      return { queue: ui().isQueueOpen, lyrics: ui().isLyricsOpen, sidebar: ui().isSidebarOpen };
    },
  },

  // --- Wait ---
  wait,

  // --- Assert ---
  assert,

  // --- Logging ---
  log: logger,

  // --- Error ---
  lastError() { return _lastError; },
  onError: onErrorEntry,
  clearErrors() { _lastError = null; },

  // --- Highlight ---
  highlight,
  highlightButton,
  clearHighlights,

  // --- State (raw debug) ---
  state: {
    player() { return player(); },
    ui() { return ui(); },
    search() { return search(); },
    list() { return list(); },
  },

  // --- Content Loading ---
  load: {
    async album(id: string) { return actAsync('load.album', () => list().loadAlbum(id), id); },
    async artist(id: string) { return actAsync('load.artist', () => list().loadArtist(id), id); },
    async playlist(id: string, all?: boolean) { return actAsync('load.playlist', () => list().loadPlaylist(id, all), { id, all }); },
    async channel(id: string) { return actAsync('load.channel', () => list().loadChannel(id), id); },
  },

  // --- Meta ---
  help() {
    const cmds = [
      'route(path)', 'currentRoute()', 'search(q, filter?)', 'suggest(q)', 'clearSearch()',
      'play(songOrIndex?)', 'pause()', 'toggle()', 'next()', 'prev()', 'seek(s)', 'nowPlaying()',
      'volume(level?)', 'mute()', 'unmute()', 'toggleMute()',
      'queue.list()', 'queue.add(song)', 'queue.addNext(song)', 'queue.remove(i)', 'queue.clear()',
      'queue.playAt(i)', 'queue.reorder(from,to)', 'queue.length()',
      'shuffle()', 'repeat(mode?)',
      'favorites.list()', 'favorites.toggle(song)', 'favorites.isFav(id)', 'favorites.playAll()',
      'favorites.shufflePlay()', 'favorites.count()',
      'history()',
      'panels.toggleQueue()', 'panels.toggleLyrics()', 'panels.toggleSidebar()',
      'panels.openQueue()', 'panels.closeQueue()', 'panels.openLyrics()', 'panels.closeLyrics()', 'panels.state()',
      'wait.forPlaybackStart()', 'wait.forPlaybackPause()', 'wait.forRoute(path)',
      'wait.forResults()', 'wait.forQueueLength(n)', 'wait.forTime(s)', 'wait.forBuffering()',
      'wait.forSong(title)', 'wait.for(predicate, label)',
      'assert.isPlaying()', 'assert.isPaused()', 'assert.nowPlaying(title)', 'assert.route(path)',
      'assert.queueLength(n)', 'assert.volume(v)', 'assert.isFavorite(id)', 'assert.hasResults()', 'assert.noError()',
      'log.enable()', 'log.disable()', 'log.get()', 'log.last(n)', 'log.clear()', 'log.errors()',
      'lastError()', 'onError(cb)', 'clearErrors()',
      'highlight(sel, label?)', 'highlightButton(text)', 'clearHighlights()',
      'state.player()', 'state.ui()', 'state.search()', 'state.list()',
      'load.album(id)', 'load.artist(id)', 'load.playlist(id, all?)', 'load.channel(id)',
      'help()', 'version()',
    ];
    console.log('%cm14u Console API', 'font-size:16px;font-weight:bold;color:#ff3b6b');
    console.log('Commands:', cmds.join('\n  m14u.'));
    return cmds;
  },
  version() { return '1.0.0'; },
};

declare global {
  interface Window {
    m14u: typeof api;
  }
}

export function registerConsoleAPI() {
  window.m14u = api;
  console.log(
    '%c🎵 m14u console API ready — type m14u.help() for commands',
    'color:#ff3b6b;font-weight:bold',
  );
}
