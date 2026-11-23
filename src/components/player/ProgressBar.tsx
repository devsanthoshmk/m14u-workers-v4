/**
 * ProgressBar — Seekable audio progress slider.
 * Uses Radix Slider for full accessibility and keyboard support.
 *
 * Psychology:
 * - Thin at rest, expands on hover → clean but inviting interaction
 * - Hovering shows time tooltip → user knows exactly where they'll land
 */

import * as Slider from '@radix-ui/react-slider';
import { usePlayerStore } from '@/stores/playerStore';
import { formatDuration } from '@/utils/format';
import { useState, useCallback } from 'react';

export function ProgressBar() {
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
            className="group relative w-full"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverTime(null)}
        >
            <Slider.Root
                className="relative flex items-center w-full h-7 cursor-pointer select-none touch-none data-[disabled]:cursor-default"
                disabled={!canSeek}
                value={[displayTime]}
                max={canSeek ? duration : 1}
                step={0.1}
                onValueChange={handleValueChange}
                onValueCommit={handleValueCommit}
                onPointerCancel={() => setIsSeeking(false)}
            >
                <Slider.Track className="relative h-1 group-hover:h-1.5 transition-all w-full rounded-full bg-muted overflow-hidden">
                    <Slider.Range className="absolute h-full rounded-full bg-primary" />
                </Slider.Track>
                <Slider.Thumb aria-label="Playback position" aria-valuetext={canSeek ? `${formatDuration(displayTime)} of ${formatDuration(duration)}` : 'Duration unavailable'} className="block h-3 w-3 rounded-full bg-foreground opacity-0 group-hover:opacity-100 motion-safe:transition-opacity shadow-md focus:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
            </Slider.Root>

            {/* Time tooltip on hover */}
            {canSeek && hoverTime !== null && (
                <div
                    className="absolute -top-8 transform -translate-x-1/2 px-2 py-1 rounded bg-popover text-popover-foreground text-[11px] font-mono pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `${(hoverTime / (duration || 1)) * 100}%` }}
                >
                    {formatDuration(hoverTime)}
                </div>
            )}
        </div>
    );
}
