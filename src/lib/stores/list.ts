import { create } from 'zustand';
import type { TrackItem, YTListItem } from '@/types/music';

const API_BASE = '/api';

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

export const useListStore = create<ListState>((set) => ({
  currentList: null,
  isLoading: false,
  error: null,

  loadAlbum: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/album?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('Failed to load album');
      const data = await res.json();
      set({ 
        currentList: {
          id,
          name: data.name,
          type: 'album',
          items: data.items || [],
          img: data.img,
          author: data.author,
          year: data.year
        },
        isLoading: false 
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load album', isLoading: false });
    }
  },

  loadArtist: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/artist?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('Failed to load artist');
      const data = await res.json();
      set({ 
        currentList: {
          id,
          name: data.name,
          type: 'artist',
          items: data.items || [],
          img: data.img,
          albums: data.albums
        },
        isLoading: false 
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load artist', isLoading: false });
    }
  },

  loadPlaylist: async (id: string, all?: boolean) => {
    set({ isLoading: true, error: null });
    try {
      const params = new URLSearchParams({ id });
      if (all) params.set('all', 'true');
      const res = await fetch(`${API_BASE}/playlist?${params}`);
      if (!res.ok) throw new Error('Failed to load playlist');
      const data = await res.json();
      set({ 
        currentList: {
          id,
          name: data.name,
          type: 'playlist',
          items: data.items || [],
          img: data.img,
          author: data.author
        },
        isLoading: false 
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load playlist', isLoading: false });
    }
  },

  loadChannel: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/channel?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('Failed to load channel');
      const data = await res.json();
      set({ 
        currentList: {
          id,
          name: data.name,
          type: 'channel',
          items: data.items || [],
          img: data.img
        },
        isLoading: false 
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load channel', isLoading: false });
    }
  },

  loadGallery: async (ids: string[]) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/gallery?id=${ids.join(',')}`);
      if (!res.ok) throw new Error('Failed to load gallery');
      await res.json(); // consume response
      set({ 
        currentList: {
          id: 'gallery',
          name: 'Your Library',
          type: 'playlist',
          items: [],
          albums: []
        },
        isLoading: false 
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load gallery', isLoading: false });
    }
  },

  clearList: () => {
    set({ currentList: null, error: null });
  }
}));
