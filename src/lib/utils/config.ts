import type { TrackItem } from '@/types/music';

export let config = {
  language: '',
  shareAction: 'play' as 'play' | 'watch' | 'download',
  quality: 'medium' as 'low' | 'medium' | 'high' | 'worst',
  stableVolume: false,
  watchMode: '',
  discover: true,
  history: true,
  searchBarLinkCapture: true,
  searchSuggestions: true,
  saveRecentSearches: true,
  loadImage: true,
  landscapeSections: '2',
  roundness: '0.4rem',
  theme: 'auto' as 'auto' | 'light' | 'dark',
  persistentShuffle: false,
  durationFilter: '',
  similarContent: false,
  contextualFill: false,
  queuePrefetch: false,
  authorGrouping: false,
  searchFilter: 'all',
  volume: '100',
  dbsync: '',
  sortBy: 'modified' as 'modified' | 'name' | 'artist' | 'duration',
  sortOrder: 'desc' as 'asc' | 'desc'
};

type AppConfig = typeof config;

const savedStore = localStorage.getItem('config');
if (savedStore) {
  try {
    const parsed = JSON.parse(savedStore) as Record<string, unknown>;
    (Object.keys(config) as (keyof AppConfig)[]).forEach(key => {
      if (parsed[key] !== undefined) {
        (config as Record<keyof AppConfig, unknown>)[key] = parsed[key];
      }
    });
  } catch (e) {
    console.error('Failed to parse config:', e);
  }
}

export function setConfig<K extends keyof AppConfig>(key: K, val: AppConfig[K]) {
  config[key] = val;
  const str = JSON.stringify(config);
  localStorage.setItem('config', str);
}

export let drawer = {
  recentSearches: [] as string[],
  discovery: [] as (TrackItem & { frequency: number })[],
  lastMainFeature: 'search' as 'search' | 'library',
  libraryPlays: {} as Record<string, number>,
};

const savedDrawer = localStorage.getItem('drawer');
if (savedDrawer) {
  try {
    const parsed = JSON.parse(savedDrawer) as Record<string, unknown>;
    (Object.keys(drawer) as (keyof typeof drawer)[]).forEach(key => {
      if (parsed[key] !== undefined) {
        (drawer as Record<keyof typeof drawer, unknown>)[key] = parsed[key];
      }
    });
  } catch (e) {
    console.error('Failed to parse drawer:', e);
  }
}

export function setDrawer<K extends keyof typeof drawer>(key: K, val: typeof drawer[K]) {
  drawer[key] = val;
  const str = JSON.stringify(drawer);
  localStorage.setItem('drawer', str);
}
