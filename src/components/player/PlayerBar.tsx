/**
 * PlayerBar — Redesigned to match reference.
 *
 * Layout: Song info (left) | Progress bar (center, full-width) | Controls (center) | Secondary (right)
 */

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
    const error = usePlayerStore(s => s.error);
    const toggleFavorite = usePlayerStore(s => s.toggleFavorite);
    const togglePlay = usePlayerStore(s => s.togglePlay);
    const seek = usePlayerStore(s => s.seek);

    const toggleQueue = useUIStore(s => s.toggleQueue);
    const toggleLyrics = useUIStore(s => s.toggleLyrics);
    const isQueueOpen = useUIStore(s => s.isQueueOpen);
    const isLyricsOpen = useUIStore(s => s.isLyricsOpen);

    const [isSeeking, setIsSeeking] = useState(false);
    const [seekValue, setSeekValue] = useState(0);

    if (!currentSong) return null;

    // Handle both TrackItem and legacy Song types
    const songId = (currentSong as any).videoId || currentSong.id;
    const songTitle = (currentSong as any).name || currentSong.title;
    const songArtist = (currentSong as any).artist?.name || currentSong.author;
    const songThumbnails = (currentSong as any).thumbnails;
    const songImg = (currentSong as any).img;
    
    const thumbnail = songImg || (songThumbnails ? getThumbnail(songThumbnails, 120) : '') || `https://i.ytimg.com/vi/${songId}/mqdefault.jpg`;
    const isFavorite = usePlayerStore(s => songId ? s.isFavorite(songId) : false);
    
    const displayTime = isSeeking ? seekValue : currentTime;

    const handleValueChange = useCallback((value: number[]) => {
        setIsSeeking(true);
        setSeekValue(value[0]);
    }, []);

    const handleValueCommit = useCallback((value: number[]) => {
        seek(value[0]);
        setIsSeeking(false);
    }, [seek]);

    return (
        <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="flex-shrink-0 w-full max-w-full overflow-hidden bg-[hsl(240_6%_7%)] border-t border-white/[0.06]"
        >
            {/* Full-width progress bar ABOVE the controls */}
            <div className="px-0 relative">
                <Slider.Root
                    className="relative flex items-center w-full h-[14px] cursor-pointer select-none touch-none group"
                    value={[displayTime]}
                    max={duration || 1}
                    step={0.1}
                    onValueChange={handleValueChange}
                    onValueCommit={handleValueCommit}
                >
                    <Slider.Track className="relative h-[3px] group-hover:h-[5px] transition-all w-full bg-white/10">
                        <Slider.Range className="absolute h-full bg-primary" />
                    </Slider.Track>
                    <Slider.Thumb className="block h-3 w-3 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity shadow-md focus:opacity-100 focus:outline-none" />
                </Slider.Root>
            </div>

            {/* Controls row */}
            <div className="flex items-center h-[72px] md:h-[76px] px-4 md:px-5 gap-4">

                {/* Left: Album art + song info */}
                <button
                    onClick={() => navigate('/now-playing')}
                    className="flex items-center gap-3 min-w-0 flex-1 md:flex-none md:w-[260px] flex-shrink md:flex-shrink-0 text-left group/info overflow-hidden"
                >
                    <div className="relative h-12 w-12 md:h-[52px] md:w-[52px] flex-shrink-0 rounded-md overflow-hidden ring-1 ring-white/10">
                        {thumbnail ? (
                            <img
                                src={thumbnail}
                                alt={songTitle}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div className="h-full w-full bg-white/10" />
                        )}
                        {isBuffering && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            </div>
                        )}
                    </div>
                    <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-foreground line-clamp-1 group-hover/info:text-primary transition-colors">
                            {songTitle}
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                            {songArtist}
                        </p>
                    </div>
                    <ChevronUp className="h-4 w-4 text-muted-foreground md:hidden flex-shrink-0" />
                </button>

                {/* Center: Time + Controls */}
                <div className="hidden md:flex flex-1 items-center justify-center gap-4">
                    <span className="text-[11px] text-muted-foreground tabular-nums w-10 text-right">
                        {formatDuration(displayTime)}
                    </span>
                    <PlayerControls />
                    <span className="text-[11px] text-muted-foreground tabular-nums w-10">
                        {formatDuration(duration)}
                    </span>
                </div>

                {/* Mobile: Play/pause */}
                <div className="flex md:hidden items-center gap-1 ml-auto">
                    <button
                        onClick={(e) => { e.stopPropagation(); toggleFavorite(currentSong as TrackItem); }}
                        className="p-2 rounded-full"
                    >
                        <Heart className={cn('h-5 w-5', isFavorite ? 'fill-primary text-primary' : 'text-foreground/70')} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                        className="flex items-center justify-center h-10 w-10 rounded-full bg-primary text-primary-foreground"
                    >
                        {isBuffering ? <Loader2 className="h-5 w-5 animate-spin" /> :
                            isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
                    </button>
                </div>

                {/* Right: Secondary controls */}
                <div className="hidden md:flex items-center gap-0.5 flex-shrink-0">
                    <VolumeControl />

                    <button
                        onClick={toggleLyrics}
                        className={cn(
                            'p-2.5 rounded-full transition-all hover:bg-white/5',
                            isLyricsOpen && 'text-primary'
                        )}
                        title="Lyrics (L)"
                    >
                        <Mic2 className="h-[18px] w-[18px]" />
                    </button>

                    <button
                        onClick={toggleQueue}
                        className={cn(
                            'p-2.5 rounded-full transition-all hover:bg-white/5',
                            isQueueOpen && 'text-primary'
                        )}
                        title="Queue (Q)"
                    >
                        <ListMusic className="h-[18px] w-[18px]" />
                    </button>

                    <SleepTimerButton />
                </div>
            </div>

            {/* Error banner */}
            {error && (
                <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-destructive text-xs text-center">
                    {error} — <button onClick={() => currentSong && usePlayerStore.getState().playSong(currentSong as TrackItem)} className="underline font-medium">Retry</button>
                </div>
            )}
        </motion.div>
    );
}

function PlayIcon({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function PauseIcon({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
    );
}
