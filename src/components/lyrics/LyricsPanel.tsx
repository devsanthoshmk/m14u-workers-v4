/**
 * LyricsPanel — Time-synced and unsynced lyrics display.
 *
 * Reference-matched:
 * - Current line: large, amber/primary color, bold
 * - Past lines: dimmed, smaller
 * - Future lines: medium dim
 * - Auto-scroll with snap-to-center for active line
 * - Tap any line to seek
 * - Works both inline (right panel) and as overlay on mobile
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Loader2, MicOff, X } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { getLyrics } from '@/services/lyrics';
import type { LyricsData } from '@/types/lyrics';
import { cn } from '@/lib/utils';

export function LyricsPanel() {
    const currentSong = usePlayerStore(s => s.currentSong);
    const currentTime = usePlayerStore(s => s.currentTime);
    const seek = usePlayerStore(s => s.seek);
    const setLyricsOpen = useUIStore(s => s.setLyricsOpen);

    const [lyrics, setLyrics] = useState<LyricsData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [lyricsError, setLyricsError] = useState<string | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const activeLineRef = useRef<HTMLButtonElement>(null);
    const userScrolledRef = useRef(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Fetch lyrics when song changes
    useEffect(() => {
        if (!currentSong) return;

        // Handle both TrackItem and legacy Song
        const songTitle = (currentSong as any).name || currentSong.title || '';
        const songArtist = (currentSong as any).artist?.name || currentSong.author || '';
        const songAlbum = (currentSong as any).album?.name || '';
        const songDuration = (currentSong as any).duration || (currentSong as any).durationSec || 0;

        setIsLoading(true);
        setLyricsError(null);
        setLyrics(null);

        getLyrics(
            songTitle,
            songArtist,
            songAlbum || undefined,
            typeof songDuration === 'string' ? 0 : songDuration
        )
            .then(setLyrics)
            .catch(() => setLyricsError('Could not load lyrics'))
            .finally(() => setIsLoading(false));
    }, [(currentSong as any)?.videoId || currentSong?.id]);

    // Find current active synced line
    const activeLine = useMemo(() => {
        if (!lyrics?.synced) return -1;
        let active = -1;
        for (let i = 0; i < lyrics.synced.length; i++) {
            if (lyrics.synced[i].time <= currentTime) {
                active = i;
            } else {
                break;
            }
        }
        return active;
    }, [lyrics?.synced, currentTime]);

    // Auto-scroll to active line
    useEffect(() => {
        if (userScrolledRef.current || !activeLineRef.current) return;

        activeLineRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
        });
    }, [activeLine]);

    // Detect user scroll — pause auto-scroll temporarily
    const handleScroll = useCallback(() => {
        userScrolledRef.current = true;
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
            userScrolledRef.current = false;
        }, 5000);
    }, []);

    if (!currentSong) return null;

    return (
        <div className="flex flex-col h-full w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 flex-shrink-0 border-b border-white/[0.06]">
                <h2 className="text-base font-bold font-heading">Lyrics</h2>
                <button
                    onClick={() => setLyricsOpen(false)}
                    className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Content */}
            <div
                ref={containerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-8"
            >
                {isLoading && (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm text-muted-foreground">Finding lyrics...</p>
                    </div>
                )}

                {lyricsError && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                        <MicOff className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">{lyricsError}</p>
                    </div>
                )}

                {!isLoading && !lyricsError && lyrics && (
                    <>
                        {lyrics.instrumental && (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                                <div className="text-4xl">🎵</div>
                                <p className="text-lg font-medium text-foreground">Instrumental</p>
                                <p className="text-sm text-muted-foreground">No lyrics for this track</p>
                            </div>
                        )}

                        {!lyrics.instrumental && lyrics.synced && lyrics.synced.length > 0 && (
                            <div className="py-10 space-y-1">
                                {lyrics.synced.map((line, i) => {
                                    const isActive = i === activeLine;
                                    const isPast = i < activeLine;

                                    return (
                                        <button
                                            key={`${line.time}-${i}`}
                                            ref={isActive ? activeLineRef : undefined}
                                            onClick={() => seek(line.time)}
                                            className={cn(
                                                'block w-full text-left py-1.5 px-2 rounded-lg transition-all duration-300 cursor-pointer hover:bg-white/[0.04]',
                                                isActive
                                                    ? 'text-primary text-lg font-bold'
                                                    : isPast
                                                        ? 'text-muted-foreground/40 text-sm font-medium'
                                                        : 'text-muted-foreground/70 text-sm font-medium'
                                            )}
                                        >
                                            {line.text || '♪'}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {!lyrics.instrumental && !lyrics.synced && lyrics.unsynced && (
                            <div className="py-8 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground font-medium px-1">
                                {lyrics.unsynced}
                            </div>
                        )}

                        {!lyrics.instrumental && !lyrics.synced && !lyrics.unsynced && (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                                <MicOff className="h-8 w-8 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">No lyrics available for this song</p>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Source attribution */}
            <div className="px-4 py-2 border-t border-white/[0.04] flex-shrink-0">
                <p className="text-[10px] text-muted-foreground/40">
                    Lyrics provided by LRCLIB
                </p>
            </div>
        </div>
    );
}
