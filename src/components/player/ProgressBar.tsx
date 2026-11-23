/**
 * ProgressBar — High-precision seekable audio progress slider.
 * Uses Radix Slider for accessibility, keyboard navigation, and touch scrubbing.
 * Features a glowing amber gradient track and frosted glass time tooltip.
 */

import * as Slider from '@radix-ui/react-slider';
import { usePlayerStore } from '@/stores/playerStore';
import { formatDuration } from '@/utils/format';
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';

export function ProgressBar({ className }: { className?: string } = {}) {
    const currentTime = usePlayerStore(s => s.currentTime);
    const duration = usePlayerStore(s => s.duration);
    const seek = usePlayerStore(s => s.seek);
    const [isSeeking, setIsSeeking] = useState(false);
    const [seekValue, setSeekValue] = useState(0);
    const [hoverTime, setHoverTime] = useState<number | null>(null);

    const canSeek = Number.isFinite(duration) && duration > 0;
    const displayTime = canSeek ? Math.min(duration, Math.max(0, (isSeeking ? seekValue : currentTime) || 0)) : 0;

    const handleValueChange = useCallback((value: number[]) => {
        setIsSeeking(true);
        setSeekValue(value[0]);
    }, []);

    const handleValueCommit = useCallback((value: number[]) => {
        seek(value[0]);
        setIsSeeking(false);
    }, [seek]);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!canSeek) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setHoverTime(fraction * duration);
    }, [canSeek, duration]);

    return (
        <div
            className={cn('group relative w-full select-none', className)}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverTime(null)}
        >
            <Slider.Root
                className="relative flex items-center w-full h-6 cursor-pointer touch-none data-[disabled]:cursor-default"
                disabled={!canSeek}
                value={[displayTime]}
                max={canSeek ? duration : 1}
                step={0.1}
                onValueChange={handleValueChange}
                onValueCommit={handleValueCommit}
                onPointerCancel={() => setIsSeeking(false)}
            >
                <Slider.Track className="relative h-1.5 group-hover:h-2 transition-all w-full rounded-full bg-white/10 overflow-hidden">
                    <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-amber-500 via-amber-400 to-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.5)]" />
                </Slider.Track>
                <Slider.Thumb
                    aria-label="Playback position"
                    aria-valuetext={canSeek ? `${formatDuration(displayTime)} of ${formatDuration(duration)}` : 'Duration unavailable'}
                    className="block size-3.5 rounded-full bg-amber-100 ring-2 ring-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)] opacity-0 group-hover:opacity-100 motion-safe:transition-all focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
            </Slider.Root>

            {/* Time tooltip on hover */}
            {canSeek && hoverTime !== null && (
                <div
                    className="absolute -top-7 transform -translate-x-1/2 px-2 py-0.5 rounded bg-neutral-900/90 backdrop-blur-md border border-white/10 text-amber-200 text-[11px] font-mono pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-20"
                    style={{ left: `${(hoverTime / (duration || 1)) * 100}%` }}
                >
                    {formatDuration(hoverTime)}
                </div>
            )}
        </div>
    );
}
