import { create } from 'zustand';
import type { TrackItem, YTListItem } from '@/types/music';
import { API_BASE_URL } from '@/utils/constants';
import { isNative } from '@/lib/utils/platform';
import { useCatalogStore } from '@/stores/catalogStore';
import { useListeningPreferences } from '@/stores/listeningPreferences';
import { rankSongsByLanguage } from '@/lib/utils/musicLanguage';
import { searchJioSaavn } from '@/services/jiosaavn';
import { findMoreByArtist, findSaavnAlternatives, findSaavnMatch, findYouTubeSong } from '@/services/saavnDiscovery';
import { useSaavnFallbackStore } from '@/services/saavnFallback';
import { anyAbortSignal, timeoutAbortSignal } from '@/lib/modules/resolver/abortSignal';

const API_BASE = `${API_BASE_URL}/api`;
let activeSearch: AbortController | undefined;
let activeSuggestions: AbortController | undefined;

interface SearchDiscovery {
  song: Pick<TrackItem, 'title' | 'author'>;
  alternatives: TrackItem[];
  loading: boolean;
  sameArtist?: boolean;
}

interface SearchState {
  query: string;
  results: (TrackItem | YTListItem)[];
  suggestions: string[];
  isLoading: boolean;
  error: string | null;
  filter: string;
  discovery: SearchDiscovery | null;
  
  search: (query: string, filter?: string) => Promise<void>;
  getSuggestions: (query: string) => Promise<void>;
  clearSearch: () => void;
}

async function enrichSaavnSearch(seedLookup: ReturnType<typeof findYouTubeSong>, results: TrackItem[], request: AbortController) {
  const { setState } = useSearchStore;
  const timeout = timeoutAbortSignal(12000);
  const combined = anyAbortSignal([request.signal, timeout.signal]);
  const signal = combined.signal;
  let discovery: SearchDiscovery | undefined;
  try {
    const seed = await seedLookup;
    if (!seed || signal.aborted) return;
    const match = await findSaavnMatch(seed, results, signal);
    if (signal.aborted) return;
    if (match) {
      if (!results.some(track => track.id === match.id)) setState({ results: [match, ...results] });
      return;
    }
    discovery = { song: seed, alternatives: [], loading: true };
    setState({ discovery });
    const recTimeout = timeoutAbortSignal(10000);
    const recCombined = anyAbortSignal([request.signal, recTimeout.signal]);
    let alternatives: TrackItem[] = [];
    try {
      alternatives = await findSaavnAlternatives(seed, results, recCombined.signal).catch(() => []);
    } finally {
      recCombined.cleanup();
      recTimeout.cleanup();
    }
    if (request.signal.aborted) return;
    if (alternatives.length) {
      discovery = { ...discovery, alternatives };
    } else {
      const artistTimeout = timeoutAbortSignal(5000);
      const artistCombined = anyAbortSignal([request.signal, artistTimeout.signal]);
      try {
        const tracks = await findMoreByArtist(seed, results, artistCombined.signal);
        if (!artistCombined.signal.aborted) discovery = { ...discovery, alternatives: tracks, sameArtist: true };
      } finally {
        artistCombined.cleanup();
        artistTimeout.cleanup();
      }
    }
  } catch {
    // Discovery is optional; don't replace the primary search with an error.
  } finally {
    combined.cleanup();
    timeout.cleanup();
    if (discovery && !request.signal.aborted) setState({ discovery: { ...discovery, loading: false } });
  }
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
  const { languages, language } = useListeningPreferences.getState();
  const targetLanguages = languages.length > 0 ? languages : language;
  setState({ isLoading: true, error: null, results: [], discovery: null, query, filter: filter || 'all' });

  try {
    const fallback = isNative() ? useSaavnFallbackStore.getState() : null;
    if (fallback && fallback.enabled && fallback.mode === 'jiosaavn-fallback') {
      void fallback.maybeProbeRecovery();
      const saavnResults = await searchJioSaavn(query, request.signal, undefined, { allowNative: true });
      if (request.signal.aborted) return;
      const results = rankSongsByLanguage(saavnResults, targetLanguages, query);
      setState({ results, isLoading: false });
      return results;
    }
    if (!isNative() && useCatalogStore.getState().provider === 'jiosaavn') {
      const primary = searchJioSaavn(query, request.signal);
      const seedTimeout = timeoutAbortSignal(8000);
      const seedCombined = anyAbortSignal([request.signal, seedTimeout.signal]);
      const seed = findYouTubeSong(query, seedCombined.signal)
        .catch(() => undefined)
        .finally(() => {
          seedCombined.cleanup();
          seedTimeout.cleanup();
        });
      const results = rankSongsByLanguage(await primary, targetLanguages, query);
      if (request.signal.aborted) return;
      setState({ results, isLoading: false });
      void enrichSaavnSearch(seed, results, request);
      return results;
    }
    const params = new URLSearchParams({ q: query });
    if (isNative()) params.set('catalog', 'youtube');
    if (filter && filter !== 'all') params.set('f', filter);

    const data = await fetch(`${API_BASE}/search?${params}`, { signal: request.signal }).then(res => {
          if (!res.ok) throw new Error('Search failed');
          return res.json();
        });
    if (request.signal.aborted) return;
    const results: SearchState['results'] = Array.isArray(data) ? rankSongsByLanguage(data, targetLanguages, query) : [];
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
    const fallback = isNative() ? useSaavnFallbackStore.getState() : null;
    const useAndroidSaavnFallback = Boolean(fallback && fallback.enabled && fallback.mode === 'jiosaavn-fallback');
    if (useAndroidSaavnFallback) {
      void fallback!.maybeProbeRecovery();
    }
    const params = new URLSearchParams({ q: query, music: 'true' });
    if (isNative()) params.set('catalog', 'youtube');
    const data = useAndroidSaavnFallback
      ? [...new Set((await searchJioSaavn(query, request.signal, 8, { allowNative: true })).map(track => track.title))].slice(0, 8)
      : !isNative() && useCatalogStore.getState().provider === 'jiosaavn'
      ? [...new Set((await searchJioSaavn(query, request.signal)).map(track => track.title))].slice(0, 8)
      : await fetch(`${API_BASE}/search-suggestions?${params}`, { signal: request.signal }).then(res => {
          if (!res.ok) throw new Error('Suggestions failed');
          return res.json();
        });
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
  discovery: null,

  search: async (query, filter) => {
    await searchWithResults(query, filter);
  },

  getSuggestions: async (query) => {
    await getSuggestionsWithResults(query);
  },

  clearSearch: () => {
    activeSearch?.abort();
    activeSuggestions?.abort();
    set({ query: '', results: [], suggestions: [], discovery: null, error: null, isLoading: false });
  }
}));

useCatalogStore.subscribe((state, previous) => {
  if (state.provider !== previous.provider) useSearchStore.getState().clearSearch();
});

useListeningPreferences.subscribe((state, previous) => {
  const curLangs = state.languages.join(',');
  const prevLangs = previous.languages.join(',');
  if (curLangs === prevLangs && state.language === previous.language) return;
  const { query, filter } = useSearchStore.getState();
  activeSuggestions?.abort();
  useSearchStore.setState({ suggestions: [] });
  if (query.trim()) void searchWithResults(query, filter);
});
