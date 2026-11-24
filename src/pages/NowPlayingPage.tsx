/**
 * NowPlayingPage — Edge-to-edge immersive listening sanctuary.
 *
 * Clean layout:
 * - Minimal, uncluttered top bar (Chevron left, "Now playing" center, Info right)
 * - Large centered 1:1 square artwork (never stretched)
 * - Metadata row with Favorite and Share buttons
 * - Seeker timeline with subtle Stereo Audio badge
 * - Tactile squircle transport deck (Prev, Luminous Amber Play, Next) flanked by Shuffle & Repeat
 * - Translucent 4-button bottom utility dock: [Lyrics] [Queue] [Timer] [Volume]
 * - Desktop studio lounge with dual-column balance
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ChevronDown,
    Heart,
    ListMusic,
    Mic2,
    Music2,
    Volume1,
    Volume2,
    VolumeX,
    Maximize2,
    Minimize2,
    Share2,
    Info,
    Check,
    ExternalLink,
    X,
    Radio,
    MoreHorizontal,
    ListPlus,
    Plus,
    Moon,
    Timer,
    SlidersHorizontal,
} from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { useSleepTimer } from '@/hooks/useSleepTimer';
import { formatDuration } from '@/utils/format';
import { trackArtworkUrls } from '@/utils/trackArtwork';
import { saavnTrackUrl, trackShareUrl } from '@/utils/trackShare';
import { ProgressBar } from '@/components/player/ProgressBar';
import { PlayerControls } from '@/components/player/PlayerControls';
import { LyricsPanel } from '@/components/lyrics/LyricsPanel';
import { PlaybackError } from '@/components/player/PlaybackError';
import { QueuePanel } from '@/components/queue/QueuePanel';
import * as Slider from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';
import type { TrackItem } from '@/types/music';

const TIMER_PRESETS: { label: string; value: number | 'end_of_song' }[] = [
    { label: '15 minutes', value: 15 },
    { label: '30 minutes', value: 30 },
    { label: '45 minutes', value: 45 },
    { label: '1 hour', value: 60 },
    { label: 'End of track', value: 'end_of_song' },
];

export function NowPlayingPage() {
    const navigate = useNavigate();
    const currentSong = usePlayerStore(s => s.currentSong);
    const isPlaying = usePlayerStore(s => s.isPlaying);
    const currentTime = usePlayerStore(s => s.currentTime);
    const duration = usePlayerStore(s => s.duration);
    const queue = usePlayerStore(s => s.queue);
    const volume = usePlayerStore(s => s.volume);
    const isMuted = usePlayerStore(s => s.isMuted);
    const setVolume = usePlayerStore(s => s.setVolume);
    const toggleMute = usePlayerStore(s => s.toggleMute);

    const isFavorite = usePlayerStore(s => currentSong ? s.isFavorite(currentSong.id || currentSong.videoId || '') : false);
    const toggleFavorite = usePlayerStore(s => s.toggleFavorite);
    const addNext = usePlayerStore(s => s.addNext);
    const addToQueue = usePlayerStore(s => s.addToQueue);
    const sleepTimer = useSleepTimer();

    const [desktopTab, setDesktopTab] = useState<'lyrics' | 'queue' | 'player'>('lyrics');
    const [showVolumeSheet, setShowVolumeSheet] = useState(false);
    const [showSleepTimerSheet, setShowSleepTimerSheet] = useState(false);
    const [showSongMenuSheet, setShowSongMenuSheet] = useState(false);
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [copied, setCopied] = useState(false);
    const [shareMessage, setShareMessage] = useState('');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [artworkFallback, setArtworkFallback] = useState({ key: '', index: 0 });

    const modalRef = useRef<HTMLDivElement>(null);

    // The global lyrics shortcut and the mobile stage share one toggle.
    const isLyricsOpen = useUIStore(s => s.isLyricsOpen);
    const setLyricsOpen = useUIStore(s => s.setLyricsOpen);
    const activeStage = isLyricsOpen ? 'lyrics' : 'cover';

    const handleSwitchStage = (stage: 'cover' | 'lyrics') => {
        setLyricsOpen(stage === 'lyrics');
    };

    // Close modals and sheets on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setShowInfoModal(false);
                setShowVolumeSheet(false);
                setShowSleepTimerSheet(false);
                setShowSongMenuSheet(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    function closePlayer() {
        if (window.history.state?.idx > 0) navigate(-1);
        else navigate('/', { replace: true });
    }

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
            setIsFullscreen(true);
        } else {
            document.exitFullscreen().catch(() => {});
            setIsFullscreen(false);
        }
    };

    const songId = currentSong?.videoId || currentSong?.id;
    const title = currentSong?.name || currentSong?.title || 'Untitled track';
    const artist = currentSong?.artist?.name || currentSong?.author || 'Unknown artist';
    const album = currentSong?.album?.name;
    const artworkUrls = currentSong ? trackArtworkUrls(currentSong) : [];
    const saavnUrl = currentSong && saavnTrackUrl(currentSong);
    const artworkKey = JSON.stringify([songId, artworkUrls]);
    const artworkIndex = artworkFallback.key === artworkKey ? artworkFallback.index : 0;
    const art = artworkUrls[artworkIndex];
    const handleArtworkError = () => {
        setArtworkFallback(previous => previous.key === artworkKey && previous.index > artworkIndex
            ? previous
            : { key: artworkKey, index: artworkIndex + 1 });
    };

    const effectiveVolume = isMuted ? 0 : volume;
    const timerLabel = sleepTimer.state.preset === 'end_of_song' ? 'End of song' : `${Math.ceil(sleepTimer.state.remainingSeconds / 60)}m`;

    // Handle native share
    const handleShare = async () => {
        if (!currentSong) return;
        setShareMessage('');
        if (navigator.share) {
            try {
                await navigator.share({
                    title,
                    text: `Listening to ${title} by ${artist}`,
                    url: trackShareUrl(currentSong, window.location.origin),
                });
                setShareMessage('Track link shared.');
                return;
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') return;
            }
        }
        handleCopyLink();
    };

    // Direct clipboard copy
    const handleCopyLink = useCallback(async () => {
        if (!currentSong) return;
        try {
            await navigator.clipboard.writeText(trackShareUrl(currentSong, window.location.origin));
            setCopied(true);
            setShareMessage('Track link copied.');
            setTimeout(() => setCopied(false), 2200);
        } catch {
            setCopied(false);
            setShareMessage('Could not copy the track link. Check clipboard permissions and try again.');
        }
    }, [currentSong]);

    return (
        <section
            aria-label="Now playing"
            className="relative flex h-full flex-col isolate overflow-hidden bg-[#090a0f] text-foreground select-none"
            onKeyDown={event => {
                const target = event.target as HTMLElement;
                if ((event.code === 'Space' && target.closest('button')) || target.closest('[role="slider"]')) {
                    event.stopPropagation();
                }
            }}
        >
            {/* Ambient atmospheric backdrop */}
            {art && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                    <img
                        key={art}
                        src={art}
                        alt=""
                        onError={handleArtworkError}
                        className={cn(
                            'h-full w-full object-cover opacity-30 blur-[90px] scale-150 transition-all duration-1000 motion-reduce:transition-none',
                            isPlaying ? 'opacity-35 scale-160' : 'opacity-20 scale-140'
                        )}
                    />
                    <div className="absolute inset-0 bg-radial-[circle_at_center,_transparent_20%,_#090a0f_85%]" />
                    <div className="absolute inset-0 bg-gradient-to-b from-[#090a0f]/80 via-transparent to-[#090a0f]" />
                </div>
            )}

            {/* Clean, Decluttered Top Bar (No heavy segmented switcher) */}
            <header className="mx-auto flex w-full max-w-7xl shrink-0 items-center justify-between px-4 py-2 sm:px-8 sm:py-3 z-20">
                <button
                    type="button"
                    onClick={closePlayer}
                    className="inline-flex size-10 items-center justify-center rounded-full text-foreground/80 hover:text-foreground hover:bg-white/[0.08] transition-all active:scale-95"
                    aria-label="Close Now Playing"
                    title="Close Now Playing"
                >
                    <ChevronDown className="size-6" aria-hidden="true" />
                </button>

                <div className="flex flex-col items-center text-center px-2 min-w-0">
                    <p className="font-heading text-xs uppercase tracking-wider font-semibold text-muted-foreground">Now playing</p>
                    {album && (
                        <p className="text-[11px] text-foreground/60 truncate max-w-[200px] sm:max-w-xs">{album}</p>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setShowInfoModal(true)}
                        className="inline-flex size-10 items-center justify-center rounded-full text-foreground/80 hover:text-foreground hover:bg-white/[0.08] transition-all active:scale-95"
                        title="Track info & stream specs"
                        aria-label="Track info"
                    >
                        <Info className="size-5" />
                    </button>

                    <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="hidden sm:inline-flex size-10 items-center justify-center rounded-full text-foreground/80 hover:text-foreground hover:bg-white/[0.08] transition-all active:scale-95"
                        title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                        aria-label="Toggle full screen"
                    >
                        {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                    </button>
                </div>
            </header>

            <PlaybackError />
            {shareMessage && <p role="status" className="shrink-0 px-4 py-2 text-center text-sm">{shareMessage}</p>}

            {currentSong ? (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-none px-3 pb-2 sm:px-8 sm:pb-4 flex flex-col">

                    {/* ───────────────── MOBILE & TABLET LAYOUT (< lg) ───────────────── */}
                    <div className="flex flex-col lg:hidden max-w-md mx-auto w-full flex-1 min-h-0 px-1">

                        {/* Upper Stage: Dynamic focal point (Artwork or Lyrics) */}
                        <div className="flex-1 min-h-0 w-full flex items-center justify-center py-2 sm:py-3">
                            {activeStage === 'cover' && (
                                <div className="relative aspect-square w-full max-h-[min(380px,46vh)] max-w-[min(100%,380px,46vh)] rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.85)] ring-1 ring-white/15 bg-card mx-auto flex items-center justify-center transition-all duration-300">
                                    {art ? (
                                        <img
                                            src={art}
                                            onError={handleArtworkError}
                                            alt={title}
                                            className="size-full object-cover aspect-square transition-transform duration-700 motion-reduce:transition-none"
                                        />
                                    ) : (
                                        <div className="size-full flex items-center justify-center bg-surface">
                                            <Music2 className="size-20 text-muted-foreground" />
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeStage === 'lyrics' && (
                                <div className="w-full h-full max-h-[520px] flex flex-col min-h-0 relative animate-fade-in px-1">
                                    {/* Subtle top indicator bar */}
                                    <div className="flex items-center justify-between px-2 py-1 mb-1 shrink-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="size-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                                            <span className="text-xs font-semibold text-foreground/80 tracking-wide uppercase">Lyrics</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleSwitchStage('cover')}
                                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 border border-white/10 text-xs font-semibold text-amber-300 transition-all shadow-sm"
                                            title="Return to album cover"
                                        >
                                            <Music2 className="size-3.5" />
                                            <span>Show Cover</span>
                                        </button>
                                    </div>

                                    <div className="flex-1 min-h-0 overflow-hidden">
                                        <LyricsPanel embedded onClose={() => handleSwitchStage('cover')} />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Lower Controls Hub: Cohesive, tightly grouped interactive deck */}
                        <div className="shrink-0 w-full flex flex-col gap-3.5 sm:gap-4 pt-1 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">

                            {/* 1. Track Info & Favorite/Options */}
                            <div className="flex items-center justify-between gap-3 px-1">
                                <div className="min-w-0 flex-1">
                                    <h1 title={title} className="font-heading text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
                                        {title}
                                    </h1>
                                    <p title={artist} className="text-sm sm:text-base font-medium text-foreground/75 truncate mt-0.5">
                                        {artist}
                                    </p>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => toggleFavorite(currentSong as TrackItem)}
                                        className={cn(
                                            'grid size-11 place-items-center rounded-full transition-all active:scale-95',
                                            isFavorite ? 'text-amber-400' : 'text-foreground/70 hover:text-foreground hover:bg-white/[0.08]'
                                        )}
                                        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                                        aria-pressed={isFavorite}
                                    >
                                        <Heart className={cn('size-6 transition-transform', isFavorite && 'fill-amber-400 scale-105')} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setShowSongMenuSheet(true)}
                                        className="grid size-11 place-items-center rounded-full text-foreground/70 hover:text-foreground hover:bg-white/[0.08] active:scale-95 transition-all"
                                        title="Track options"
                                        aria-label="Track options"
                                    >
                                        <MoreHorizontal className="size-6" />
                                    </button>
                                </div>
                            </div>

                            {/* 2. Timeline & Scrubber with interactive audio quality badge */}
                            <div className="px-1 space-y-1.5">
                                <ProgressBar />
                                <div className="flex justify-between items-center text-[11px] font-mono text-muted-foreground tabular-nums">
                                    <span>{formatDuration(currentTime)}</span>

                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] active:scale-95 border border-white/10 text-[10px] font-semibold text-amber-300/90 hover:text-amber-300 tracking-wider uppercase transition-all cursor-pointer"
                                        title="Stereo Audio"
                                        aria-label="Stereo Audio"
                                    >
                                        <Radio className="size-2.5 text-amber-400" />
                                        <span>Stereo Audio</span>
                                    </button>

                                    <span>{formatDuration(duration)}</span>
                                </div>
                            </div>

                            {/* 3. Tactile 3-Squircle Transport Deck */}
                            <div className="py-0.5 sm:py-1">
                                <PlayerControls layout="tactile" />
                            </div>

                            {/* 4. Sleek Floating Utility Dock: [Lyrics] [Queue] [Timer] [Volume] */}
                            <div className="grid grid-cols-4 items-center gap-1.5 rounded-2xl bg-neutral-900/80 p-1.5 ring-1 ring-inset ring-white/10 backdrop-blur-2xl shadow-xl">
                                <button
                                    type="button"
                                    onClick={() => handleSwitchStage(activeStage === 'lyrics' ? 'cover' : 'lyrics')}
                                    aria-pressed={activeStage === 'lyrics'}
                                    className={cn(
                                        'flex flex-col sm:flex-row min-h-12 w-full items-center justify-center gap-1 sm:gap-1.5 rounded-xl px-1 py-1.5 text-xs font-semibold transition-all active:scale-95',
                                        activeStage === 'lyrics'
                                            ? 'bg-gradient-to-r from-amber-400 to-amber-500 text-neutral-950 font-bold shadow-md shadow-amber-400/25'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]'
                                    )}
                                >
                                    {activeStage === 'lyrics' ? (
                                        <Music2 className="size-4 shrink-0" aria-hidden="true" />
                                    ) : (
                                        <Mic2 className="size-4 shrink-0" aria-hidden="true" />
                                    )}
                                    <span className="truncate">{activeStage === 'lyrics' ? 'Cover' : 'Lyrics'}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => navigate('/queue')}
                                    className="flex flex-col sm:flex-row min-h-12 w-full items-center justify-center gap-1 sm:gap-1.5 rounded-xl px-1 py-1.5 text-xs font-semibold transition-all active:scale-95 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] relative"
                                    title="Open Queue"
                                    aria-label="Open Queue"
                                >
                                    <div className="relative shrink-0">
                                        <ListMusic className="size-4" aria-hidden="true" />
                                        {queue.length > 0 && (
                                            <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-neutral-950">
                                                {queue.length > 99 ? '99+' : queue.length}
                                            </span>
                                        )}
                                    </div>
                                    <span className="truncate">Queue</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setShowSleepTimerSheet(true)}
                                    aria-pressed={sleepTimer.state.isActive}
                                    className={cn(
                                        'flex flex-col sm:flex-row min-h-12 w-full items-center justify-center gap-1 sm:gap-1.5 rounded-xl px-1 py-1.5 text-xs font-semibold transition-all active:scale-95 relative',
                                        sleepTimer.state.isActive
                                            ? 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/40'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]'
                                    )}
                                >
                                    <div className="relative shrink-0">
                                        <Moon className={cn('size-4', sleepTimer.state.isActive && 'text-amber-400')} aria-hidden="true" />
                                        {sleepTimer.state.isActive && (
                                            <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-neutral-950">
                                                {sleepTimer.state.preset === 'end_of_song' ? '♪' : Math.ceil(sleepTimer.state.remainingSeconds / 60)}
                                            </span>
                                        )}
                                    </div>
                                    <span className="truncate">{sleepTimer.state.isActive ? timerLabel : 'Timer'}</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setShowVolumeSheet(true)}
                                    aria-expanded={showVolumeSheet}
                                    className={cn(
                                        'flex flex-col sm:flex-row min-h-12 w-full items-center justify-center gap-1 sm:gap-1.5 rounded-xl px-1 py-1.5 text-xs font-semibold transition-all active:scale-95 relative',
                                        showVolumeSheet
                                            ? 'bg-white/10 text-foreground'
                                            : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.06]'
                                    )}
                                >
                                    <div className="shrink-0">
                                        {isMuted || effectiveVolume === 0 ? (
                                            <VolumeX className="size-4 text-rose-400" aria-hidden="true" />
                                        ) : effectiveVolume < 0.5 ? (
                                            <Volume1 className="size-4" aria-hidden="true" />
                                        ) : (
                                            <Volume2 className="size-4" aria-hidden="true" />
                                        )}
                                    </div>
                                    <span className="truncate">{isMuted ? 'Muted' : `${Math.round(effectiveVolume * 100)}%`}</span>
                                </button>
                            </div>

                        </div>

                    </div>

                    {/* ───────────────── DESKTOP STUDIO LAYOUT (>= lg) ───────────────── */}
                    <div className="hidden lg:grid max-w-7xl mx-auto w-full grid-cols-[minmax(340px,440px)_minmax(0,1fr)] gap-8 xl:gap-14 items-center flex-1 my-auto">

                        {/* Left Column: Cover, Scrubber & Controls */}
                        <div className="flex flex-col gap-5">

                            {/* Album Artwork */}
                            <div className="relative aspect-square w-full max-w-[400px] mx-auto rounded-3xl overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.9)] ring-1 ring-white/15 bg-card flex items-center justify-center">
                                {art ? (
                                    <img
                                        src={art}
                                        onError={handleArtworkError}
                                        alt={title}
                                        className="size-full object-cover aspect-square transition-transform duration-700 motion-reduce:transition-none"
                                    />
                                ) : (
                                    <div className="size-full flex items-center justify-center bg-surface">
                                        <Music2 className="size-20 text-muted-foreground" />
                                    </div>
                                )}
                            </div>

                            {/* Metadata & Actions */}
                            <div>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1">
                                        <h1 title={title} className="font-heading text-2xl xl:text-3xl font-bold tracking-tight text-foreground line-clamp-2">
                                            {title}
                                        </h1>
                                        <p title={artist} className="text-base font-medium text-foreground/80 mt-1">
                                            {artist}
                                        </p>
                                        {album && (
                                            <p title={album} className="text-xs text-muted-foreground mt-0.5 truncate">
                                                {album}
                                            </p>
                                        )}
                                    </div>

                                    {/* Action cluster */}
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setShowSongMenuSheet(true)}
                                            className="grid size-10 place-items-center rounded-full text-foreground/70 hover:text-foreground hover:bg-white/[0.08] active:scale-95 transition-all"
                                            title="Song options"
                                            aria-label="Song options"
                                        >
                                            <MoreHorizontal className="size-5" />
                                        </button>

                                        <button
                                            type="button"
                                            onClick={handleShare}
                                            className="grid size-10 place-items-center rounded-full text-foreground/70 hover:text-foreground hover:bg-white/[0.08] active:scale-95 transition-all relative"
                                            title="Share link"
                                            aria-label="Share track"
                                        >
                                            {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => toggleFavorite(currentSong as TrackItem)}
                                            className={cn(
                                                'grid size-10 place-items-center rounded-full transition-all active:scale-95',
                                                isFavorite ? 'bg-amber-400 text-neutral-950 shadow-md shadow-amber-400/30' : 'text-foreground/70 hover:text-foreground hover:bg-white/[0.08]'
                                            )}
                                            aria-label="Favorite"
                                            aria-pressed={isFavorite}
                                        >
                                            <Heart className={cn('size-4 transition-transform', isFavorite && 'fill-current scale-105')} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Scrubber & Audio Stream badge */}
                            <div>
                                <ProgressBar />
                                <div className="flex justify-between items-center text-xs font-mono text-muted-foreground tabular-nums mt-1">
                                    <span>{formatDuration(currentTime)}</span>
                                    <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/[0.05] hover:bg-white/[0.1] active:scale-95 border border-white/10 text-[10px] font-semibold text-amber-300 tracking-wider uppercase transition-all cursor-pointer"
                                        title="Stereo Audio"
                                        aria-label="Stereo Audio"
                                    >
                                        <Radio className="size-2.5 text-amber-400" />
                                        <span>Stereo Audio</span>
                                    </button>
                                    <span>{formatDuration(duration)}</span>
                                </div>
                            </div>

                            {/* Transport controls */}
                            <div>
                                <PlayerControls layout="tactile" />
                            </div>

                            {/* Desktop Volume Slider */}
                            <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
                                <button
                                    onClick={toggleMute}
                                    className="p-1 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                                    title="Mute (M)"
                                    aria-label="Mute"
                                >
                                    {isMuted || effectiveVolume === 0 ? (
                                        <VolumeX className="size-4" />
                                    ) : (
                                        <Volume2 className="size-4" />
                                    )}
                                </button>
                                <Slider.Root
                                    className="relative flex items-center flex-1 h-5 cursor-pointer select-none touch-none"
                                    value={[effectiveVolume * 100]}
                                    max={100}
                                    step={1}
                                    aria-label="Volume slider"
                                    onValueChange={(val) => {
                                        if (isMuted) toggleMute();
                                        setVolume(val[0] / 100);
                                    }}
                                >
                                    <Slider.Track className="relative h-1.5 w-full rounded-full bg-white/10">
                                        <Slider.Range className="absolute h-full rounded-full bg-amber-400" />
                                    </Slider.Track>
                                    <Slider.Thumb aria-label="Volume level" className="block size-3.5 rounded-full bg-amber-200 shadow-sm focus-visible:outline-2 focus-visible:outline-amber-400" />
                                </Slider.Root>
                                <span className="text-[11px] font-mono text-muted-foreground w-8 text-right">
                                    {Math.round(effectiveVolume * 100)}%
                                </span>
                            </div>

                            {/* Keyboard Shortcuts Hint */}
                            <p className="text-[11px] text-muted-foreground/60 text-center font-mono">
                                [Space] Play · [←/→] Seek · [L] Lyrics · [Q] Queue · [M] Mute
                            </p>
                        </div>

                        {/* Right Column: Studio Listening Console */}
                        <div className="h-[560px] xl:h-[620px] max-h-[calc(100dvh-100px)] rounded-3xl bg-card/60 backdrop-blur-2xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden">
                            {/* Tab Switcher Header */}
                            <div role="tablist" aria-label="Studio views" className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] shrink-0">
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={desktopTab === 'lyrics'}
                                        onClick={() => setDesktopTab('lyrics')}
                                        className={cn(
                                            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                                            desktopTab === 'lyrics'
                                                ? 'bg-amber-400 text-neutral-950 font-bold shadow-md shadow-amber-400/20'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                                        )}
                                    >
                                        <Mic2 className="size-4" /> Lyrics
                                    </button>

                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={desktopTab === 'queue'}
                                        onClick={() => setDesktopTab('queue')}
                                        className={cn(
                                            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all',
                                            desktopTab === 'queue'
                                                ? 'bg-amber-400 text-neutral-950 font-bold shadow-md shadow-amber-400/20'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                                        )}
                                    >
                                        <ListMusic className="size-4" /> Up Next ({queue.length})
                                    </button>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setShowInfoModal(true)}
                                    className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-white/[0.06]"
                                >
                                    <Info className="size-3.5" /> Track Details
                                </button>
                            </div>

                            {/* Tab Content */}
                            <div className="flex-1 min-h-0 overflow-hidden">
                                {desktopTab === 'queue' ? (
                                    <QueuePanel embedded />
                                ) : desktopTab === 'lyrics' ? (
                                    <LyricsPanel embedded onClose={() => setDesktopTab('player')} />
                                ) : null}
                            </div>
                        </div>

                    </div>

                </div>
            ) : (
                <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-8 text-center">
                    <div className="max-w-md p-8 rounded-3xl bg-card/60 backdrop-blur-2xl border border-white/[0.08] shadow-2xl">
                        <div className="size-16 rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400 grid place-items-center mx-auto mb-4">
                            <Music2 className="size-8" />
                        </div>
                        <h1 className="font-heading text-2xl font-bold text-foreground">Nothing is playing</h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Explore tracks, playlists, or albums to start listening.
                        </p>
                        <button
                            type="button"
                            onClick={() => navigate('/search', { replace: true })}
                            className="mt-6 min-h-11 px-6 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-neutral-950 font-bold hover:brightness-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                        >
                            Discover Music
                        </button>
                    </div>
                </div>
            )}

            {/* Audio & Volume Bottom Sheet */}
            {showVolumeSheet && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Audio and Volume Settings"
                    className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-fade-in"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowVolumeSheet(false);
                    }}
                >
                    <div className="w-full max-w-md mx-auto max-h-[85dvh] overflow-y-auto overscroll-contain scrollbar-none rounded-t-3xl border-t border-x border-white/10 bg-neutral-900/95 backdrop-blur-2xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl space-y-5 animate-slide-up">
                        <div className="w-12 h-1.5 rounded-full bg-white/20 mx-auto -mt-2 mb-2" />
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                            <div className="flex items-center gap-2">
                                <Volume2 className="size-5 text-amber-400" />
                                <h3 className="font-heading text-base font-bold text-foreground">Audio & Volume</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowVolumeSheet(false)}
                                className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground"
                                aria-label="Close audio controls"
                            >
                                <X className="size-4" />
                            </button>
                        </div>

                        {/* Main Volume Slider */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground font-medium">Output Level</span>
                                <span className="font-mono font-bold text-amber-300">
                                    {isMuted ? 'Muted (0%)' : `${Math.round(effectiveVolume * 100)}%`}
                                </span>
                            </div>
                            <div className="flex items-center gap-4">
                                <button
                                    type="button"
                                    onClick={toggleMute}
                                    className={cn(
                                        'p-2.5 rounded-xl transition-all active:scale-95',
                                        isMuted ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-white/[0.08] text-foreground hover:bg-white/[0.14]'
                                    )}
                                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                                >
                                    {isMuted || effectiveVolume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                                </button>
                                <Slider.Root
                                    className="relative flex items-center flex-1 h-6 cursor-pointer select-none touch-none"
                                    value={[effectiveVolume * 100]}
                                    max={100}
                                    step={1}
                                    aria-label="Volume slider"
                                    onValueChange={(val) => {
                                        if (isMuted) toggleMute();
                                        setVolume(val[0] / 100);
                                    }}
                                >
                                    <Slider.Track className="relative h-2 w-full rounded-full bg-white/10 overflow-hidden">
                                        <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.5)]" />
                                    </Slider.Track>
                                    <Slider.Thumb aria-label="Volume level" className="block size-4 rounded-full bg-amber-100 ring-2 ring-amber-400 shadow-md focus-visible:outline-none" />
                                </Slider.Root>
                            </div>
                        </div>

                        {/* Quick Volume Preset Chips */}
                        <div className="grid grid-cols-4 gap-2 pt-1">
                            {[25, 50, 75, 100].map((level) => (
                                <button
                                    key={level}
                                    type="button"
                                    onClick={() => {
                                        if (isMuted) toggleMute();
                                        setVolume(level / 100);
                                    }}
                                    className={cn(
                                        'py-2 rounded-xl text-xs font-semibold border transition-all active:scale-95',
                                        Math.round(effectiveVolume * 100) === level && !isMuted
                                            ? 'bg-amber-400/20 text-amber-300 border-amber-400/40 shadow-sm'
                                            : 'bg-white/[0.04] text-muted-foreground hover:text-foreground border-white/5 hover:bg-white/[0.08]'
                                    )}
                                >
                                    {level}%
                                </button>
                            ))}
                        </div>

                        {/* Audio Stream Specs Preview */}
                        <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Radio className="size-3.5 text-amber-400" />
                                <span className="text-xs text-muted-foreground">Stereo Web Audio · 44.1 kHz</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setShowVolumeSheet(false);
                                    setShowInfoModal(true);
                                }}
                                className="text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors"
                            >
                                View Specs
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sleep Timer Bottom Sheet */}
            {showSleepTimerSheet && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Sleep Timer Options"
                    className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-fade-in"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowSleepTimerSheet(false);
                    }}
                >
                    <div className="w-full max-w-md mx-auto max-h-[85dvh] overflow-y-auto overscroll-contain scrollbar-none rounded-t-3xl border-t border-x border-white/10 bg-neutral-900/95 backdrop-blur-2xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl space-y-5 animate-slide-up">
                        <div className="w-12 h-1.5 rounded-full bg-white/20 mx-auto -mt-2 mb-2" />
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                            <div className="flex items-center gap-2">
                                <Moon className="size-5 text-amber-400" />
                                <h3 className="font-heading text-base font-bold text-foreground">Sleep Timer</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowSleepTimerSheet(false)}
                                className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground"
                                aria-label="Close sleep timer"
                            >
                                <X className="size-4" />
                            </button>
                        </div>

                        {sleepTimer.state.isActive ? (
                            <div className="text-center py-4 space-y-4">
                                <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-amber-400/10 border border-amber-400/20 text-amber-400">
                                    <Timer className="size-7 animate-pulse" />
                                </div>
                                <div>
                                    <p className="text-3xl font-heading font-bold tabular-nums text-foreground">
                                        {sleepTimer.state.preset === 'end_of_song' ? timerLabel : formatDuration(sleepTimer.state.remainingSeconds)}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {sleepTimer.state.preset === 'end_of_song' ? 'Playback stops before the next track or repeat.' : 'Music will smoothly pause when the timer ends.'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        sleepTimer.cancelTimer();
                                        setShowSleepTimerSheet(false);
                                    }}
                                    className="w-full py-3 rounded-2xl bg-destructive/15 text-destructive hover:bg-destructive/25 transition-all text-sm font-semibold flex items-center justify-center gap-2"
                                >
                                    <X className="size-4" /> Cancel Timer
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <p className="text-xs text-muted-foreground pb-1">
                                    Select duration to pause playback automatically:
                                </p>
                                <div className="grid grid-cols-1 gap-2">
                                    {TIMER_PRESETS.map((preset) => (
                                        <button
                                            key={preset.label}
                                            type="button"
                                            onClick={() => {
                                                sleepTimer.startTimer(preset.value);
                                                setShowSleepTimerSheet(false);
                                            }}
                                            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 text-sm font-medium text-foreground transition-all active:scale-[0.98]"
                                        >
                                            <span className="flex items-center gap-3">
                                                <Timer className="size-4 text-amber-400" />
                                                {preset.label}
                                            </span>
                                            <span className="text-xs text-muted-foreground font-mono">Start</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Song Options Bottom Sheet */}
            {showSongMenuSheet && currentSong && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Song Menu Options"
                    className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-fade-in"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowSongMenuSheet(false);
                    }}
                >
                    <div className="w-full max-w-md mx-auto max-h-[85dvh] overflow-y-auto overscroll-contain scrollbar-none rounded-t-3xl border-t border-x border-white/10 bg-neutral-900/95 backdrop-blur-2xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-2xl space-y-4 animate-slide-up">
                        <div className="w-12 h-1.5 rounded-full bg-white/20 mx-auto -mt-2 mb-2" />
                        {/* Header: Track preview */}
                        <div className="flex items-center justify-between border-b border-white/10 pb-4">
                            <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                                {art ? (
                                    <img src={art} onError={handleArtworkError} alt={title} className="size-12 rounded-xl object-cover shrink-0 ring-1 ring-white/10" />
                                ) : (
                                    <div className="size-12 rounded-xl bg-surface grid place-items-center shrink-0">
                                        <Music2 className="size-6 text-muted-foreground" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <h3 className="font-heading text-sm font-bold text-foreground truncate">{title}</h3>
                                    <p className="text-xs text-muted-foreground truncate">{artist}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowSongMenuSheet(false)}
                                className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground shrink-0"
                                aria-label="Close menu"
                            >
                                <X className="size-4" />
                            </button>
                        </div>

                        {/* Menu Actions */}
                        <div className="space-y-1">
                            <button
                                type="button"
                                onClick={() => {
                                    toggleFavorite(currentSong as TrackItem);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] text-sm text-foreground transition-colors"
                            >
                                <Heart className={cn('size-4', isFavorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} />
                                <span>{isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    addNext(currentSong as TrackItem);
                                    setShowSongMenuSheet(false);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] text-sm text-foreground transition-colors"
                            >
                                <ListPlus className="size-4 text-muted-foreground" />
                                <span>Play Next</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    addToQueue(currentSong as TrackItem);
                                    setShowSongMenuSheet(false);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] text-sm text-foreground transition-colors"
                            >
                                <Plus className="size-4 text-muted-foreground" />
                                <span>Add to Queue</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setShowSongMenuSheet(false);
                                    setShowSleepTimerSheet(true);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] text-sm text-foreground transition-colors"
                            >
                                <Moon className="size-4 text-muted-foreground" />
                                <span>Sleep Timer</span>
                                {sleepTimer.state.isActive && (
                                    <span className="ml-auto text-xs font-mono text-amber-400">
                                        {timerLabel}
                                    </span>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setShowSongMenuSheet(false);
                                    setShowVolumeSheet(true);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] text-sm text-foreground transition-colors"
                            >
                                <SlidersHorizontal className="size-4 text-muted-foreground" />
                                <span>Audio & Volume</span>
                                <span className="ml-auto text-xs font-mono text-muted-foreground">
                                    {Math.round(effectiveVolume * 100)}%
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setShowSongMenuSheet(false);
                                    setShowInfoModal(true);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] text-sm text-foreground transition-colors"
                            >
                                <Info className="size-4 text-muted-foreground" />
                                <span>Track & Stream Details</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    handleShare();
                                    setShowSongMenuSheet(false);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] text-sm text-foreground transition-colors"
                            >
                                {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4 text-muted-foreground" />}
                                <span>{copied ? 'Link Copied!' : 'Share Track'}</span>
                            </button>

                            {saavnUrl && (
                                <a
                                    href={saavnUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.06] text-sm text-foreground transition-colors"
                                >
                                    <ExternalLink className="size-4 text-muted-foreground" />
                                    <span>Open on JioSaavn</span>
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Accessible Technical Track Inspector Modal */}
            {showInfoModal && currentSong && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="track-info-title"
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShowInfoModal(false);
                    }}
                >
                    <div ref={modalRef} className="w-full max-w-sm rounded-3xl bg-neutral-900 border border-white/10 p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                            <div className="flex items-center gap-2">
                                <Radio className="size-4 text-amber-400" />
                                <h3 id="track-info-title" className="font-heading text-base font-bold text-foreground">Track & Stream Info</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowInfoModal(false)}
                                className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground"
                                aria-label="Close track info"
                            >
                                <X className="size-4" />
                            </button>
                        </div>

                        <div className="space-y-2.5 text-xs">
                            <div className="flex justify-between py-1 border-b border-white/5">
                                <span className="text-muted-foreground">Title</span>
                                <span className="font-medium text-foreground truncate max-w-[200px]">{title}</span>
                            </div>
                            <div className="flex justify-between py-1 border-b border-white/5">
                                <span className="text-muted-foreground">Artist</span>
                                <span className="font-medium text-foreground truncate max-w-[200px]">{artist}</span>
                            </div>
                            {album && (
                                <div className="flex justify-between py-1 border-b border-white/5">
                                    <span className="text-muted-foreground">Album</span>
                                    <span className="font-medium text-foreground truncate max-w-[200px]">{album}</span>
                                </div>
                            )}
                            <div className="flex justify-between py-1 border-b border-white/5">
                                <span className="text-muted-foreground">Format</span>
                                <span className="font-mono text-amber-300">Stereo Web Audio</span>
                            </div>
                            <div className="flex justify-between py-1 border-b border-white/5">
                                <span className="text-muted-foreground">Duration</span>
                                <span className="font-mono text-foreground">{formatDuration(duration)}</span>
                            </div>
                            {songId && (
                                <div className="flex justify-between py-1 border-b border-white/5">
                                    <span className="text-muted-foreground">Track ID</span>
                                    <span className="font-mono text-muted-foreground">{songId}</span>
                                </div>
                            )}
                        </div>

                        <div className="pt-2 flex gap-2">
                            <button
                                type="button"
                                onClick={handleCopyLink}
                                className="flex-1 py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] text-xs font-semibold text-foreground flex items-center justify-center gap-1.5 transition-colors"
                            >
                                {copied ? <Check className="size-3.5 text-emerald-400" /> : <Share2 className="size-3.5" />}
                                {copied ? 'Copied Link' : 'Copy Link'}
                            </button>
                            {saavnUrl && (
                                <a
                                    href={saavnUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex-1 py-2.5 rounded-xl bg-amber-400 text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 hover:brightness-110 transition-all"
                                >
                                    <ExternalLink className="size-3.5" /> Open on JioSaavn
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
