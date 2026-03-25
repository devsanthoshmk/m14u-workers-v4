/**
 * Keyboard shortcuts hook.
 * Registers global keyboard listeners for player control.
 * Only fires when no text input is focused (prevents conflicts with search).
 */

import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';

export function useKeyboardShortcuts(): void {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't fire shortcuts when typing in inputs
            const target = e.target as HTMLElement;
            if (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            ) {
                return;
            }

            const store = usePlayerStore.getState();
            const uiStore = useUIStore.getState();

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    store.togglePlay();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    store.seek(Math.max(0, store.currentTime - 5));
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    store.seek(store.currentTime + 5);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    store.setVolume(Math.min(1, store.volume + 0.05));
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    store.setVolume(Math.max(0, store.volume - 0.05));
                    break;
                case 'KeyN':
                    store.next();
                    break;
                case 'KeyP':
                    store.previous();
                    break;
                case 'KeyM':
                    store.toggleMute();
                    break;
                case 'KeyL':
                    uiStore.toggleLyrics();
                    break;
                case 'KeyQ':
                    uiStore.toggleQueue();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);
}
