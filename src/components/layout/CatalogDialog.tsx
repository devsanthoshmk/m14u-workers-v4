import { useEffect, useRef } from 'react';
import { useCatalogStore } from '@/stores/catalogStore';
import { useListeningPreferences } from '@/stores/listeningPreferences';
import { LanguageMultiSelect } from '@/components/ui/LanguageMultiSelect';
import { useUIStore } from '@/stores/uiStore';
import { isNative } from '@/lib/utils/platform';
import { getDiagnostics } from '@/services/homeDiscovery';
import { Languages, Activity, Disc3, X, ChevronDown } from 'lucide-react';
import { MobileAppPromo } from '@/components/MobileAppPromo';

const LANGUAGE_PICKER_ID = 'listening-languages-select';

const catalogOptions = [
    {
        value: 'jiosaavn',
        label: 'JioSaavn',
        badge: 'Default',
        description: 'Mainstream library · Unofficial, streams may break.',
    },
    {
        value: 'open-audio',
        label: 'Open Audio',
        badge: null,
        description: 'Freely licensed indie tracks · Reliable playback, small library.',
    },
] as const;

export function CatalogDialog() {
    const dialog = useCatalogStore(s => s.dialog);
    const provider = useCatalogStore(s => s.provider);
    const choose = useCatalogStore(s => s.choose);
    const close = useCatalogStore(s => s.closeDialog);

    const languages = useListeningPreferences(s => s.languages);
    const setLanguages = useListeningPreferences(s => s.setLanguages);
    const completeSetup = useListeningPreferences(s => s.completeSetup);
    const setOnboardingDone = useUIStore(s => s.setOnboardingDone);

    const ref = useRef<HTMLDialogElement>(null);
    const ignoreBackdropClickRef = useRef(false);
    const native = isNative();
    const diagnostics = getDiagnostics(provider);

    useEffect(() => {
        const element = ref.current;
        if (dialog && element && !element.open) element.showModal();
        if (!dialog && element?.open) element.close();
    }, [dialog]);

    const handleContinue = () => {
        completeSetup();
        setOnboardingDone();
        close();
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDialogElement>) => {
        const dialogElement = ref.current;
        if (!dialogElement) return;
        const rect = dialogElement.getBoundingClientRect();
        const isInside =
            event.clientX >= rect.left &&
            event.clientX <= rect.right &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom;

        // Remember if this press is dismissing the picker before the click arrives.
        const pickerWasOpen = dialogElement.querySelector(
            `#${LANGUAGE_PICKER_ID}[aria-expanded="true"]`
        ) !== null;
        ignoreBackdropClickRef.current = event.target !== dialogElement || isInside || pickerWasOpen;
    };

    const handlePointerCancel = () => {
        ignoreBackdropClickRef.current = false;
    };

    const handleClick = (event: React.MouseEvent<HTMLDialogElement>) => {
        const dialogElement = ref.current;
        if (!dialogElement) return;
        const rect = dialogElement.getBoundingClientRect();
        const isOutside =
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom;

        if (event.target === dialogElement && isOutside && !ignoreBackdropClickRef.current) {
            close();
        }
        ignoreBackdropClickRef.current = false;
    };

    return (
        <dialog
            ref={ref}
            onCancel={(event) => {
                event.preventDefault();
                close();
            }}
            onPointerDownCapture={handlePointerDown}
            onPointerCancel={handlePointerCancel}
            onClick={handleClick}
            aria-labelledby="catalog-dialog-title"
            className="mx-auto mt-4 mb-auto sm:mt-[min(12dvh,5rem)] max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-6rem)] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto [scrollbar-gutter:stable_both-edges] rounded-2xl border border-border bg-card p-3.5 sm:p-5 text-foreground shadow-2xl backdrop:bg-black/65"
        >
            <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                <h2 id="catalog-dialog-title" className="font-heading text-lg sm:text-xl font-bold flex items-center gap-2">
                    {dialog === 'intro' ? 'Welcome to M14U' : 'Settings'}
                </h2>
                <div className="flex items-center gap-1.5">
                    <span className="text-[11px] px-2 py-0.5 rounded-full border border-border/70 bg-surface/60 text-muted-foreground font-medium">
                        {native ? 'Android App' : 'Web Player'}
                    </span>
                    <button
                        type="button"
                        onClick={close}
                        title="Close"
                        aria-label="Close"
                        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <X className="size-4" aria-hidden="true" />
                    </button>
                </div>
            </div>

            {/* Listening Languages Dropdown */}
            <section className="mt-3.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                    <label htmlFor={LANGUAGE_PICKER_ID} className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold">
                        <Languages className="size-3.5 sm:size-4 text-muted-foreground" />
                        Listening languages
                    </label>
                    <span className="text-[11px] text-muted-foreground">Boosts matching songs</span>
                </div>
                <LanguageMultiSelect
                    id={LANGUAGE_PICKER_ID}
                    selected={languages}
                    onChange={setLanguages}
                    compact
                />
            </section>

            {/* Catalog Preferences */}
            <section className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold">
                        <Disc3 className="size-3.5 sm:size-4 text-muted-foreground" />
                        Music catalog
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                        {dialog === 'intro' ? 'Default: JioSaavn' : 'Keeps active queue'}
                    </span>
                </div>

                {!native ? (
                    <fieldset className="space-y-2">
                        <legend className="sr-only">Choose music catalog</legend>
                        {catalogOptions.map(({ value, label, badge, description }) => {
                            const isSelected = provider === value;
                            return (
                                <label
                                    key={value}
                                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                                        isSelected
                                            ? 'border-primary/70 bg-primary/[0.06]'
                                            : 'border-border/70 bg-surface/30 hover:bg-surface/60'
                                    }`}
                                >
                                    <input
                                        type="radio"
                                        name="music-catalog"
                                        value={value}
                                        checked={isSelected}
                                        onChange={() => choose(value)}
                                        className="sr-only"
                                    />
                                    <span
                                        aria-hidden="true"
                                        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                                            isSelected
                                                ? 'border-primary bg-primary/15'
                                                : 'border-muted-foreground/40 bg-transparent'
                                        }`}
                                    >
                                        {isSelected && <span className="size-2 rounded-full bg-primary" />}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs sm:text-sm font-semibold text-foreground">{label}</span>
                                            {badge && (
                                                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface text-muted-foreground">
                                                    {badge}
                                                </span>
                                            )}
                                        </div>
                                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                                            {description}
                                        </span>
                                    </div>
                                </label>
                            );
                        })}
                    </fieldset>
                ) : (
                    <div className="rounded-xl border border-border bg-surface/50 p-3 text-xs text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground block mb-0.5">YouTube Music (Native)</span>
                        Android connects directly to YouTube Music with native stream extraction and Media3 audio playback.
                    </div>
                )}
            </section>

            {/* Mobile App Promotion — secondary below the settings controls */}
            {!native && (
                <div className="mt-3.5">
                    <MobileAppPromo
                        variant="compact"
                        ctaLabel="Get App"
                        title="No catalog limits on the M14U Mobile App"
                        description="Uses YouTube Music directly — skip limited libraries & broken web streams."
                    />
                </div>
            )}

            {/* Collapsible Diagnostics (shown in Settings dialog without forcing scroll) */}
            {dialog === 'settings' && (
                <details className="group mt-3 rounded-xl border border-border/70 bg-surface/30">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors select-none">
                        <span className="flex items-center gap-1.5">
                            <Activity className="size-3.5 text-muted-foreground" />
                            Source & Resolver Diagnostics
                        </span>
                        <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>

                    <div className="border-t border-border/50 px-3 py-2.5 space-y-2 text-[11px]">
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-1.5">
                            <span className="text-muted-foreground sm:shrink-0">Platform</span>
                            <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-words [overflow-wrap:anywhere]">{diagnostics.platform}</span>
                        </div>
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-1.5">
                            <span className="text-muted-foreground sm:shrink-0">Catalog source</span>
                            <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-all [overflow-wrap:anywhere]">{diagnostics.catalogSourceUrl}</span>
                        </div>
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-1.5">
                            <span className="text-muted-foreground sm:shrink-0">Primary stream resolver</span>
                            <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-words [overflow-wrap:anywhere]">{diagnostics.streamPrimary}</span>
                        </div>
                        {native && (
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-1.5">
                                <span className="text-muted-foreground sm:shrink-0">Live resolver</span>
                                <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-words [overflow-wrap:anywhere]">{diagnostics.liveResolverStatus}</span>
                            </div>
                        )}
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-1.5">
                            <span className="text-muted-foreground sm:shrink-0">Fallback proxy</span>
                            <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-all [overflow-wrap:anywhere]" title={diagnostics.invidiousProxy}>
                                {diagnostics.invidiousProxy}
                            </span>
                        </div>
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <span className="text-muted-foreground sm:shrink-0">Audio engine</span>
                            <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-words [overflow-wrap:anywhere]">{diagnostics.audioEngine}</span>
                        </div>
                    </div>
                </details>
            )}

            <div className="mt-3.5 flex justify-end">
                <button
                    type="button"
                    onClick={dialog === 'intro' ? handleContinue : close}
                    className="h-10 w-full sm:w-auto rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                >
                    {dialog === 'intro' ? 'Continue to M14U' : 'Done'}
                </button>
            </div>
        </dialog>
    );
}
