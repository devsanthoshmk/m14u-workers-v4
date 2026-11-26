import { usePlayerStore } from '@/stores/playerStore';
import { isNative } from '@/lib/utils/platform';
import { MOBILE_APP_URL } from '@/utils/constants';

export function PlaybackError() {
    const error = usePlayerStore(s => s.error);
    const retry = usePlayerStore(s => s.retryPlayback);
    if (!error) return null;
    return (
        <div className="shrink-0 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
            <span role="alert">{error}</span>{' — '}
            <button type="button" className="min-h-9 font-semibold underline" onClick={() => void retry()}>Retry</button>
            {!isNative() && (
                <span className="mt-0.5 block text-xs text-foreground/85">
                    If you use the{' '}
                    <a
                        href={MOBILE_APP_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-primary underline underline-offset-2 hover:text-primary/90"
                    >
                        M14U mobile app
                    </a>
                    , you won’t get playback errors like this — it uses YouTube Music.
                </span>
            )}
        </div>
    );
}
