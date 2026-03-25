/**
 * Sleep Timer — Dropdown for setting auto-pause timer.
 *
 * Psychology: Clock icon with countdown badge.
 * Pre-set durations reduce decision fatigue vs custom input.
 */

import { Moon, Timer, X } from 'lucide-react';
import { useSleepTimer } from '@/hooks/useSleepTimer';
import { formatDuration } from '@/utils/format';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

const PRESETS = [
    { label: '15 minutes', value: 15 },
    { label: '30 minutes', value: 30 },
    { label: '45 minutes', value: 45 },
    { label: '1 hour', value: 60 },
    { label: 'End of song', value: 'end_of_song' as const },
];

export function SleepTimerButton() {
    const { startTimer, cancelTimer, state } = useSleepTimer();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen]);

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    'p-2 rounded-full transition-all hover:bg-surface-hover relative',
                    state.isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
                title="Sleep timer"
            >
                <Moon className="h-4 w-4" />
                {state.isActive && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground px-1">
                        {Math.ceil(state.remainingSeconds / 60)}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-56 rounded-xl bg-popover border border-border shadow-xl p-2 animate-slide-up z-50">
                    <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Sleep Timer
                    </div>

                    {state.isActive ? (
                        <div className="p-3 space-y-3">
                            <div className="text-center">
                                <p className="text-2xl font-bold font-heading text-foreground tabular-nums">
                                    {formatDuration(state.remainingSeconds)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">remaining</p>
                            </div>
                            <button
                                onClick={() => {
                                    cancelTimer();
                                    setIsOpen(false);
                                }}
                                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors text-sm font-medium"
                            >
                                <X className="h-4 w-4" />
                                Cancel timer
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {PRESETS.map((preset) => (
                                <button
                                    key={preset.label}
                                    onClick={() => {
                                        startTimer(preset.value);
                                        setIsOpen(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-surface-hover transition-colors text-left"
                                >
                                    <Timer className="h-4 w-4 text-muted-foreground" />
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
