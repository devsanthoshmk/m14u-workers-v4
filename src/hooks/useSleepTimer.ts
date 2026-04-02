/**
 * Sleep Timer hook.
 * Manages countdown and fade-out for the sleep timer feature.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlayerStore } from '@/stores/playerStore';

interface SleepTimerState {
    isActive: boolean;
    remainingSeconds: number;
    totalSeconds: number;
    preset: number | 'end_of_song' | null;
}

interface SleepTimerActions {
    startTimer: (minutes: number | 'end_of_song') => void;
    cancelTimer: () => void;
    state: SleepTimerState;
}

export function useSleepTimer(): SleepTimerActions {
    const [timerState, setTimerState] = useState<SleepTimerState>({
        isActive: false,
        remainingSeconds: 0,
        totalSeconds: 0,
        preset: null,
    });

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const originalVolumeRef = useRef<number>(0.7);

    const volume = usePlayerStore(s => s.volume);
    const duration = usePlayerStore(s => s.duration);
    const currentTime = usePlayerStore(s => s.currentTime);

    const cancelTimer = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        // Restore original volume
        if (timerState.isActive) {
            usePlayerStore.getState().setVolume(originalVolumeRef.current);
        }

        setTimerState({
            isActive: false,
            remainingSeconds: 0,
            totalSeconds: 0,
            preset: null,
        });
    }, [timerState.isActive]);

    const startTimer = useCallback((preset: number | 'end_of_song') => {
        cancelTimer();
        originalVolumeRef.current = volume;

        if (preset === 'end_of_song') {
            setTimerState({
                isActive: true,
                remainingSeconds: Math.ceil(duration - currentTime),
                totalSeconds: Math.ceil(duration - currentTime),
                preset: 'end_of_song',
            });
        } else {
            const totalSeconds = preset * 60;
            setTimerState({
                isActive: true,
                remainingSeconds: totalSeconds,
                totalSeconds,
                preset,
            });
        }
    }, [cancelTimer, volume, duration, currentTime]);

    // Countdown tick
    useEffect(() => {
        if (!timerState.isActive) return;

        intervalRef.current = setInterval(() => {
            setTimerState(prev => {
                const remaining = prev.remainingSeconds - 1;

                if (remaining <= 0) {
                    // Time's up — pause
                    usePlayerStore.getState().pause();
                    usePlayerStore.getState()._setIsPlaying(false);
                    // Restore volume
                    usePlayerStore.getState().setVolume(originalVolumeRef.current);

                    if (intervalRef.current) clearInterval(intervalRef.current);
                    return { ...prev, isActive: false, remainingSeconds: 0 };
                }

                // Fade out volume in last 30 seconds
                if (remaining <= 30) {
                    const fadeRatio = remaining / 30;
                    const fadedVolume = originalVolumeRef.current * fadeRatio;
                    usePlayerStore.getState().setVolume(fadedVolume);
                }

                return { ...prev, remainingSeconds: remaining };
            });
        }, 1000);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [timerState.isActive]);

    // Handle "end of song" preset — update remaining when currentTime changes
    useEffect(() => {
        if (timerState.preset === 'end_of_song' && timerState.isActive) {
            const remaining = Math.max(0, Math.ceil(duration - currentTime));
            setTimerState(prev => ({
                ...prev,
                remainingSeconds: remaining,
            }));
        }
    }, [currentTime, duration, timerState.preset, timerState.isActive]);

    return {
        startTimer,
        cancelTimer,
        state: timerState,
    };
}
