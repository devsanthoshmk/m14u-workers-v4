/**
 * MediaSession API hook.
 * Syncs player state to OS-level media controls (lock screen, notification, headphone buttons).
 *
 * Why: Users with Bluetooth headphones or on mobile expect hardware play/pause/skip to work.
 * This bridges the web player to those native controls.
 */

import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { isAndroid } from '@/lib/utils/platform';
import { trackArtworkUrls } from '@/utils/trackArtwork';


export function useMediaSession(): void {
    const currentSong = usePlayerStore(s => s.currentSong);
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const currentTime = usePlayerStore(s => s.currentTime);
    const duration = usePlayerStore(s => s.duration);

    // Update metadata when song changes
    useEffect(() => {
        if (isAndroid() || !('mediaSession' in navigator)) return;
        if (!currentSong) {
            navigator.mediaSession.metadata = null;
            return;
        }
        if (typeof MediaMetadata === 'undefined') return;

        const songTitle = currentSong.name || currentSong.title || '';
        const songArtist = currentSong.artist?.name || currentSong.author || '';
        const songAlbum = currentSong.album?.name || '';

        navigator.mediaSession.metadata = new MediaMetadata({
            title: songTitle,
            artist: songArtist,
            album: songAlbum,
            artwork: trackArtworkUrls(currentSong).map(src => ({ src })),
        });
    }, [currentSong]);

    // Update playback state
    useEffect(() => {
        if (isAndroid() || !('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = !currentSong ? 'none' : isPlaying ? 'playing' : 'paused';
    }, [currentSong, isPlaying]);

    // Update position state
    useEffect(() => {
        if (isAndroid() || !('mediaSession' in navigator)) return;

        try {
            if (!Number.isFinite(duration) || duration <= 0) {
                navigator.mediaSession.setPositionState();
                return;
            }
            navigator.mediaSession.setPositionState({
                duration: duration,
                playbackRate: 1,
                position: Math.min(currentTime, duration),
            });
        } catch {
            // Some browsers don't support setPositionState yet
        }
    }, [currentTime, duration]);

    // Register action handlers
    useEffect(() => {
        if (isAndroid() || !('mediaSession' in navigator)) return;
        const store = usePlayerStore.getState;

        const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
            ['play', () => void store().resume()],
            ['pause', () => store().pause()],
            ['nexttrack', () => store().next()],
            ['previoustrack', () => store().previous()],
            ['seekto', (details) => {
                if (details.seekTime !== undefined) {
                    store().seek(details.seekTime);
                }
            }],
            ['seekforward', () => {
                store().seek(store().currentTime + 10);
            }],
            ['seekbackward', () => {
                store().seek(Math.max(0, store().currentTime - 10));
            }],
        ];

        for (const [action, handler] of handlers) {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch {
                // Action not supported
            }
        }

        return () => {
            for (const [action] of handlers) {
                try {
                    navigator.mediaSession.setActionHandler(action, null);
                } catch {
                    // Cleanup
                }
            }
        };
    }, []);
}
