import { create } from 'zustand';
import type { TrackItem, YTListItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';

const API_BASE = `${API_BASE_URL.replace(/\/+$/, '')}/api`;

interface ListState {
  currentList: {
    id: string;
    name: string;
    type: 'album' | 'artist' | 'playlist' | 'channel';
    items: TrackItem[];
    img?: string;
    author?: string;
    year?: string;
    albums?: YTListItem[];
    hasContinuation?: boolean;
  } | null;
  isLoading: boolean;
  error: string | null;

  loadAlbum: (id: string) => Promise<void>;
  loadArtist: (id: string) => Promise<void>;
  loadPlaylist: (id: string, all?: boolean) => Promise<void>;
  loadChannel: (id: string) => Promise<void>;
  loadGallery: (ids: string[]) => Promise<void>;
  clearList: () => void;
}

type ListPayload = Pick<NonNullable<ListState['currentList']>, 'name' | 'img' | 'author' | 'year' | 'albums' | 'hasContinuation'> & {
  items?: TrackItem[];
  userArtists?: YTListItem[];
  relatedArtists?: YTListItem[];
  relatedPlaylists?: YTListItem[];
};

export const useListStore = create<ListState>((set) => {
  let activeRequest: AbortController | undefined;

  async function load(
    kind: NonNullable<ListState['currentList']>['type'] | 'gallery',
    query: string,
    toList: (data: ListPayload) => NonNullable<ListState['currentList']>,
  ) {
    const previous = activeRequest;
    const request = new AbortController();
    activeRequest = request;
    previous?.abort();
    if (activeRequest !== request) return;
    set({ isLoading: true, error: null });
    if (activeRequest !== request) return;

    const failure = `Failed to load ${kind}`;
    try {
      const res = await fetch(`${API_BASE}/${kind}?${query}`, { signal: request.signal });
      if (!res.ok) throw new Error(failure);
      const data: ListPayload = await res.json();
      if (activeRequest !== request) return;
      set({ currentList: toList(data), isLoading: false });
    } catch (err) {
      if (activeRequest !== request) return;
      set({ error: err instanceof Error ? err.message : failure, isLoading: false });
    } finally {
      if (activeRequest === request) activeRequest = undefined;
    }
  }

  return {
    currentList: null,
    isLoading: false,
    error: null,

    loadAlbum: (id) => load('album', `id=${encodeURIComponent(id)}`, (data) => ({
      id,
      name: data.name,
      type: 'album',
      items: data.items || [],
      img: data.img,
      author: data.author,
      year: data.year,
    })),

    loadArtist: (id) => load('artist', `id=${encodeURIComponent(id)}`, (data) => ({
      id,
      name: data.name,
      type: 'artist',
      items: data.items || [],
      img: data.img,
      albums: data.albums,
    })),

    loadPlaylist: (id, all) => {
      const params = new URLSearchParams({ id });
      if (all) params.set('all', 'true');
      return load('playlist', params.toString(), (data) => ({
        id,
        name: data.name,
        type: 'playlist',
        items: data.items || [],
        img: data.img,
        author: data.author,
        ...(typeof data.hasContinuation === 'boolean' ? { hasContinuation: data.hasContinuation } : {}),
      }));
    },

    loadChannel: (id) => load('channel', `id=${encodeURIComponent(id)}`, (data) => ({
      id,
      name: data.name,
      type: 'channel',
      items: data.items || [],
      img: data.img,
    })),

    loadGallery: (ids) => load('gallery', `id=${ids.map(encodeURIComponent).join(',')}`, (data) => ({
      id: 'gallery',
      name: 'Your Library',
      type: 'playlist',
      items: [],
      albums: [
        ...(data.userArtists ?? []),
        ...(data.relatedArtists ?? []),
        ...(data.relatedPlaylists ?? []),
      ],
    })),

    clearList: () => {
      const previous = activeRequest;
      activeRequest = undefined;
      set({ currentList: null, error: null, isLoading: false });
      previous?.abort();
    },
  };
});
