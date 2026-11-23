/**
 * PlayerControls — Redesigned with larger centered controls.
 * Reference-matched: shuffle | prev | PLAY/PAUSE (big) | next | repeat
 */

import { usePlayerStore } from '@/stores/playerStore';
import { Shuffle, SkipBack, SkipForward, Repeat, Repeat1, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RepeatMode } from '@/types/player';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function PlayerControls({ layout = 'compact' }: { layout?: 'compact' | 'full' } = {}) {
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
    const full = layout === 'full';
    const button = cn('grid shrink-0 place-items-center rounded-full hover:bg-surface-hover', full ? 'size-11' : 'p-2', focus);
    const repeatLabel = { off: 'Off', all: 'All tracks', one: 'One track' }[repeatMode];
    const playLabel = isPlaying ? 'Pause' : 'Play';

    return (
        <div role="group" aria-label="Playback controls" className={cn('flex items-center', full ? 'justify-between gap-1' : 'gap-3')}>
            {/* Shuffle */}
            <button
                type="button"
                onClick={toggleShuffle}
                className={cn(
                    button,
                    isShuffled ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
                title="Shuffle" aria-label="Shuffle" aria-pressed={isShuffled}
            >
                <Shuffle className="h-[18px] w-[18px]" />
            </button>

            {/* Previous */}
            <button
                type="button"
                onClick={previous}
                className={cn(button, 'text-foreground')}
                title="Previous track" aria-label="Previous track"
            >
                <SkipBack className="h-5 w-5" fill="currentColor" />
            </button>

            {/* Play/Pause — large, amber filled circle */}
            <button
                type="button"
                onClick={togglePlay}
                className={cn('grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:brightness-110 active:scale-95 shadow-lg shadow-primary/20', full ? 'size-16' : 'size-11', focus)}
                title={playLabel} aria-label={playLabel} aria-busy={isBuffering}
            >
                {isBuffering ? (
                    <Loader2 className="h-5 w-5 motion-safe:animate-spin" />
                ) : isPlaying ? (
                    <PauseIcon />
                ) : (
                    <PlayIcon />
                )}
            </button>

            {/* Next */}
            <button
                type="button"
                onClick={next}
                className={cn(button, 'text-foreground')}
                title="Next track" aria-label="Next track"
            >
                <SkipForward className="h-5 w-5" fill="currentColor" />
            </button>

            {/* Repeat */}
            <button
                type="button"
                onClick={cycleRepeat}
                className={cn(
                    button,
                    repeatMode !== 'off' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
                title={`Repeat: ${repeatLabel}`} aria-label={`Repeat: ${repeatLabel}`}
            >
                <RepeatIcon className="h-[18px] w-[18px]" />
            </button>
        </div>
    );
}

function PlayIcon() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
    );
}
