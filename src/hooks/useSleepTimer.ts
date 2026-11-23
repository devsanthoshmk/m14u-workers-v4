import { usePlayerStore } from '@/stores/playerStore';

export function useSleepTimer() {
    const state = usePlayerStore(s => s.sleepTimer);
    const startTimer = usePlayerStore(s => s.startSleepTimer);
    const cancelTimer = usePlayerStore(s => s.cancelSleepTimer);
    return { state, startTimer, cancelTimer };
}
