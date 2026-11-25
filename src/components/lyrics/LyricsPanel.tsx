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
import { trackDurationSeconds } from '@/utils/trackMetadata';

interface LyricsPanelProps {
    embedded?: boolean;
    onClose?: () => void;
    onUnavailable?: () => void;
}

export function LyricsPanel(props: LyricsPanelProps) {
    const song = usePlayerStore(s => s.currentSong);
    if (!song) return null;
    const title = song.name || song.title || '';
    const artist = song.artist?.name || song.author || '';
    const album = song.album?.name || undefined;
    const duration = trackDurationSeconds(song);
    // Remount when lookup inputs change so old lyrics and scroll state disappear together.
    return <TrackLyrics key={JSON.stringify([song.id, title, artist, album, duration])}
        {...props} title={title} artist={artist} album={album} duration={duration} />;
}

interface TrackLyricsProps extends LyricsPanelProps {
    title: string;
    artist: string;
    album?: string;
    duration?: number;
}

function TrackLyrics({ embedded = false, onClose, onUnavailable, title, artist, album, duration }: TrackLyricsProps) {
    const currentTime = usePlayerStore(s => s.currentTime);
    const seek = usePlayerStore(s => s.seek);
    const setLyricsOpen = useUIStore(s => s.setLyricsOpen);

    const [lyrics, setLyrics] = useState<LyricsData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [lyricsError, setLyricsError] = useState<string | null>(null);
    const hasSyncedLyrics = Boolean(lyrics?.synced?.length);
    const hasPlainLyrics = Boolean(lyrics?.unsynced?.trim());
    const noLyrics = lyrics !== null && !lyrics.instrumental && !hasSyncedLyrics && !hasPlainLyrics;

    useEffect(() => {
        if (!isLoading && noLyrics) onUnavailable?.();
    }, [isLoading, noLyrics, onUnavailable]);

    const containerRef = useRef<HTMLDivElement>(null);
    const activeLineRef = useRef<HTMLButtonElement>(null);
    const userScrolledRef = useRef(false);
    const isProgrammaticScrollRef = useRef(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Fetch lyrics when song changes
    useEffect(() => {
        let active = true;

        getLyrics(title, artist, album, duration)
            .then(data => { if (active) setLyrics(data); })
            .catch(() => { if (active) setLyricsError('Could not load lyrics'); })
            .finally(() => { if (active) setIsLoading(false); });
        return () => { active = false; };
    }, [title, artist, album, duration]);

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

        isProgrammaticScrollRef.current = true;
        if (embedded && containerRef.current) {
            const container = containerRef.current;
            const line = activeLineRef.current.getBoundingClientRect();
            const viewport = container.getBoundingClientRect();
            container.scrollTo({
                top: container.scrollTop + line.top - viewport.top + (line.height - viewport.height) / 2,
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
            });
        } else {
            activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        const timer = setTimeout(() => { isProgrammaticScrollRef.current = false; }, 450);
        return () => {
            clearTimeout(timer);
            isProgrammaticScrollRef.current = false;
        };
    }, [activeLine, embedded]);

    // Detect user scroll — pause auto-scroll temporarily
    const handleScroll = useCallback(() => {
        if (isProgrammaticScrollRef.current) return;
        userScrolledRef.current = true;
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
            userScrolledRef.current = false;
        }, 4000);
    }, []);

    useEffect(() => () => {
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    }, []);

    return (
        <div className="flex flex-col h-full w-full">
            {(!embedded || onClose) && (
                <div className="flex items-center justify-between px-4 py-4 flex-shrink-0 border-b border-white/[0.06]">
                    <h2 className="text-base font-bold font-heading">Lyrics</h2>
                    <button
                        onClick={onClose ?? (() => setLyricsOpen(false))}
                        className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
                        aria-label="Close lyrics"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Content */}
            <div
                ref={containerRef}
                onScroll={handleScroll}
                className={cn(
                    'flex-1 overflow-y-auto overscroll-contain scrollbar-none px-3 pb-16 pt-4',
                    embedded && '[mask-image:linear-gradient(to_bottom,transparent_0%,black_12%,black_88%,transparent_100%)]'
                )}
            >
                {isLoading && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
                        <p className="text-sm text-muted-foreground">Finding lyrics...</p>
                    </div>
                )}

                {lyricsError && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
                        <MicOff className="h-8 w-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">{lyricsError}</p>
                    </div>
                )}

                {!isLoading && !lyricsError && lyrics && (
                    <>
                        {lyrics.instrumental && (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-16">
                                <div className="text-5xl animate-bounce">🎵</div>
                                <p className="text-xl font-bold font-heading text-foreground">Instrumental</p>
                                <p className="text-sm text-muted-foreground">Enjoy the music — no lyrics for this track</p>
                            </div>
                        )}

                        {!lyrics.instrumental && lyrics.synced && lyrics.synced.length > 0 && (
                            <div className="py-12 space-y-2">
                                {lyrics.synced.map((line, i) => {
                                    const isActive = i === activeLine;
                                    const isPast = i < activeLine;

                                    return (
                                        <button
                                            key={`${line.time}-${i}`}
                                            ref={isActive ? activeLineRef : undefined}
                                            onClick={() => seek(line.time)}
                                            className={cn(
                                                'block w-full text-left py-2.5 sm:py-3.5 px-3 rounded-2xl transition-all duration-300 cursor-pointer select-none',
                                                isActive
                                                    ? 'text-amber-300 text-xl sm:text-2xl md:text-3xl font-extrabold font-heading scale-102 origin-left drop-shadow-[0_2px_16px_rgba(245,158,11,0.35)]'
                                                    : isPast
                                                        ? 'text-white/30 text-base sm:text-lg font-medium hover:text-white/60'
                                                        : 'text-white/55 text-base sm:text-lg font-medium hover:text-white/80'
                                            )}
                                        >
                                            {line.text || '♪'}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {!lyrics.instrumental && !hasSyncedLyrics && hasPlainLyrics && (
                            <div className="py-10 whitespace-pre-wrap text-base sm:text-lg leading-relaxed text-foreground/90 font-medium px-3">
                                {lyrics.unsynced}
                            </div>
                        )}

                        {noLyrics && (
                            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
                                <MicOff className="h-8 w-8 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">No lyrics available for this song</p>
                            </div>
                        )}

                        {/* Attribution at the end of scroll flow */}
                        <div className="pt-8 pb-4 text-center">
                            <p className="text-[11px] text-muted-foreground/50 font-mono">
                                Lyrics provided by LRCLIB
                            </p>
                        </div>
                    </>
                )}
            </div>

            {/* Desktop non-embedded attribution */}
            {!embedded && (
                <div className="px-4 py-2 border-t border-white/[0.04] flex-shrink-0">
                    <p className="text-xs text-muted-foreground">
                        Lyrics provided by LRCLIB
                    </p>
                </div>
            )}
        </div>
    );
}
