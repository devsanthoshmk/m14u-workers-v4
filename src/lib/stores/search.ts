import { create } from 'zustand';
import type { TrackItem, YTListItem } from '@/types/music';
import { searchCatalog, suggestCatalog } from '@/services/catalog';
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
    const results = await searchCatalog(query.trim(), filter || 'all', request.signal);
    if (request.signal.aborted) return;
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
    const suggestions = await suggestCatalog(query.trim(), request.signal);
    if (request.signal.aborted) return;
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
