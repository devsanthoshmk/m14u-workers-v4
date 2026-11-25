import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LOCALE_OPTIONS } from '@/utils/constants';
import { normalizeMusicLanguage, normalizeMusicLanguages } from '@/lib/utils/musicLanguage';

export const MUSIC_LANGUAGES = [{ value: '', label: 'No preference' }, ...LOCALE_OPTIONS];

export interface ListeningPreferences {
    languages: string[];
    language: string; // compatibility: first selected language or ''
    setupComplete: boolean;
    setLanguages: (languages: string[]) => void;
    setLanguage: (language: string) => void; // compatibility
    toggleLanguage: (language: string) => void;
    completeSetup: () => void;
}

export const useListeningPreferences = create<ListeningPreferences>()(
    persist(
        (set) => ({
            languages: [],
            language: '',
            setupComplete: false,
            setLanguages: (languages: string[]) => {
                const normalized = normalizeMusicLanguages(languages);
                set({
                    languages: normalized,
                    language: normalized[0] || '',
                });
            },
            setLanguage: (language: string) => {
                const normalized = normalizeMusicLanguage(language);
                set({
                    languages: normalized ? [normalized] : [],
                    language: normalized,
                });
            },
            toggleLanguage: (language: string) => {
                const norm = normalizeMusicLanguage(language);
                if (!norm) return;
                set((state) => {
                    const exists = state.languages.includes(norm);
                    const next = exists ? state.languages.filter(l => l !== norm) : [...state.languages, norm];
                    return {
                        languages: next,
                        language: next[0] || '',
                    };
                });
            },
            completeSetup: () => set({ setupComplete: true }),
        }),
        {
            name: 'm14u-listening-preferences',
            version: 1,
            migrate: (persistedState: unknown) => {
                if (!persistedState || typeof persistedState !== 'object') return persistedState;
                const state = { ...(persistedState as Record<string, unknown>) };
                let languages: string[] = [];
                if (Array.isArray(state.languages)) {
                    languages = normalizeMusicLanguages(state.languages);
                } else if (typeof state.language === 'string') {
                    const single = normalizeMusicLanguage(state.language);
                    languages = single ? [single] : [];
                }
                state.languages = languages;
                state.language = languages[0] || '';
                return state;
            },
            merge: (persistedState: unknown, currentState: ListeningPreferences) => {
                if (!persistedState || typeof persistedState !== 'object') return currentState;
                const state = persistedState as Record<string, unknown>;
                let languages: string[] = [];
                if (Array.isArray(state.languages)) {
                    languages = normalizeMusicLanguages(state.languages);
                } else if (typeof state.language === 'string') {
                    const single = normalizeMusicLanguage(state.language);
                    languages = single ? [single] : [];
                }
                return {
                    ...currentState,
                    ...(persistedState as Partial<ListeningPreferences>),
                    languages,
                    language: languages[0] || '',
                    setupComplete: Boolean(state.setupComplete),
                };
            },
        }
    )
);
