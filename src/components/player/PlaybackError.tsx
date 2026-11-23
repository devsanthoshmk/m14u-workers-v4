import { usePlayerStore } from '@/stores/playerStore';

export function PlaybackError() {
    const error = usePlayerStore(s => s.error);
    const retry = usePlayerStore(s => s.retryPlayback);
    if (!error) return null;
    return (
        <div className="shrink-0 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
            <span role="alert">{error}</span>{' — '}
            <button type="button" className="min-h-9 font-semibold underline" onClick={() => void retry()}>Retry</button>
        </div>
    );
}
