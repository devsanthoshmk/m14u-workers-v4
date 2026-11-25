import { create } from 'zustand';
import { isNative } from '@/lib/utils/platform';
import { isJioSaavnTrack } from '@/services/jiosaavn';
import { useListeningPreferences } from '@/stores/listeningPreferences';

export type WebCatalog = 'open-audio' | 'jiosaavn';
export function matchesCatalog(provider: WebCatalog, trackId: unknown) {
    // Older saved entries may lack a normalized track ID. Leave them in storage.
    return typeof trackId === 'string' && trackId.length > 0 &&
        (isNative() || (provider === 'jiosaavn') === isJioSaavnTrack(trackId));
}
const catalogKey = 'm14u-web-catalog';

function read(key: string) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function save(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* Keep the choice for this page load. */ }
}

interface CatalogState {
    provider: WebCatalog;
    dialog: 'intro' | 'settings' | null;
    showIntro: () => void;
    openSettings: () => void;
    closeDialog: () => void;
    choose: (provider: WebCatalog) => void;
}

let dismissed = false;

export const useCatalogStore = create<CatalogState>((set) => ({
    provider: !isNative() && read(catalogKey) === 'jiosaavn' ? 'jiosaavn' : 'open-audio',
    dialog: null,
    showIntro: () => {
        if (dismissed || useListeningPreferences.getState().setupComplete) return;
        set({ dialog: 'intro' });
    },
    openSettings: () => set({ dialog: 'settings' }),
    closeDialog: () => {
        dismissed = true;
        set({ dialog: null });
    },
    choose: (provider) => {
        if (isNative()) return;
        save(catalogKey, provider);
        set({ provider });
    },
}));
