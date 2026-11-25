import { create } from 'zustand';
import { isNative } from '@/lib/utils/platform';
import { isJioSaavnTrack } from '@/services/jiosaavn';

export type WebCatalog = 'open-audio' | 'jiosaavn';
export function matchesCatalog(provider: WebCatalog, trackId: string) {
    return isNative() || (provider === 'jiosaavn') === isJioSaavnTrack(trackId);
}
const catalogKey = 'm14u-web-catalog';
const introKey = 'm14u-web-intro-views';

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

let countedVisit = false;
export const useCatalogStore = create<CatalogState>((set) => ({
    provider: !isNative() && read(catalogKey) === 'jiosaavn' ? 'jiosaavn' : 'open-audio',
    dialog: null,
    showIntro: () => {
        if (isNative() || countedVisit) return;
        countedVisit = true;
        const views = Number(read(introKey)) || 0;
        if (views >= 2) return;
        save(introKey, String(views + 1));
        set({ dialog: 'intro' });
    },
    openSettings: () => { if (!isNative()) set({ dialog: 'settings' }); },
    closeDialog: () => set({ dialog: null }),
    choose: (provider) => {
        if (isNative()) return;
        save(catalogKey, provider);
        set({ provider });
    },
}));
