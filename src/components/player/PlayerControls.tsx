/**
 * PlayerControls — Redesigned with larger centered controls.
 * Reference-matched: shuffle | prev | PLAY/PAUSE (big) | next | repeat
 */

import { usePlayerStore } from '@/stores/playerStore';
import { Shuffle, SkipBack, SkipForward, Repeat, Repeat1, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RepeatMode } from '@/types/player';

export function PlayerControls() {
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

    return (
        <div className="flex items-center gap-3">
            {/* Shuffle */}
            <button
                onClick={toggleShuffle}
                className={cn(
                    'p-2 rounded-full transition-all hover:bg-white/5',
                    isShuffled ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
                title="Shuffle"
            >
                <Shuffle className="h-[18px] w-[18px]" />
            </button>

            {/* Previous */}
            <button
                onClick={previous}
                className="p-2 rounded-full text-foreground hover:text-white hover:bg-white/5 transition-all"
                title="Previous"
            >
                <SkipBack className="h-5 w-5" fill="currentColor" />
            </button>

            {/* Play/Pause — large, amber filled circle */}
            <button
                onClick={togglePlay}
                className="flex items-center justify-center h-11 w-11 rounded-full bg-primary text-primary-foreground hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-primary/20"
                title="Play/Pause (Space)"
            >
                {isBuffering ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                ) : isPlaying ? (
                    <PauseIcon />
                ) : (
                    <PlayIcon />
                )}
            </button>

            {/* Next */}
            <button
                onClick={next}
                className="p-2 rounded-full text-foreground hover:text-white hover:bg-white/5 transition-all"
                title="Next"
            >
                <SkipForward className="h-5 w-5" fill="currentColor" />
            </button>

            {/* Repeat */}
            <button
                onClick={cycleRepeat}
                className={cn(
                    'p-2 rounded-full transition-all hover:bg-white/5',
                    repeatMode !== 'off' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
                title={`Repeat: ${repeatMode}`}
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
