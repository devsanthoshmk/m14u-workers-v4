/**
 * PlayerControls — Reimagined tactile playback controls.
 * Features:
 * - 'tactile': The 3 prominent tactile squircle buttons flanked by Shuffle and Repeat
 * - 'full': Wide circular transport deck
 * - 'compact': Minimalist player-bar cluster
 */

import { usePlayerStore } from '@/stores/playerStore';
import { Shuffle, SkipBack, SkipForward, Repeat, Repeat1, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RepeatMode } from '@/types/player';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function PlayerControls({
    layout = 'compact',
}: {
    layout?: 'compact' | 'full' | 'tactile';
} = {}) {
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
        const currentIndex = modes.indexOf(repeatMode);
        setRepeatMode(modes[(currentIndex + 1) % modes.length]);
    };

    const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;
    const repeatLabel = { off: 'Off', all: 'All tracks', one: 'One track' }[repeatMode];
    const playLabel = isPlaying ? 'Pause' : 'Play';

    if (layout === 'tactile') {
        return (
            <div
                role="group"
                aria-label="Playback controls"
                className="flex items-center justify-between w-full max-w-sm mx-auto select-none gap-2 sm:gap-3"
            >
                {/* Shuffle */}
                <button
                    type="button"
                    onClick={toggleShuffle}
                    className={cn(
                        'relative size-10 grid place-items-center rounded-full transition-all text-muted-foreground hover:text-foreground hover:bg-white/[0.06] active:scale-95',
                        isShuffled && 'text-amber-400'
                    )}
                    title={isShuffled ? 'Shuffle on' : 'Shuffle off'}
                    aria-label="Shuffle"
                    aria-pressed={isShuffled}
                >
                    <Shuffle className="size-4.5" />
                    {isShuffled && (
                        <span className="absolute bottom-1 size-1 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
                    )}
                </button>

                {/* Previous squircle */}
                <button
                    type="button"
                    onClick={previous}
                    className={cn(
                        'flex-1 h-14 sm:h-16 max-w-[88px] grid place-items-center rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 text-foreground transition-all shadow-md border border-white/5',
                        focus
                    )}
                    title="Previous track"
                    aria-label="Previous track"
                >
                    <SkipBack className="size-6" fill="currentColor" />
                </button>

                {/* Center Play/Pause luminous amber squircle */}
                <button
                    type="button"
                    onClick={togglePlay}
                    className={cn(
                        'flex-1 h-14 sm:h-16 max-w-[110px] grid place-items-center rounded-2xl text-neutral-950 font-bold',
                        'bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500',
                        'shadow-[0_0_24px_rgba(245,158,11,0.45)] hover:shadow-[0_0_36px_rgba(245,158,11,0.65)]',
                        'ring-1 ring-white/35 hover:scale-105 active:scale-95 transition-all duration-200',
                        focus
                    )}
                    title={playLabel}
                    aria-label={playLabel}
                    aria-busy={isBuffering}
                >
                    {isBuffering ? (
                        <Loader2 className="size-7 animate-spin text-neutral-950" />
                    ) : isPlaying ? (
                        <PauseIcon size={26} />
                    ) : (
                        <PlayIcon size={26} />
                    )}
                </button>

                {/* Next squircle */}
                <button
                    type="button"
                    onClick={next}
                    className={cn(
                        'flex-1 h-14 sm:h-16 max-w-[88px] grid place-items-center rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 text-foreground transition-all shadow-md border border-white/5',
                        focus
                    )}
                    title="Next track"
                    aria-label="Next track"
                >
                    <SkipForward className="size-6" fill="currentColor" />
                </button>

                {/* Repeat */}
                <button
                    type="button"
                    onClick={cycleRepeat}
                    className={cn(
                        'relative size-10 grid place-items-center rounded-full transition-all text-muted-foreground hover:text-foreground hover:bg-white/[0.06] active:scale-95',
                        repeatMode !== 'off' && 'text-amber-400'
                    )}
                    title={`Repeat: ${repeatLabel}`}
                    aria-label={`Repeat: ${repeatLabel}`}
                >
                    <RepeatIcon className="size-4.5" />
                    {repeatMode !== 'off' && (
                        <span className="absolute bottom-1 size-1 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
                    )}
                </button>
            </div>
        );
    }

    const full = layout === 'full';

    return (
        <div
            role="group"
            aria-label="Playback controls"
            className={cn(
                'flex items-center select-none',
                full ? 'justify-between w-full max-w-[320px] mx-auto gap-2' : 'gap-2 md:gap-3'
            )}
        >
            {/* Shuffle */}
            <button
                type="button"
                onClick={toggleShuffle}
                className={cn(
                    'relative grid shrink-0 place-items-center rounded-full transition-all duration-200',
                    full ? 'size-11 hover:bg-white/[0.08]' : 'p-2 hover:bg-white/[0.06]',
                    isShuffled ? 'text-amber-400' : 'text-muted-foreground hover:text-foreground',
                    focus
                )}
                title={isShuffled ? 'Shuffle on' : 'Shuffle off'}
                aria-label="Shuffle"
                aria-pressed={isShuffled}
            >
                <Shuffle className={full ? 'size-5' : 'size-4'} />
                {isShuffled && (
                    <span className="absolute bottom-1.5 size-1 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
                )}
            </button>

            {/* Previous */}
            <button
                type="button"
                onClick={previous}
                className={cn(
                    'grid shrink-0 place-items-center rounded-full text-foreground/90 hover:text-foreground transition-all duration-200 active:scale-90',
                    full ? 'size-12 hover:bg-white/[0.08]' : 'p-2 hover:bg-white/[0.06]',
                    focus
                )}
                title="Previous track"
                aria-label="Previous track"
            >
                <SkipBack className={full ? 'size-6' : 'size-5'} fill="currentColor" />
            </button>

            {/* Play/Pause */}
            <button
                type="button"
                onClick={togglePlay}
                className={cn(
                    'relative grid shrink-0 place-items-center rounded-full text-neutral-950 font-bold',
                    'bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500',
                    'shadow-[0_0_24px_rgba(245,158,11,0.45)] hover:shadow-[0_0_36px_rgba(245,158,11,0.65)]',
                    'ring-1 ring-white/35 hover:scale-105 active:scale-95 transition-all duration-200',
                    full ? 'size-16' : 'size-11 shadow-[0_0_16px_rgba(245,158,11,0.35)]',
                    focus
                )}
                title={playLabel}
                aria-label={playLabel}
                aria-busy={isBuffering}
            >
                {isBuffering ? (
                    <Loader2 className={cn('motion-safe:animate-spin text-neutral-950', full ? 'size-7' : 'size-5')} />
                ) : isPlaying ? (
                    <PauseIcon size={full ? 24 : 18} />
                ) : (
                    <PlayIcon size={full ? 24 : 18} />
                )}
            </button>

            {/* Next */}
            <button
                type="button"
                onClick={next}
                className={cn(
                    'grid shrink-0 place-items-center rounded-full text-foreground/90 hover:text-foreground transition-all duration-200 active:scale-90',
                    full ? 'size-12 hover:bg-white/[0.08]' : 'p-2 hover:bg-white/[0.06]',
                    focus
                )}
                title="Next track"
                aria-label="Next track"
            >
                <SkipForward className={full ? 'size-6' : 'size-5'} fill="currentColor" />
            </button>

            {/* Repeat */}
            <button
                type="button"
                onClick={cycleRepeat}
                className={cn(
                    'relative grid shrink-0 place-items-center rounded-full transition-all duration-200',
                    full ? 'size-11 hover:bg-white/[0.08]' : 'p-2 hover:bg-white/[0.06]',
                    repeatMode !== 'off' ? 'text-amber-400' : 'text-muted-foreground hover:text-foreground',
                    focus
                )}
                title={`Repeat: ${repeatLabel}`}
                aria-label={`Repeat: ${repeatLabel}`}
            >
                <RepeatIcon className={full ? 'size-5' : 'size-4'} />
                {repeatMode !== 'off' && (
                    <span className="absolute bottom-1.5 size-1 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
                )}
            </button>
        </div>
    );
}

function PlayIcon({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="translate-x-0.5">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function PauseIcon({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1.5" />
            <rect x="14" y="4" width="4" height="16" rx="1.5" />
        </svg>
    );
}
