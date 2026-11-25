/**
 * UI Store — controls transient UI state like panels, modals, and locale.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STORAGE_KEYS } from '@/utils/constants';

export const PANEL_WIDTHS = {
    SIDEBAR_DEFAULT: 220,
    SIDEBAR_MIN: 180,
    SIDEBAR_MAX: 360,
    RIGHT_DEFAULT: 340,
    RIGHT_MIN: 260,
    RIGHT_MAX: 540,
    MAIN_MIN: 320,
} as const;

export function clampPanelWidth(width: number, min: number, max: number): number {
    if (!Number.isFinite(width)) return min;
    return Math.min(max, Math.max(min, Math.round(width)));
}

interface UIStore {
    // Panel visibility
    isQueueOpen: boolean;
    isLyricsOpen: boolean;
    isSidebarOpen: boolean;
    isSearchFocused: boolean;

    // Desktop panel widths (px)
    sidebarWidth: number;
    rightPanelWidth: number;

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

    // Global Top section language filter
    globalTopLanguage: string;
    setGlobalTopLanguage: (language: string) => void;

    // Actions
    toggleQueue: () => void;
    setQueueOpen: (open: boolean) => void;
    toggleLyrics: () => void;
    setLyricsOpen: (open: boolean) => void;
    toggleRoomPanel: () => void;
    setRoomPanelOpen: (open: boolean) => void;
    toggleSidebar: () => void;
    setSidebarOpen: (open: boolean) => void;
    setSidebarWidth: (width: number) => void;
    setRightPanelWidth: (width: number) => void;
    resetSidebarWidth: () => void;
    resetRightPanelWidth: () => void;
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
            sidebarWidth: PANEL_WIDTHS.SIDEBAR_DEFAULT,
            rightPanelWidth: PANEL_WIDTHS.RIGHT_DEFAULT,
            userLocale: '',
            onboardingDone: false,
            recentSearches: [],
            isNowPlayingExpanded: false,
            isRoomPanelOpen: false,
            snackbar: '',
            globalTopLanguage: '',

            setGlobalTopLanguage: (language: string) => set({ globalTopLanguage: language }),

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
            setSidebarWidth: (width) => set({
                sidebarWidth: clampPanelWidth(width, PANEL_WIDTHS.SIDEBAR_MIN, PANEL_WIDTHS.SIDEBAR_MAX),
            }),
            setRightPanelWidth: (width) => set({
                rightPanelWidth: clampPanelWidth(width, PANEL_WIDTHS.RIGHT_MIN, PANEL_WIDTHS.RIGHT_MAX),
            }),
            resetSidebarWidth: () => set({ sidebarWidth: PANEL_WIDTHS.SIDEBAR_DEFAULT }),
            resetRightPanelWidth: () => set({ rightPanelWidth: PANEL_WIDTHS.RIGHT_DEFAULT }),

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
                sidebarWidth: state.sidebarWidth,
                rightPanelWidth: state.rightPanelWidth,
            }),
        }
    )
);
