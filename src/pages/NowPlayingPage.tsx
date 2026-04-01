/**
 * NowPlayingPage — Full-screen immersive player.
 *
 * Mobile-first design inspired by Spotify/Apple Music:
 * - Edge-to-edge blurred background
 * - Large album art with subtle shadow & animation
 * - Swipeable Player/Lyrics tabs
 * - Big touch-friendly controls
 * - Safe area aware for notched devices
 */

import { useNavigate } from 'react-router-dom';
import { ChevronDown, Share2, ListMusic, Heart, MoreHorizontal, ListPlus, ListEnd } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { getThumbnail, formatDuration } from '@/utils/format';
import { PlayerControls } from '@/components/player/PlayerControls';
import { LyricsPanel } from '@/components/lyrics/LyricsPanel';
import { SleepTimerButton } from '@/components/player/SleepTimer';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { useState, useCallback, useRef, useEffect } from 'react';
import * as Slider from '@radix-ui/react-slider';
import type { TrackItem } from '@/types/music';

export function NowPlayingPage() {
    const navigate = useNavigate();
    const currentSong = usePlayerStore(s => s.currentSong);
    const currentTime = usePlayerStore(s => s.currentTime);
    const duration = usePlayerStore(s => s.duration);
    const seek = usePlayerStore(s => s.seek);
    const toggleFavorite = usePlayerStore(s => s.toggleFavorite);
    const addToQueue = usePlayerStore(s => s.addToQueue);
    const addNext = usePlayerStore(s => s.addNext);

    const songId = currentSong ? ((currentSong as any).videoId || currentSong.id) : undefined;
    const songThumbnails = currentSong ? (currentSong as any).thumbnails : undefined;
    const songImg = currentSong ? (currentSong as any).img : undefined;
    const songTitle = currentSong ? ((currentSong as any).name || currentSong.title) : '';
    const songArtist = currentSong ? ((currentSong as any).artist?.name || currentSong.author) : '';
    const songAlbum = currentSong ? (currentSong as any).album?.name : '';

    const isFavorite = usePlayerStore(s => songId ? s.isFavorite(songId) : false);

    const [activeTab, setActiveTab] = useState<'player' | 'lyrics'>('player');
    const [isSeeking, setIsSeeking] = useState(false);
    const [seekValue, setSeekValue] = useState(0);
    const [showMenu, setShowMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const displayTime = isSeeking ? seekValue : currentTime;

    // Close menu on outside click/touch
    useEffect(() => {
        if (!showMenu) return;
        const close = (e: MouseEvent | TouchEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('touchstart', close);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('touchstart', close);
        };
    }, [showMenu]);

    const handleSeekChange = useCallback((value: number[]) => {
        setIsSeeking(true);
        setSeekValue(value[0]);
    }, []);

    const handleSeekCommit = useCallback((value: number[]) => {
        seek(value[0]);
        setIsSeeking(false);
    }, [seek]);

    if (!currentSong) {
        return (
            <div className="flex items-center justify-center h-full bg-background">
                <p className="text-muted-foreground">No song playing</p>
            </div>
        );
    }

    const heroArt = songImg || (songThumbnails ? getThumbnail(songThumbnails, 1080) : '') || `https://i.ytimg.com/vi/${songId}/mqdefault.jpg`;
    const albumArt = songImg || (songThumbnails ? getThumbnail(songThumbnails, 544) : '') || `https://i.ytimg.com/vi/${songId}/mqdefault.jpg`;

    return (
        <div className="relative h-full flex flex-col overflow-hidden select-none">
            {/* Background — blurred album art with gradient overlay */}
            <div className="absolute inset-0 z-0">
                <img
                    src={heroArt}
                    alt=""
                    className="h-full w-full object-cover blur-[80px] scale-150 opacity-40"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-background/80 to-background" />
            </div>

            {/* Safe area + content */}
            <div className="relative z-10 flex flex-col h-full pt-[env(safe-area-inset-top)]">

                {/* Top bar — minimal, glass-like */}
                <div className="flex items-center justify-between px-4 py-2 md:py-3">
                    <button
                        onClick={() => navigate(-1)}
                        className="p-2 -ml-2 rounded-full active:scale-90 transition-transform"
                    >
                        <ChevronDown className="h-7 w-7 text-white/90" />
                    </button>

                    {/* Tab pills */}
                    <div className="flex items-center bg-white/[0.08] rounded-full p-0.5">
                        <button
                            onClick={() => setActiveTab('player')}
                            className={cn(
                                'px-4 py-1 rounded-full text-xs font-semibold transition-all',
                                activeTab === 'player'
                                    ? 'bg-white/15 text-white'
                                    : 'text-white/50'
                            )}
                        >
                            Player
                        </button>
                        <button
                            onClick={() => setActiveTab('lyrics')}
                            className={cn(
                                'px-4 py-1 rounded-full text-xs font-semibold transition-all',
                                activeTab === 'lyrics'
                                    ? 'bg-white/15 text-white'
                                    : 'text-white/50'
                            )}
                        >
                            Lyrics
                        </button>
                    </div>

                    <div className="flex items-center">
                        <button
                            onClick={() => navigate('/queue')}
                            className="p-2 rounded-full active:scale-90 transition-transform"
                        >
                            <ListMusic className="h-5 w-5 text-white/70" />
                        </button>
                    </div>
                </div>

                {/* Main content — player or lyrics */}
                <div className="flex-1 overflow-hidden">
                    <AnimatePresence mode="wait">
                        {activeTab === 'player' ? (
                            <motion.div
                                key="player"
                                initial={{ opacity: 0, x: -30 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -30 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className="flex flex-col h-full"
                            >
                                {/* Album art — centered, large */}
                                <div className="flex-1 flex items-center justify-center px-8 md:px-16 py-4">
                                    <motion.div
                                        className="w-full max-w-[min(85vw,380px)] md:max-w-[420px] aspect-square rounded-2xl md:rounded-3xl overflow-hidden shadow-[0_8px_60px_rgba(0,0,0,0.5)]"
                                        initial={{ scale: 0.85, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                                    >
                                        <img
                                            src={albumArt}
                                            alt={songTitle}
                                            className="h-full w-full object-cover"
                                            draggable={false}
                                        />
                                    </motion.div>
                                </div>

                                {/* Song info + actions */}
                                <div className="px-6 md:px-8">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                            <motion.h1
                                                className="text-lg md:text-xl font-bold text-white line-clamp-1"
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: 0.1 }}
                                            >
                                                {songTitle}
                                            </motion.h1>
                                            <motion.p
                                                className="text-sm text-white/50 line-clamp-1 mt-0.5"
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ delay: 0.15 }}
                                            >
                                                {songArtist}
                                                {songAlbum && ` · ${songAlbum}`}
                                            </motion.p>
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => toggleFavorite(currentSong as TrackItem)}
                                                className="p-2 rounded-full active:scale-90 transition-transform"
                                            >
                                                <Heart className={cn('h-6 w-6 transition-colors', isFavorite ? 'fill-primary text-primary' : 'text-white/60')} />
                                            </button>
                                            <div className="relative" ref={menuRef}>
                                                <button
                                                    onClick={() => setShowMenu(!showMenu)}
                                                    className="p-2 rounded-full active:scale-90 transition-transform"
                                                >
                                                    <MoreHorizontal className="h-5 w-5 text-white/60" />
                                                </button>
                                                {showMenu && (
                                                    <div className="absolute bottom-full right-0 mb-2 w-48 rounded-xl bg-neutral-900/95 border border-white/10 shadow-2xl py-1 z-50 backdrop-blur-xl">
                                                        <button
                                                            onClick={() => { addNext(currentSong as TrackItem); setShowMenu(false); }}
                                                            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-white/90 active:bg-white/10 transition-colors"
                                                        >
                                                            <ListPlus className="h-4 w-4 text-white/50" /> Play next
                                                        </button>
                                                        <button
                                                            onClick={() => { addToQueue(currentSong as TrackItem); setShowMenu(false); }}
                                                            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-white/90 active:bg-white/10 transition-colors"
                                                        >
                                                            <ListEnd className="h-4 w-4 text-white/50" /> Add to queue
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                navigator.clipboard?.writeText(`https://music.youtube.com/watch?v=${songId}`);
                                                                setShowMenu(false);
                                                            }}
                                                            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-white/90 active:bg-white/10 transition-colors"
                                                        >
                                                            <Share2 className="h-4 w-4 text-white/50" /> Share
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="lyrics"
                                initial={{ opacity: 0, x: 30 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 30 }}
                                transition={{ duration: 0.2, ease: 'easeOut' }}
                                className="h-full"
                            >
                                <LyricsPanel />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Bottom controls — always visible */}
                <div className="px-6 md:px-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-3">
                    {/* Progress slider */}
                    <div>
                        <Slider.Root
                            className="relative flex items-center w-full h-6 cursor-pointer select-none touch-none group"
                            value={[displayTime]}
                            max={duration || 1}
                            step={0.1}
                            onValueChange={handleSeekChange}
                            onValueCommit={handleSeekCommit}
                        >
                            <Slider.Track className="relative h-[3px] group-active:h-[5px] transition-all w-full rounded-full bg-white/15 overflow-hidden">
                                <Slider.Range className="absolute h-full rounded-full bg-primary" />
                            </Slider.Track>
                            <Slider.Thumb className="block h-4 w-4 rounded-full bg-white shadow-lg shadow-black/30 focus:outline-none active:scale-125 transition-transform" />
                        </Slider.Root>
                        <div className="flex items-center justify-between -mt-0.5 text-[11px] text-white/40 tabular-nums font-medium">
                            <span>{formatDuration(displayTime)}</span>
                            <span>{formatDuration(duration)}</span>
                        </div>
                    </div>

                    {/* Main controls row */}
                    <div className="flex items-center justify-center">
                        <NowPlayingControls />
                    </div>

                    {/* Tiny sleep timer at bottom */}
                    <div className="flex justify-center pt-1">
                        <SleepTimerButton />
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Bigger controls specifically for the now-playing screen.
 * Larger play button, bigger skip icons, more spacing.
 */
import { Shuffle, SkipBack, SkipForward, Repeat, Repeat1, Loader2 } from 'lucide-react';
import type { RepeatMode } from '@/types/player';

function NowPlayingControls() {
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const isBuffering = usePlayerStore(s => s.isBuffering);
    const isShuffled = usePlayerStore(s => s.isShuffled);
    const repeatMode = usePlayerStore(s => s.repeatMode);
    const togglePlay = usePlayerStore(s => s.togglePlay);
    const next = usePlayerStore(s => s.next);
    const previous = usePlayerStore(s => s.previous);
    const toggleShuffle = usePlayerStore(s => s.toggleShuffle);
    const setRepeatMode = usePlayerStore(s => s.setRepeatMode);

    const cycleRepeat = () => {
        const modes: RepeatMode[] = ['off', 'all', 'one'];
        const idx = modes.indexOf(repeatMode);
        setRepeatMode(modes[(idx + 1) % modes.length]);
    };

    const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;

    return (
        <div className="flex items-center justify-between w-full max-w-[320px] md:max-w-[360px]">
            <button
                onClick={toggleShuffle}
                className={cn(
                    'p-3 rounded-full active:scale-90 transition-transform',
                    isShuffled ? 'text-primary' : 'text-white/40'
                )}
            >
                <Shuffle className="h-5 w-5" />
            </button>

            <button
                onClick={previous}
                className="p-3 rounded-full text-white active:scale-90 transition-transform"
            >
                <SkipBack className="h-7 w-7" fill="currentColor" />
            </button>

            <button
                onClick={togglePlay}
                className="flex items-center justify-center h-16 w-16 rounded-full bg-white text-black active:scale-90 transition-transform shadow-xl"
            >
                {isBuffering ? (
                    <Loader2 className="h-7 w-7 animate-spin" />
                ) : isPlaying ? (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                ) : (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                )}
            </button>

            <button
                onClick={next}
                className="p-3 rounded-full text-white active:scale-90 transition-transform"
            >
                <SkipForward className="h-7 w-7" fill="currentColor" />
            </button>

            <button
                onClick={cycleRepeat}
                className={cn(
                    'p-3 rounded-full active:scale-90 transition-transform',
                    repeatMode !== 'off' ? 'text-primary' : 'text-white/40'
                )}
            >
                <RepeatIcon className="h-5 w-5" />
            </button>
        </div>
    );
}
