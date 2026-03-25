/**
 * MediaSession API hook.
 * Syncs player state to OS-level media controls (lock screen, notification, headphone buttons).
 *
 * Why: Users with Bluetooth headphones or on mobile expect hardware play/pause/skip to work.
 * This bridges the web player to those native controls.
 */

import { useEffect } from 'react';
import { usePlayerStore } from '@/stores/playerStore';


export function useMediaSession(): void {
    const currentSong = usePlayerStore(s => s.currentSong);
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const currentTime = usePlayerStore(s => s.currentTime);
    const duration = usePlayerStore(s => s.duration);

    // Update metadata when song changes
    useEffect(() => {
        if (!('mediaSession' in navigator) || !currentSong) return;

        // Handle both TrackItem and legacy Song
        const songTitle = (currentSong as any).name || currentSong.title || '';
        const songArtist = (currentSong as any).artist?.name || currentSong.author || '';
        const songAlbum = (currentSong as any).album?.name || '';
        const songThumbnails = (currentSong as any).thumbnails || [];

        navigator.mediaSession.metadata = new MediaMetadata({
            title: songTitle,
            artist: songArtist,
            album: songAlbum,
            artwork: songThumbnails.map((t: any) => ({
                src: t.url,
                sizes: `${t.width}x${t.height}`,
                type: 'image/jpeg',
            })),
        });
    }, [currentSong]);

    // Update playback state
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }, [isPlaying]);

    // Update position state
    useEffect(() => {
        if (!('mediaSession' in navigator) || !duration) return;

        try {
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
        if (!('mediaSession' in navigator)) return;
        const store = usePlayerStore.getState;

        const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
            ['play', () => store().togglePlay()],
            ['pause', () => store().togglePlay()],
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
