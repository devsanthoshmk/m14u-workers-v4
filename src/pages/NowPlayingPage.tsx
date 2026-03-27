/**
 * NowPlayingPage — Full-screen player view.
 *
 * Psychology:
 * - Large album art creates immersion (reduces awareness of other UI)
 * - Blurred background art creates depth without distraction
 * - All controls are within thumb reach on mobile
 * - Lyrics can be accessed via tab — secondary but accessible
 */

import { useNavigate } from 'react-router-dom';
import { ChevronDown, Share2, ListMusic } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { getThumbnail, formatDuration } from '@/utils/format';
import { ProgressBar } from '@/components/player/ProgressBar';
import { PlayerControls } from '@/components/player/PlayerControls';
import { LyricsPanel } from '@/components/lyrics/LyricsPanel';
import { SleepTimerButton } from '@/components/player/SleepTimer';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { Heart } from 'lucide-react';

export function NowPlayingPage() {
    const navigate = useNavigate();
    const currentSong = usePlayerStore(s => s.currentSong);
    const currentTime = usePlayerStore(s => s.currentTime);
    const duration = usePlayerStore(s => s.duration);
    
    // Handle both TrackItem and legacy Song
    const songId = currentSong ? ((currentSong as any).videoId || currentSong.id) : undefined;
    const songThumbnails = currentSong ? (currentSong as any).thumbnails : undefined;
    const songImg = currentSong ? (currentSong as any).img : undefined;
    const songTitle = currentSong ? ((currentSong as any).name || currentSong.title) : '';
    const songArtist = currentSong ? ((currentSong as any).artist?.name || currentSong.author) : '';
    const songAlbum = currentSong ? (currentSong as any).album?.name : '';
    
    const isFavorite = usePlayerStore(s => songId ? s.isFavorite(songId) : false);
    const toggleFavorite = usePlayerStore(s => s.toggleFavorite);

    const [showLyrics, setShowLyrics] = useState(false);

    if (!currentSong) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">No song playing</p>
            </div>
        );
    }

    const heroArt = songImg || (songThumbnails ? getThumbnail(songThumbnails, 1080) : '') || `https://i.ytimg.com/vi/${songId}/mqdefault.jpg`;
    const albumArt = songImg || (songThumbnails ? getThumbnail(songThumbnails, 544) : '') || `https://i.ytimg.com/vi/${songId}/mqdefault.jpg`;

    return (
        <div className="relative h-full flex flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
            {/* Background — blurred album art */}
            <div className="absolute inset-0 z-0">
                <img
                    src={heroArt}
                    alt=""
                    className="h-full w-full object-cover blur-3xl scale-125 opacity-30"
                />
                <div className="absolute inset-0 bg-background/70" />
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col h-full">
                {/* Top bar */}
                <div className="flex items-center justify-between px-4 py-3">
                    <button
                        onClick={() => navigate(-1)}
                        className="p-2 rounded-full hover:bg-surface-hover transition-all"
                    >
                        <ChevronDown className="h-6 w-6" />
                    </button>

                    <div className="flex items-center gap-1">
                        <SleepTimerButton />
                        <button
                            onClick={() => navigate('/queue')}
                            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-all"
                            title="Queue"
                        >
                            <ListMusic className="h-5 w-5" />
                        </button>
                        <button
                            onClick={() => {
                                const state = usePlayerStore.getState().exportState();
                                navigator.clipboard.writeText(JSON.stringify(state));
                            }}
                            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-all"
                            title="Copy player state (for listen-along)"
                        >
                            <Share2 className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                {/* Tab switch: Player / Lyrics */}
                <div className="flex items-center justify-center gap-4 px-6 py-2">
                    <button
                        onClick={() => setShowLyrics(false)}
                        className={cn(
                            'text-sm font-semibold pb-1 transition-all border-b-2',
                            !showLyrics ? 'text-foreground border-primary' : 'text-muted-foreground border-transparent'
                        )}
                    >
                        Player
                    </button>
                    <button
                        onClick={() => setShowLyrics(true)}
                        className={cn(
                            'text-sm font-semibold pb-1 transition-all border-b-2',
                            showLyrics ? 'text-foreground border-primary' : 'text-muted-foreground border-transparent'
                        )}
                    >
                        Lyrics
                    </button>
                </div>

                {/* Main content area */}
                <div className="flex-1 overflow-hidden">
                    <AnimatePresence mode="wait">
                        {showLyrics ? (
                            <motion.div
                                key="lyrics"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="h-full"
                            >
                                <LyricsPanel />
                            </motion.div>
                        ) : (
                            <motion.div
                                key="player"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="flex flex-col items-center justify-center h-full px-8 gap-8"
                            >
                                {/* Album art */}
                                <motion.div
                                    className="w-full max-w-[320px] md:max-w-[380px] aspect-square rounded-2xl overflow-hidden shadow-2xl"
                                    initial={{ scale: 0.9 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: 'spring', damping: 20 }}
                                >
                                    <img
                                        src={albumArt}
                                        alt={songTitle}
                                        className="h-full w-full object-cover"
                                    />
                                </motion.div>

                                {/* Song info */}
                                <div className="w-full max-w-[380px] text-center">
                                    <h1 className="text-xl md:text-2xl font-bold font-heading line-clamp-2">
                                        {songTitle}
                                    </h1>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {songArtist}
                                        {songAlbum && ` · ${songAlbum}`}
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Bottom controls */}
                <div className="px-6 pb-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pb-8 space-y-4">
                    {/* Progress */}
                    <div>
                        <ProgressBar />
                        <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground tabular-nums">
                            <span>{formatDuration(currentTime)}</span>
                            <span>{formatDuration(duration)}</span>
                        </div>
                    </div>

                    {/* Controls row */}
                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => toggleFavorite(currentSong as any)}
                            className="p-2 rounded-full transition-all"
                        >
                            <Heart className={cn('h-6 w-6', isFavorite ? 'fill-primary text-primary' : 'text-foreground/70')} />
                        </button>

                        <PlayerControls />

                        <SleepTimerButton />
                    </div>
                </div>
            </div>
        </div>
    );
}
