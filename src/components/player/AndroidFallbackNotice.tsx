import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Sparkles, X } from 'lucide-react';
import { isNative } from '@/lib/utils/platform';
import { useSaavnFallbackStore } from '@/services/saavnFallback';
import { cn } from '@/lib/utils';

const TRACK_NOTICE_TIMEOUT_MS = 5000;
const RESTORED_NOTICE_TIMEOUT_MS = 4500;

export interface AndroidFallbackNoticeProps {
    variant?: 'all' | 'banner' | 'toast';
    isNowPlaying?: boolean;
}

export function AndroidFallbackNotice({ variant = 'all', isNowPlaying = false }: AndroidFallbackNoticeProps) {
    const mode = useSaavnFallbackStore(s => s.mode);
    const activeTrackNotice = useSaavnFallbackStore(s => s.activeTrackNotice);
    const sessionBannerVisible = useSaavnFallbackStore(s => s.sessionBannerVisible);
    const sessionRestoredNotice = useSaavnFallbackStore(s => s.sessionRestoredNotice);
    const probing = useSaavnFallbackStore(s => s.probing);
    const setEnabled = useSaavnFallbackStore(s => s.setEnabled);
    const retryYouTube = useSaavnFallbackStore(s => s.retryYouTube);
    const dismissTrackNotice = useSaavnFallbackStore(s => s.dismissTrackNotice);
    const dismissSessionBanner = useSaavnFallbackStore(s => s.dismissSessionBanner);
    const dismissRestoredNotice = useSaavnFallbackStore(s => s.dismissRestoredNotice);

    const native = isNative();
    const showBanner = variant !== 'toast';
    const showToast = variant !== 'banner';

    const activeTrackNoticeId = activeTrackNotice?.id;
    useEffect(() => {
        if (!native || !showToast || activeTrackNoticeId === undefined) return;
        const timer = setTimeout(() => {
            dismissTrackNotice();
        }, TRACK_NOTICE_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [native, showToast, activeTrackNoticeId, dismissTrackNotice]);

    useEffect(() => {
        if (!native || !showToast || !sessionRestoredNotice) return;
        const timer = setTimeout(() => {
            dismissRestoredNotice();
        }, RESTORED_NOTICE_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [native, showToast, sessionRestoredNotice, dismissRestoredNotice]);

    if (!native) return null;

    const hasBanner = showBanner && mode === 'jiosaavn-fallback' && sessionBannerVisible;
    const hasToast = showToast && Boolean(activeTrackNotice || sessionRestoredNotice);

    if (!hasBanner && !hasToast) return null;

    return (
        <>
            {hasBanner && (
                <div
                    role="region"
                    aria-label="YouTube playback fallback status"
                    data-testid="android-fallback-banner"
                    className="shrink-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/20 bg-surface/90 px-3 py-2 text-xs text-foreground backdrop-blur-md"
                >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <AlertCircle className="size-4 shrink-0 text-amber-400" aria-hidden="true" />
                        <p className="min-w-0 leading-snug text-foreground/95">
                            YouTube playback is temporarily unavailable — using JioSaavn for now
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => void retryYouTube()}
                            disabled={probing}
                            aria-busy={probing}
                            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-amber-400/15 px-2.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-400/30 transition-colors hover:bg-amber-400/25 disabled:opacity-60"
                        >
                            <RefreshCw className={cn('size-3 shrink-0', probing && 'animate-spin')} aria-hidden="true" />
                            <span>{probing ? 'Checking…' : 'Retry YouTube'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setEnabled(false)}
                            className="inline-flex h-7 items-center rounded-lg border border-border bg-surface-hover/80 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                            YouTube only
                        </button>
                        <button
                            type="button"
                            onClick={dismissSessionBanner}
                            aria-label="Dismiss YouTube outage banner"
                            title="Dismiss"
                            className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                        >
                            <X className="size-3.5" aria-hidden="true" />
                        </button>
                    </div>
                </div>
            )}

            {hasToast && (
                <div
                    className={cn(
                        'pointer-events-none absolute inset-x-0 z-40 flex flex-col items-center gap-2 px-3',
                        isNowPlaying ? 'top-14 sm:top-16' : 'bottom-3'
                    )}
                >
                    {activeTrackNotice && (
                        <div
                            role="status"
                            aria-live="polite"
                            data-testid="android-fallback-track-notice"
                            className={cn(
                                'pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-amber-400/25 bg-surface/95 px-3 py-2 text-xs text-foreground shadow-[0_8px_28px_rgba(0,0,0,0.65)] backdrop-blur-xl',
                                isNowPlaying ? 'animate-slide-down' : 'animate-slide-up'
                            )}
                        >
                            <Sparkles className="size-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                            <p className="min-w-0 flex-1 line-clamp-2 leading-snug">
                                <span className="text-muted-foreground">YouTube unavailable — playing JioSaavn match: </span>
                                <span className="font-medium text-foreground">{activeTrackNotice.matchedTitle}</span>
                            </p>
                            <button
                                type="button"
                                onClick={dismissTrackNotice}
                                aria-label="Dismiss fallback match notice"
                                title="Dismiss"
                                className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                            >
                                <X className="size-3.5" aria-hidden="true" />
                            </button>
                        </div>
                    )}

                    {sessionRestoredNotice && (
                        <div
                            role="status"
                            aria-live="polite"
                            data-testid="android-fallback-restored-notice"
                            className={cn(
                                'pointer-events-auto flex w-auto max-w-md items-center gap-2 rounded-full border border-emerald-500/30 bg-surface/95 px-3.5 py-2 text-xs font-medium text-foreground shadow-[0_8px_28px_rgba(0,0,0,0.65)] backdrop-blur-xl',
                                isNowPlaying ? 'animate-slide-down' : 'animate-slide-up'
                            )}
                        >
                            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                            <span>{sessionRestoredNotice}</span>
                            <button
                                type="button"
                                onClick={dismissRestoredNotice}
                                aria-label="Dismiss restored notice"
                                title="Dismiss"
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                            >
                                <X className="size-3" aria-hidden="true" />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
