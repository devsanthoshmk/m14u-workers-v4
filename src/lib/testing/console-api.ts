import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { useSearchStore } from '@/lib/stores/search';
import { useListStore } from '@/lib/stores/list';
import { routerRef } from './router-ref';
import { logEntry, logger, onErrorEntry, type LogEntry } from './logger';
import { wait } from './wait';
import { assert } from './assert';
import { highlight, highlightButton, clearHighlights } from './highlight';
import DevTunnel from '@/plugins/DevTunnel';
import { useListenAlongStore } from '@/stores/listenAlongStore';

const player = () => usePlayerStore.getState();
const ui = () => useUIStore.getState();
const search = () => useSearchStore.getState();
const list = () => useListStore.getState();
const listenAlong = () => useListenAlongStore.getState();

let _lastError: LogEntry | null = null;
const _errorCallbacks: Array<(e: LogEntry) => void> = [];

onErrorEntry((entry) => {
  _lastError = entry;
  _errorCallbacks.forEach(fn => fn(entry));
});

function act<T>(name: string, fn: () => T, payload?: any): T {
  const start = Date.now();
  try {
    const result = fn();
    logEntry({ type: 'ACTION', name, payload, result: result ?? 'ok', duration: Date.now() - start });
    return result;
  } catch (e: any) {
    logEntry({ type: 'ERROR', name, payload, error: e.message, duration: Date.now() - start });
    throw e;
  }
}

async function actAsync<T>(name: string, fn: () => Promise<T>, payload?: any): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logEntry({ type: 'ACTION', name, payload, result: result ?? 'ok', duration: Date.now() - start });
    return result;
  } catch (e: any) {
    logEntry({ type: 'ERROR', name, payload, error: e.message, duration: Date.now() - start });
    throw e;
  }
}

function simpleSong(s: any) {
  if (!s) return null;
  return { id: s.id || s.videoId, title: s.title || s.name, author: s.author || s.artist?.name, duration: s.duration };
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
      await search().search(query, filter);
      return useSearchStore.getState().results.map(simpleSong);
    }, { query, filter });
  },
  async suggest(query: string) {
    return actAsync('suggest', async () => {
      await search().getSuggestions(query);
      return useSearchStore.getState().suggestions;
    }, query);
  },
  clearSearch() {
    return act('clearSearch', () => search().clearSearch());
  },

  // --- Playback ---
  async play(songOrIndex?: any) {
    return actAsync('play', async () => {
      if (songOrIndex === undefined) {
        player().togglePlay();
        return;
      }
      if (typeof songOrIndex === 'number') {
        const q = player().queue;
        if (songOrIndex < 0 || songOrIndex >= q.length)
          throw new Error(`play: queue index ${songOrIndex} out of range (queue length: ${q.length})`);
        player().playFromQueue(songOrIndex);
        return;
      }
      if (typeof songOrIndex === 'string') {
        await search().search(songOrIndex);
        const results = useSearchStore.getState().results;
        const track = results.find((r: any) => r.type === 'song' || r.type === 'video');
        if (!track) throw new Error(`play: no song found for "${songOrIndex}"`);
        player().playSong(track as any);
        return;
      }
      player().playSong(songOrIndex);
    }, songOrIndex);
  },
  pause() {
    return act('pause', () => {
      if (player().isPlaying) player().togglePlay();
    });
  },
  async toggle() {
    return act('toggle', () => player().togglePlay());
  },
  async next() {
    return act('next', () => player().next());
  },
  async prev() {
    return act('prev', () => player().previous());
  },
  seek(seconds: number) {
    return act('seek', () => player().seek(seconds), seconds);
  },
  nowPlaying() {
    const p = player();
    return {
      title: p.currentSong?.title || p.currentSong?.name || null,
      author: p.currentSong?.author || (p.currentSong as any)?.artist?.name || null,
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
    add(song: any) { return act('queue.add', () => player().addToQueue(song), simpleSong(song)); },
    addNext(song: any) { return act('queue.addNext', () => player().addNext(song), simpleSong(song)); },
    remove(index: number) {
      return act('queue.remove', () => {
        const q = player().queue;
        if (index < 0 || index >= q.length) throw new Error(`queue.remove: index ${index} out of range`);
        player().removeFromQueue(q[index].queueId);
      }, index);
    },
    clear() { return act('queue.clear', () => player().clearQueue()); },
    async playAt(index: number) {
      return act('queue.playAt', () => {
        if (index < 0 || index >= player().queue.length)
          throw new Error(`queue.playAt: index ${index} out of range`);
        player().playFromQueue(index);
      }, index);
    },
    reorder(from: number, to: number) {
      return act('queue.reorder', () => player().reorderQueue(from, to), { from, to });
    },
    length() { return player().queue.length; },
  },

  // --- Shuffle & Repeat ---
  shuffle() { return act('shuffle', () => player().toggleShuffle()); },
  repeat(mode?: any) {
    if (mode === undefined) return player().repeatMode;
    return act('repeat', () => player().setRepeatMode(mode), mode);
  },

  // --- Favorites ---
  favorites: {
    list() { return player().favorites.map(f => simpleSong(f.song)); },
    toggle(song: any) { return act('favorites.toggle', () => player().toggleFavorite(song), simpleSong(song)); },
    isFav(videoId: string) { return player().isFavorite(videoId); },
    async playAll() {
      return act('favorites.playAll', () => {
        const favs = player().favorites;
        if (!favs.length) throw new Error('favorites.playAll: no favorites');
        const songs = favs.map(f => f.song);
        player().setQueue(songs, 0);
      });
    },
    async shufflePlay() {
      return act('favorites.shufflePlay', () => {
        const favs = player().favorites;
        if (!favs.length) throw new Error('favorites.shufflePlay: no favorites');
        const songs = [...favs.map(f => f.song)].sort(() => Math.random() - 0.5);
        player().setQueue(songs, 0);
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
  onError(callback: (e: LogEntry) => void) {
    _errorCallbacks.push(callback);
    return () => {
      const i = _errorCallbacks.indexOf(callback);
      if (i >= 0) _errorCallbacks.splice(i, 1);
    };
  },
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

  // --- Dev Tunnel ---
  async socketit(username: string, port?: number) {
    return actAsync('socketit', async () => {
      if (!username) throw new Error('socketit: username is required');

      // Auto-attach structured log listener for cloudflared output
      DevTunnel.addListener('tunnelLog', (e) => {
        const levelColors: Record<string, string> = {
          info: 'color:#00ff88', warn: 'color:#ffaa00;font-weight:bold',
          error: 'color:#ff3b3b;font-weight:bold', debug: 'color:#888',
          fatal: 'color:#ff0000;font-weight:bold;text-decoration:underline',
        };
        const style = levelColors[e.level] || 'color:#ccc';
        const fields = e.fields ? ` ${JSON.stringify(e.fields)}` : '';
        const ts = e.timestamp ? `[${e.timestamp}] ` : '';
        const logFn = e.level === 'error' || e.level === 'fatal' ? console.error
          : e.level === 'warn' ? console.warn : console.log;
        logFn(`%c[cf:${e.level}] ${ts}${e.message}${fields}`, style);
      });

      // Listen for panic (auto-restart) events
      DevTunnel.addListener('tunnelPanic', (e) => {
        if (e.type === 'restarting') console.warn(`%c⚠️ PANIC: Tunnel died (${e.reason}), restarting (attempt ${e.attempt})...`, 'color:#ffaa00;font-weight:bold');
        if (e.type === 'restarted') console.log(`%c✅ Tunnel restarted: ${e.newUrl}`, 'color:#00ff88;font-weight:bold');
        if (e.type === 'failed') console.error(`%c❌ Tunnel permanently failed after ${e.attempt} attempts`, 'color:#ff0000;font-weight:bold');
      });

      const { url } = await DevTunnel.startTunnel({ username, port: port ?? 8080 });
      console.log(`%c⚡ Tunnel live: ${url}`, 'color:#00ff88;font-weight:bold');
      console.log(`%c📡 Published to: m14u.sanpro.workers.dev/?key=${username}`, 'color:#ff3b6b');
      return url;
    }, { username, port });
  },
  async sockmsg(message: string) {
    return actAsync('sockmsg', async () => {
      if (!message) throw new Error('sockmsg: message is required');
      const { sent, clients } = await DevTunnel.sendMessage({ message });
      console.log(`%c📤 Sent to ${clients} client(s): ${sent}`, 'color:#00ff88');
      return { sent, clients };
    }, message);
  },
  async sockstop() {
    return actAsync('sockstop', async () => {
      await DevTunnel.stopTunnel();
      console.log('%c🔌 Tunnel stopped', 'color:#ff3b6b;font-weight:bold');
    });
  },
  async sockurl() {
    const { url } = await DevTunnel.getTunnelUrl();
    return url || null;
  },

  // --- Listen Along / Room ---
  room: {
    async create(name: string) {
      return actAsync('room.create', async () => {
        if (!name) throw new Error('room.create: room name is required');
        const url = await listenAlong().createRoom(name);
        console.log(`%c📡 Room "${name}" created: ${url}`, 'color:#00ff88;font-weight:bold');
        console.log(`%c🔗 Share: https://m14u.pages.dev/room/${name}`, 'color:#ff3b6b');
        return url;
      }, name);
    },
    async join(name: string) {
      return actAsync('room.join', async () => {
        if (!name) throw new Error('room.join: room name is required');
        await listenAlong().joinRoom(name);
        console.log(`%c🎧 Joined room "${name}"`, 'color:#00ff88;font-weight:bold');
      }, name);
    },
    leave() {
      return act('room.leave', () => {
        listenAlong().leaveRoom();
        console.log('%c👋 Left room', 'color:#ff3b6b;font-weight:bold');
      });
    },
    state() {
      const s = listenAlong();
      return {
        isInRoom: s.isInRoom,
        isHost: s.isHost,
        roomName: s.roomName,
        tunnelUrl: s.tunnelUrl,
        connectionStatus: s.connectionStatus,
        roomState: s.roomState,
        error: s.error,
      };
    },
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
      'socketit(username, port?)', 'sockmsg(message)', 'sockstop()', 'sockurl()',
      'room.create(name)', 'room.join(name)', 'room.leave()', 'room.state()',
      'help()', 'version()',
    ];
    console.log('%cm14u Console API', 'font-size:16px;font-weight:bold;color:#ff3b6b');
    console.log('Commands:', cmds.join('\n  m14u.'));
    return cmds;
  },
  version() { return '1.0.0'; },
};

export function registerConsoleAPI() {
  (window as any).m14u = api;
  console.log(
    '%c🎵 m14u console API ready — type m14u.help() for commands',
    'color:#ff3b6b;font-weight:bold',
  );
}
