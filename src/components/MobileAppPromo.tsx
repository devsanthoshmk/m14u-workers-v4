import { useEffect, useState } from 'react';
import { Smartphone, ExternalLink, X } from 'lucide-react';
import { isNative } from '@/lib/utils/platform';
import { MOBILE_APP_URL } from '@/utils/constants';
import { cn } from '@/lib/utils';

const SESSION_DISMISS_KEY = 'm14u-mobile-promo-dismissed';
const DEFAULT_DAILY_KEY = 'm14u-mobile-promo-daily';

interface DailyPromoRecord {
    day: string;
    startedAt: number;
    closed?: boolean;
}

function localDayKey(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function readDailyRecord(key: string): DailyPromoRecord | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<DailyPromoRecord>;
        if (typeof parsed.day === 'string' && typeof parsed.startedAt === 'number') {
            return {
                day: parsed.day,
                startedAt: parsed.startedAt,
                closed: Boolean(parsed.closed),
            };
        }
        return null;
    } catch {
        return null;
    }
}

function writeDailyRecord(key: string, record: DailyPromoRecord): void {
    try {
        localStorage.setItem(key, JSON.stringify(record));
    } catch {
        // Keep visibility state in memory if storage is unavailable.
    }
}

function isDismissedInSession(): boolean {
    try {
        return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
    } catch {
        return false;
    }
}

function saveDismissedInSession(): void {
    try {
        sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    } catch {
        // Keep dismissed in component state for this render lifecycle.
    }
}

function getInitialDailyState(dailyKey: string, autoHideMs: number): { visible: boolean; remainingMs: number } {
    const today = localDayKey();
    const now = Date.now();
    const existing = readDailyRecord(dailyKey);

    if (existing && existing.day === today) {
        if (existing.closed) {
            return { visible: false, remainingMs: 0 };
        }
        const elapsed = Math.max(0, now - existing.startedAt);
        const remainingMs = autoHideMs - elapsed;
        if (remainingMs <= 0) {
            writeDailyRecord(dailyKey, { ...existing, closed: true });
            return { visible: false, remainingMs: 0 };
        }
        return { visible: true, remainingMs };
    }

    writeDailyRecord(dailyKey, { day: today, startedAt: now, closed: false });
    return { visible: true, remainingMs: autoHideMs };
}

interface MobileAppPromoProps {
    variant?: 'card' | 'compact' | 'inline' | 'sidebar' | 'strip';
    title?: string;
    description?: string;
    ctaLabel?: string;
    dismissible?: boolean;
    oncePerDay?: boolean;
    autoHideMs?: number;
    dailyKey?: string;
    className?: string;
}

const DEFAULT_TITLE = 'Try the M14U Mobile App';
const DEFAULT_DESCRIPTION =
    'If you use the M14U mobile app, you won’t get any of these catalog or playback problems — the mobile app uses YouTube Music directly.';

export function MobileAppPromo({
    variant = 'card',
    title = DEFAULT_TITLE,
    description = DEFAULT_DESCRIPTION,
    ctaLabel = 'Get Mobile App',
    dismissible = false,
    oncePerDay = false,
    autoHideMs = 90_000,
    dailyKey = DEFAULT_DAILY_KEY,
    className,
}: MobileAppPromoProps) {
    const [dailyState] = useState(() =>
        !isNative() && oncePerDay
            ? getInitialDailyState(dailyKey, autoHideMs)
            : { visible: true, remainingMs: autoHideMs }
    );

    const [dismissed, setDismissed] = useState(() => {
        if (oncePerDay) return !dailyState.visible;
        if (dismissible) return isDismissedInSession();
        return false;
    });

    useEffect(() => {
        if (isNative() || !oncePerDay || dismissed) return;
        const timeoutMs = Math.max(0, dailyState.remainingMs);
        const timer = window.setTimeout(() => {
            const today = localDayKey();
            const existing = readDailyRecord(dailyKey);
            writeDailyRecord(dailyKey, {
                day: today,
                startedAt: existing?.day === today ? existing.startedAt : Date.now(),
                closed: true,
            });
            setDismissed(true);
        }, timeoutMs);
        return () => window.clearTimeout(timer);
    }, [oncePerDay, dismissed, dailyState.remainingMs, dailyKey]);

    if (isNative() || dismissed) return null;

    const handleDismiss = () => {
        if (oncePerDay) {
            const today = localDayKey();
            const existing = readDailyRecord(dailyKey);
            writeDailyRecord(dailyKey, {
                day: today,
                startedAt: existing?.day === today ? existing.startedAt : Date.now(),
                closed: true,
            });
        } else {
            saveDismissedInSession();
        }
        setDismissed(true);
    };

    if (variant === 'strip') {
        return (
            <div
                className={cn(
                    'flex items-center justify-between gap-2 border-b border-border/60 bg-surface/70 px-3 py-1.5 text-xs text-muted-foreground',
                    className
                )}
            >
                <div className="flex min-w-0 items-center gap-2">
                    <Smartphone className="size-3.5 shrink-0 text-primary/80" aria-hidden="true" />
                    <p className="truncate">
                        <span className="hidden sm:inline">Want YouTube Music with no catalog limits? </span>
                        <span className="sm:hidden">Mobile app uses YouTube Music — no limits. </span>
                        <a
                            href={MOBILE_APP_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-primary/60 underline-offset-2 hover:text-primary"
                        >
                            {ctaLabel}
                            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                        </a>
                    </p>
                </div>
                {dismissible && (
                    <button
                        type="button"
                        onClick={handleDismiss}
                        aria-label="Dismiss mobile app notice"
                        title="Dismiss"
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
                    >
                        <X className="size-3.5" aria-hidden="true" />
                    </button>
                )}
            </div>
        );
    }

    if (variant === 'compact') {
        return (
            <div
                className={cn(
                    'flex items-center justify-between gap-2.5 rounded-xl border border-border bg-surface/60 px-3 py-2',
                    className
                )}
            >
                <div className="flex min-w-0 items-start gap-2">
                    <Smartphone className="mt-0.5 size-4 shrink-0 text-primary/85" aria-hidden="true" />
                    <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground leading-tight">{title}</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
                    </div>
                </div>
                <a
                    href={MOBILE_APP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-hover px-2.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                    <span>{ctaLabel}</span>
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
            </div>
        );
    }

    if (variant === 'inline') {
        return (
            <p className={cn('text-xs leading-relaxed text-muted-foreground', className)}>
                {description}{' '}
                <a
                    href={MOBILE_APP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-primary/60 underline-offset-2 hover:text-primary"
                >
                    {ctaLabel}
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
            </p>
        );
    }

    if (variant === 'sidebar') {
        return (
            <a
                href={MOBILE_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                    'group block rounded-xl border border-border/60 bg-surface/40 p-2.5 text-left transition-colors hover:border-border hover:bg-surface/70',
                    className
                )}
            >
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <Smartphone className="size-3.5 shrink-0 text-primary/80" aria-hidden="true" />
                    <span className="truncate">{title}</span>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    Uses YouTube Music — no catalog limits.
                </p>
                <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary/90 group-hover:underline">
                    {ctaLabel}
                    <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </span>
            </a>
        );
    }

    return (
        <div
            className={cn(
                'rounded-xl border border-border/70 bg-surface/50 p-3 sm:p-3.5',
                className
            )}
        >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5 min-w-0">
                    <Smartphone className="mt-0.5 size-4 shrink-0 text-primary/80" aria-hidden="true" />
                    <div className="min-w-0 space-y-0.5">
                        <p className="text-xs sm:text-sm font-medium text-foreground">{title}</p>
                        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                    <a
                        href={MOBILE_APP_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-hover px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                    >
                        <span>{ctaLabel}</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                    {dismissible && (
                        <button
                            type="button"
                            onClick={handleDismiss}
                            aria-label="Dismiss mobile app notice"
                            title="Dismiss"
                            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
                        >
                            <X className="size-3.5" aria-hidden="true" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
