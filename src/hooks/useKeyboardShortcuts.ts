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
            if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
            const target = e.target;
            if (target instanceof Element && (
                (target instanceof HTMLElement && target.isContentEditable) ||
                target.closest('input, textarea, select, [role="slider"]') ||
                // Keep Space activation on focused buttons, including Radix controls.
                (e.code === 'Space' && target.closest('button, [role="button"]'))
            )) return;

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
