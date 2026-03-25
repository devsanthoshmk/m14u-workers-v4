/**
 * UI Store — controls transient UI state like panels, modals, and locale.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/utils/constants';

interface UIStore {
    // Panel visibility
    isQueueOpen: boolean;
    isLyricsOpen: boolean;
    isSidebarOpen: boolean;
    isSearchFocused: boolean;

    // Locale
    userLocale: string;
    onboardingDone: boolean;

    // Recent searches
    recentSearches: string[];

    // Mobile now playing
    isNowPlayingExpanded: boolean;

    // Listen Along room panel
    isRoomPanelOpen: boolean;

    // Snackbar
    snackbar: string;

    // Actions
    toggleQueue: () => void;
    setQueueOpen: (open: boolean) => void;
    toggleLyrics: () => void;
    setLyricsOpen: (open: boolean) => void;
    toggleRoomPanel: () => void;
    setRoomPanelOpen: (open: boolean) => void;
    toggleSidebar: () => void;
    setSidebarOpen: (open: boolean) => void;
    setSearchFocused: (focused: boolean) => void;
    setUserLocale: (locale: string) => void;
    setOnboardingDone: () => void;
    addRecentSearch: (query: string) => void;
    clearRecentSearches: () => void;
    removeRecentSearch: (query: string) => void;
    setNowPlayingExpanded: (expanded: boolean) => void;
    setSnackbar: (message: string) => void;
}

export const useUIStore = create<UIStore>()(
    persist(
        (set) => ({
            isQueueOpen: false,
            isLyricsOpen: false,
            isSidebarOpen: true,
            isSearchFocused: false,
            userLocale: '',
            onboardingDone: false,
            recentSearches: [],
            isNowPlayingExpanded: false,
            isRoomPanelOpen: false,
            snackbar: '',

            toggleQueue: () => set(s => ({
                isQueueOpen: !s.isQueueOpen,
                isLyricsOpen: !s.isQueueOpen ? false : s.isLyricsOpen,
                isRoomPanelOpen: !s.isQueueOpen ? false : s.isRoomPanelOpen,
            })),
            setQueueOpen: (open) => set({ isQueueOpen: open }),

            toggleLyrics: () => set(s => ({
                isLyricsOpen: !s.isLyricsOpen,
                isQueueOpen: !s.isLyricsOpen ? false : s.isQueueOpen,
                isRoomPanelOpen: !s.isLyricsOpen ? false : s.isRoomPanelOpen,
            })),
            setLyricsOpen: (open) => set({ isLyricsOpen: open }),

            toggleRoomPanel: () => set(s => ({
                isRoomPanelOpen: !s.isRoomPanelOpen,
                isQueueOpen: !s.isRoomPanelOpen ? false : s.isQueueOpen,
                isLyricsOpen: !s.isRoomPanelOpen ? false : s.isLyricsOpen,
            })),
            setRoomPanelOpen: (open) => set({
                isRoomPanelOpen: open,
                ...(open ? { isQueueOpen: false, isLyricsOpen: false } : {}),
            }),

            toggleSidebar: () => set(s => ({ isSidebarOpen: !s.isSidebarOpen })),
            setSidebarOpen: (open) => set({ isSidebarOpen: open }),

            setSearchFocused: (focused) => set({ isSearchFocused: focused }),

            setUserLocale: (locale) => set({ userLocale: locale }),
            setOnboardingDone: () => set({ onboardingDone: true }),

            addRecentSearch: (query) => set(state => {
                const filtered = state.recentSearches.filter(s => s !== query);
                return {
                    recentSearches: [query, ...filtered].slice(0, 20),
                };
            }),
            clearRecentSearches: () => set({ recentSearches: [] }),
            removeRecentSearch: (query) => set(state => ({
                recentSearches: state.recentSearches.filter(s => s !== query),
            })),
            setNowPlayingExpanded: (expanded) => set({ isNowPlayingExpanded: expanded }),
            setSnackbar: (message) => set({ snackbar: message }),
        }),
        {
            name: STORAGE_KEYS.USER_LOCALE,
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                userLocale: state.userLocale,
                onboardingDone: state.onboardingDone,
                recentSearches: state.recentSearches,
            }),
        }
    )
);
