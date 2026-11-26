import { useEffect, useRef } from 'react';
import { useCatalogStore } from '@/stores/catalogStore';
import { useListeningPreferences } from '@/stores/listeningPreferences';
import { LanguageMultiSelect } from '@/components/ui/LanguageMultiSelect';
import { useUIStore } from '@/stores/uiStore';
import { isNative } from '@/lib/utils/platform';
import { getDiagnostics } from '@/services/homeDiscovery';
import { Languages, Activity, Disc3, Check, X } from 'lucide-react';

const catalogOptions = [
    {
        value: 'jiosaavn',
        label: 'JioSaavn',
        description: 'Search the JioSaavn catalog. This is the default. This unofficial integration was built through reverse engineering and may stop working if JioSaavn changes its service.',
    },
    {
        value: 'open-audio',
        label: 'Open Audio',
        description: 'Freely licensed music from independent artists and open collections.',
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
    const pointerStartedInsideRef = useRef(false);
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

        pointerStartedInsideRef.current = event.target !== dialogElement || isInside;
    };

    const handlePointerCancel = () => {
        pointerStartedInsideRef.current = false;
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

        if (event.target === dialogElement && isOutside && !pointerStartedInsideRef.current) {
            close();
        }
        pointerStartedInsideRef.current = false;
    };

    return (
        <dialog
            ref={ref}
            onCancel={(event) => {
                event.preventDefault();
                close();
            }}
            onPointerDown={handlePointerDown}
            onPointerCancel={handlePointerCancel}
            onClick={handleClick}
            aria-labelledby="catalog-dialog-title"
            className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 sm:p-6 text-foreground shadow-2xl backdrop:bg-black/65"
        >
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <h2 id="catalog-dialog-title" className="font-heading text-xl font-bold flex items-center gap-2">
                    {dialog === 'intro' ? 'Welcome to M14U' : 'Settings'}
                </h2>
                <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
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

            {dialog === 'intro' ? (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    Set up your listening preferences. You can always adjust these later from the Settings menu.
                </p>
            ) : null}

            {/* Language Preferences */}
            <section className="mt-5 space-y-2">
                <label htmlFor="listening-languages-select" className="flex items-center gap-2 text-sm font-semibold">
                    <Languages className="size-4 text-primary" />
                    Listening languages
                </label>
                <p className="text-xs text-muted-foreground">
                    Boosts matching songs within search results and personalized picks without altering exact matches.
                </p>
                <div className="mt-1">
                    <LanguageMultiSelect
                        id="listening-languages-select"
                        selected={languages}
                        onChange={setLanguages}
                    />
                </div>
            </section>

            {/* Catalog Preferences */}
            <section className="mt-6 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <Disc3 className="size-4 text-primary" />
                    Music catalog
                </div>

                {!native ? (
                    <fieldset className="space-y-2">
                        <legend className="sr-only">Choose music catalog</legend>
                        {catalogOptions.map(({ value, label, description }) => {
                            const isSelected = provider === value;
                            return (
                                <label
                                    key={value}
                                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                                        isSelected ? 'border-primary bg-primary/5' : 'border-border bg-surface/40 hover:bg-surface'
                                    }`}
                                >
                                    <input
                                        type="radio"
                                        name="music-catalog"
                                        value={value}
                                        checked={isSelected}
                                        onChange={() => choose(value)}
                                        className="mt-1 accent-primary"
                                    />
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-semibold text-foreground">{label}</span>
                                            {isSelected && (
                                                <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                                                    <Check className="size-3" /> Active
                                                </span>
                                            )}
                                        </div>
                                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                                            {description}
                                        </span>
                                    </div>
                                </label>
                            );
                        })}
                    </fieldset>
                ) : (
                    <div className="rounded-xl border border-border bg-surface/50 p-3.5 text-xs text-muted-foreground leading-relaxed">
                        <span className="font-semibold text-foreground block mb-1">YouTube Music (Native)</span>
                        Android connects directly to YouTube Music with native stream extraction and Media3 audio playback.
                    </div>
                )}

                <p className="text-xs text-muted-foreground">
                    {dialog === 'intro'
                        ? 'First-run setup retains your initial selections without losing saved tracks.'
                        : 'Home and Favorites show the selected catalog. Active playback and queue remain intact.'}
                </p>
            </section>

            {/* Diagnostics (shown in Settings dialog) */}
            {dialog === 'settings' && (
                <section className="mt-6 border-t border-border/60 pt-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Activity className="size-4 text-primary" />
                        Source & Resolver Diagnostics
                    </div>

                    <div className="rounded-xl border border-border bg-surface/30 p-3 space-y-2.5 text-xs">
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-2">
                            <span className="text-muted-foreground sm:shrink-0">Platform</span>
                            <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-words [overflow-wrap:anywhere]">{diagnostics.platform}</span>
                        </div>
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-2">
                            <span className="text-muted-foreground sm:shrink-0">Catalog source</span>
                            <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-all [overflow-wrap:anywhere]">{diagnostics.catalogSourceUrl}</span>
                        </div>
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-2">
                            <span className="text-muted-foreground sm:shrink-0">Primary stream resolver</span>
                            <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-words [overflow-wrap:anywhere]">{diagnostics.streamPrimary}</span>
                        </div>
                        {native && (
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-2">
                                <span className="text-muted-foreground sm:shrink-0">Live resolver</span>
                                <span className="min-w-0 font-mono text-foreground text-left sm:text-right break-words [overflow-wrap:anywhere]">{diagnostics.liveResolverStatus}</span>
                            </div>
                        )}
                        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4 border-b border-white/[0.04] pb-2">
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
                </section>
            )}

            <div className="mt-6 flex justify-end gap-3 pt-2">
                <button
                    type="button"
                    onClick={dialog === 'intro' ? handleContinue : close}
                    className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                >
                    {dialog === 'intro' ? 'Continue to M14U' : 'Done'}
                </button>
            </div>
        </dialog>
    );
}
