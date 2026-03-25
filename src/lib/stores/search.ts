import { create } from 'zustand';
import type { TrackItem, YTListItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';

const API_BASE = `${API_BASE_URL}/api`;

interface SearchState {
  query: string;
  results: (TrackItem | YTListItem)[];
  suggestions: string[];
  isLoading: boolean;
  error: string | null;
  filter: string;
  
  search: (query: string, filter?: string) => Promise<void>;
  getSuggestions: (query: string) => Promise<void>;
  clearSearch: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  results: [],
  suggestions: [],
  isLoading: false,
  error: null,
  filter: 'all',

  search: async (query: string, filter?: string) => {
    if (!query.trim()) {
      set({ results: [], query: '' });
      return;
    }

    set({ isLoading: true, error: null, query, filter: filter || 'all' });

    try {
      const f = filter || get().filter;
      const params = new URLSearchParams({ q: query });
      if (f && f !== 'all') params.set('f', f);
      
      const res = await fetch(`${API_BASE}/search?${params}`);
      if (!res.ok) throw new Error('Search failed');
      
      const data = await res.json();
      set({ results: Array.isArray(data) ? data : [], isLoading: false });
    } catch (err) {
      set({ 
        error: err instanceof Error ? err.message : 'Search failed', 
        isLoading: false,
        results: [] 
      });
    }
  },

  getSuggestions: async (query: string) => {
    if (!query.trim()) {
      set({ suggestions: [] });
      return;
    }

    try {
      const params = new URLSearchParams({ q: query, music: 'true' });
      const res = await fetch(`${API_BASE}/search-suggestions?${params}`);
      if (!res.ok) throw new Error('Suggestions failed');
      
      const data = await res.json();
      set({ suggestions: Array.isArray(data) ? data : [] });
    } catch {
      set({ suggestions: [] });
    }
  },

  clearSearch: () => {
    set({ query: '', results: [], suggestions: [], error: null });
  }
}));
