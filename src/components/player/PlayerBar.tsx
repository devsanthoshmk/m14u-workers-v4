/**
 * PlayerBar — Persistent bottom audio bar with frosted glass aesthetic.
 * Seamless desktop control center + floating mobile capsule.
 */

import { PlaybackError } from './PlaybackError';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { getThumbnail, formatDuration } from '@/utils/format';
import { PlayerControls } from './PlayerControls';
import { VolumeControl } from './VolumeControl';
import { SleepTimerButton } from './SleepTimer';
import * as Slider from '@radix-ui/react-slider';
import {
    ListMusic,
    Mic2,
    Heart,
    ChevronUp,
    Loader2,
    Maximize2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useState, useCallback } from 'react';
import type { TrackItem } from '@/types/music';

export function PlayerBar() {
    const navigate = useNavigate();
    const currentSong = usePlayerStore(s => s.currentSong);
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const isBuffering = usePlayerStore(s => s.isBuffering);
    const currentTime = usePlayerStore(s => s.currentTime);
    const duration = usePlayerStore(s => s.duration);
    const toggleFavorite = usePlayerStore(s => s.toggleFavorite);
    const togglePlay = usePlayerStore(s => s.togglePlay);
    const seek = usePlayerStore(s => s.seek);

    const toggleQueue = useUIStore(s => s.toggleQueue);
    const toggleLyrics = useUIStore(s => s.toggleLyrics);
    const isQueueOpen = useUIStore(s => s.isQueueOpen);
    const isLyricsOpen = useUIStore(s => s.isLyricsOpen);
    const queue = usePlayerStore(s => s.queue);

    const [isSeeking, setIsSeeking] = useState(false);
    const [seekValue, setSeekValue] = useState(0);

    const handleValueChange = useCallback((value: number[]) => {
        setIsSeeking(true);
        setSeekValue(value[0]);
    }, []);

    const handleValueCommit = useCallback((value: number[]) => {
        seek(value[0]);
        setIsSeeking(false);
    }, [seek]);

    if (!currentSong) return null;

    // Handle both TrackItem and legacy Song types
    const songId = currentSong.videoId || currentSong.id;
    const songTitle = currentSong.name || currentSong.title;
    const songArtist = currentSong.artist?.name || currentSong.author;
    const songThumbnails = currentSong.thumbnails;
    const songImg = currentSong.img;

    const thumbnail = songImg || (songThumbnails ? getThumbnail(songThumbnails, 120) : '') || `https://i.ytimg.com/vi/${songId}/mqdefault.jpg`;
    const isFavorite = songId ? usePlayerStore.getState().isFavorite(songId) : false;

    const displayTime = isSeeking ? seekValue : currentTime;
    const progressPercent = duration > 0 ? (displayTime / duration) * 100 : 0;

    return (
        <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="flex-shrink-0 relative z-30 bg-background/90 backdrop-blur-2xl border-t border-white/[0.08] shadow-[0_-10px_30px_rgba(0,0,0,0.5)]"
        >
            {/* Full-width seekbar along top edge (desktop) */}
            <div className="hidden md:block px-0 relative -mt-[3px]">
                <Slider.Root
                    className="relative flex items-center w-full h-[14px] cursor-pointer select-none touch-none group"
                    value={[displayTime]}
                    max={duration || 1}
                    step={0.1}
                    aria-label="Seek track position"
                    onValueChange={handleValueChange}
                    onValueCommit={handleValueCommit}
                >
                    <Slider.Track className="relative h-[3px] group-hover:h-[5px] transition-all w-full bg-white/10">
                        <Slider.Range className="absolute h-full bg-gradient-to-r from-amber-500 to-amber-400" />
                    </Slider.Track>
                    <Slider.Thumb aria-label="Current progress" className="block h-3 w-3 rounded-full bg-amber-200 ring-2 ring-amber-500 opacity-0 group-hover:opacity-100 transition-opacity shadow-md focus:opacity-100 focus:outline-none" />
                </Slider.Root>
            </div>

            {/* Controls row */}
            <div className="flex min-w-0 items-center h-[72px] md:h-[76px] px-3 md:px-6 gap-2 md:gap-5">

                {/* Left: Album art + song info */}
                <div className="flex min-w-0 flex-1 md:flex-none md:w-[280px] items-center gap-3">
                    <button
                        onClick={() => navigate('/now-playing')}
                        className="group/art relative size-12 md:size-[52px] flex-shrink-0 rounded-xl overflow-hidden ring-1 ring-white/15 shadow-md text-left"
                        aria-label="Open full screen now playing"
                    >
                        {thumbnail ? (
                            <img
                                src={thumbnail}
                                alt={songTitle}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover/art:scale-105"
                            />
                        ) : (
                            <div className="h-full w-full bg-white/10" />
                        )}

                        {/* Animated wave overlay when playing */}
                        {isPlaying && !isBuffering && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-0.5 opacity-0 group-hover/art:opacity-100 transition-opacity">
                                <span className="w-0.5 h-3 bg-amber-400 animate-now-playing" style={{ animationDelay: '0ms' }} />
                                <span className="w-0.5 h-4 bg-amber-400 animate-now-playing" style={{ animationDelay: '200ms' }} />
                                <span className="w-0.5 h-2 bg-amber-400 animate-now-playing" style={{ animationDelay: '400ms' }} />
                            </div>
                        )}

                        {isBuffering && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                                <Loader2 className="size-5 animate-spin text-amber-400" />
                            </div>
                        )}
                    </button>

                    <div className="min-w-0 flex-1">
                        <button
                            onClick={() => navigate('/now-playing')}
                            className="text-left w-full group/info block"
                        >
                            <p className="text-[13px] md:text-sm font-semibold text-foreground line-clamp-1 group-hover/info:text-amber-400 transition-colors">
                                {songTitle}
                            </p>
                            <p className="text-[11px] md:text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                {songArtist}
                            </p>
                        </button>
                    </div>

                    <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(currentSong as TrackItem); }}
                        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        aria-pressed={isFavorite}
                        className="hidden md:grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
                    >
                        <Heart className={cn('size-4', isFavorite && 'fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]')} />
                    </button>
                </div>

                {/* Center: Time + Controls (Desktop) */}
                <div className="hidden md:flex flex-1 items-center justify-center gap-4">
                    <span className="text-[11px] font-mono text-muted-foreground tabular-nums w-12 text-right">
                        {formatDuration(displayTime)}
                    </span>
                    <PlayerControls layout="compact" />
                    <span className="text-[11px] font-mono text-muted-foreground tabular-nums w-12">
                        {formatDuration(duration)}
                    </span>
                </div>

                {/* Mobile controls (Heart + Play/Pause + Expand) */}
                <div className="flex shrink-0 items-center gap-1.5 md:hidden">
                    <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(currentSong as TrackItem); }}
                        aria-label="Favorite"
                        aria-pressed={isFavorite}
                        className="grid size-10 place-items-center rounded-full text-muted-foreground hover:text-foreground active:scale-95"
                    >
                        <Heart className={cn('size-5', isFavorite && 'fill-amber-400 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]')} />
                    </button>

                    <button
                        onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                        aria-busy={isBuffering}
                        className="grid size-11 place-items-center rounded-full bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 text-neutral-950 font-bold shadow-[0_0_16px_rgba(245,158,11,0.4)] active:scale-90 transition-transform"
                    >
                        {isBuffering ? (
                            <Loader2 className="size-5 animate-spin text-neutral-950" />
                        ) : isPlaying ? (
                            <PauseIcon size={18} />
                        ) : (
                            <PlayIcon size={18} />
                        )}
                    </button>

                    <button
                        onClick={() => navigate('/now-playing')}
                        aria-label="Expand player"
                        className="grid size-9 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                    >
                        <ChevronUp className="size-5" />
                    </button>
                </div>

                {/* Right: Secondary controls (Desktop) */}
                <div className="hidden md:flex items-center gap-1 flex-shrink-0">
                    <VolumeControl />

                    <button
                        onClick={toggleLyrics}
                        className={cn(
                            'p-2.5 rounded-full transition-all text-muted-foreground hover:text-foreground hover:bg-white/[0.06]',
                            isLyricsOpen && 'text-amber-400 bg-amber-400/10'
                        )}
                        title="Lyrics (L)"
                        aria-label="Lyrics"
                        aria-pressed={isLyricsOpen}
                    >
                        <Mic2 className="size-4" />
                    </button>

                    <button
                        onClick={toggleQueue}
                        className={cn(
                            'relative p-2.5 rounded-full transition-all text-muted-foreground hover:text-foreground hover:bg-white/[0.06]',
                            isQueueOpen && 'text-amber-400 bg-amber-400/10'
                        )}
                        title="Queue (Q)"
                        aria-label="Queue"
                        aria-pressed={isQueueOpen}
                    >
                        <ListMusic className="size-4" />
                        {queue.length > 0 && (
                            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-amber-400" />
                        )}
                    </button>

                    <SleepTimerButton />

                    <button
                        onClick={() => navigate('/now-playing')}
                        className="p-2.5 rounded-full transition-all text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
                        title="Expand to Fullscreen"
                        aria-label="Expand to Fullscreen"
                    >
                        <Maximize2 className="size-4" />
                    </button>
                </div>
            </div>

            {/* Micro progress line along bottom on mobile */}
            <div className="md:hidden h-[2px] w-full bg-white/10 overflow-hidden">
                <div
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-150"
                    style={{ width: `${progressPercent}%` }}
                />
            </div>

            <PlaybackError />
        </motion.div>
    );
}

function PlayIcon({ size = 18 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="translate-x-0.5">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function PauseIcon({ size = 18 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1.5" />
            <rect x="14" y="4" width="4" height="16" rx="1.5" />
        </svg>
    );
}
