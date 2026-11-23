import { create } from 'zustand';
import type { TrackItem, YTListItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';

const API_BASE = `${API_BASE_URL}/api`;
let activeSearch: AbortController | undefined;
let activeSuggestions: AbortController | undefined;

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

export async function searchWithResults(query: string, filter = 'all'): Promise<SearchState['results'] | undefined> {
  const { setState, getState } = useSearchStore;
  if (!query.trim()) {
    getState().clearSearch();
    return;
  }

  activeSearch?.abort();
  const request = new AbortController();
  activeSearch = request;
  setState({ isLoading: true, error: null, results: [], query, filter: filter || 'all' });

  try {
    const params = new URLSearchParams({ q: query });
    if (filter && filter !== 'all') params.set('f', filter);

    const res = await fetch(`${API_BASE}/search?${params}`, { signal: request.signal });
    if (!res.ok) throw new Error('Search failed');

    const data = await res.json();
    if (request.signal.aborted) return;
    const results: SearchState['results'] = Array.isArray(data) ? data : [];
    setState({ results, isLoading: false });
    return results;
  } catch (err) {
    if (request.signal.aborted) return;
    setState({
      error: err instanceof Error ? err.message : 'Search failed',
      isLoading: false,
      results: [],
    });
  }
}

export async function getSuggestionsWithResults(query: string): Promise<string[] | undefined> {
  const { setState } = useSearchStore;
  activeSuggestions?.abort();
  if (!query.trim()) {
    setState({ suggestions: [] });
    return;
  }

  const request = new AbortController();
  activeSuggestions = request;
  try {
    const params = new URLSearchParams({ q: query, music: 'true' });
    const res = await fetch(`${API_BASE}/search-suggestions?${params}`, { signal: request.signal });
    if (!res.ok) throw new Error('Suggestions failed');

    const data = await res.json();
    if (request.signal.aborted) return;
    const suggestions: string[] = Array.isArray(data) ? data : [];
    setState({ suggestions });
    return suggestions;
  } catch {
    if (request.signal.aborted) return;
    setState({ suggestions: [] });
  }
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  results: [],
  suggestions: [],
  isLoading: false,
  error: null,
  filter: 'all',

  search: async (query, filter) => {
    await searchWithResults(query, filter);
  },

  getSuggestions: async (query) => {
    await getSuggestionsWithResults(query);
  },

  clearSearch: () => {
    activeSearch?.abort();
    activeSuggestions?.abort();
    set({ query: '', results: [], suggestions: [], error: null, isLoading: false });
  }
}));
