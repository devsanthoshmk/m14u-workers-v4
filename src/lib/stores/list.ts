import { create } from 'zustand';
import type { TrackItem, YTListItem } from '@/types/music';
import { loadCatalogGallery, loadCatalogList } from '@/services/catalog';

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

export const useListStore = create<ListState>((set) => {
  let activeRequest: AbortController | undefined;

  async function load(
    kind: string,
    fetchList: (signal: AbortSignal) => Promise<NonNullable<ListState['currentList']>>,
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
      const currentList = await fetchList(request.signal);
      if (activeRequest !== request) return;
      set({ currentList, isLoading: false });
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

    loadAlbum: (id) => load('album', signal => loadCatalogList('album', id, false, signal)),
    loadArtist: (id) => load('artist', signal => loadCatalogList('artist', id, false, signal)),
    loadPlaylist: (id, all = false) => load('playlist', signal => loadCatalogList('playlist', id, all, signal)),
    loadChannel: (id) => load('channel', signal => loadCatalogList('channel', id, false, signal)),
    loadGallery: (ids) => load('gallery', signal => loadCatalogGallery(ids, signal)),

    clearList: () => {
      const previous = activeRequest;
      activeRequest = undefined;
      set({ currentList: null, error: null, isLoading: false });
      previous?.abort();
    },
  };
});
