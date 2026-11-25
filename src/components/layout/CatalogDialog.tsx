import { useEffect, useRef } from 'react';
import { useCatalogStore } from '@/stores/catalogStore';

const options = [
    { value: 'open-audio', label: 'Open Audio', description: 'Freely licensed music from independent artists and open collections. This is the default.' },
    { value: 'jiosaavn', label: 'JioSaavn', description: 'Search the JioSaavn catalog. This unofficial integration was built through reverse engineering and may stop working if JioSaavn changes its service.' },
] as const;

export function CatalogDialog() {
    const dialog = useCatalogStore(s => s.dialog);
    const provider = useCatalogStore(s => s.provider);
    const choose = useCatalogStore(s => s.choose);
    const close = useCatalogStore(s => s.closeDialog);
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const element = ref.current;
        if (dialog && element && !element.open) element.showModal();
        if (!dialog && element?.open) element.close();
    }, [dialog]);

    return (
        <dialog ref={ref} onCancel={event => { event.preventDefault(); close(); }} aria-labelledby="catalog-dialog-title"
            className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/65">
            <h2 id="catalog-dialog-title" className="font-heading text-xl font-bold">{dialog === 'intro' ? 'Welcome to M14U' : 'Settings'}</h2>
            {dialog === 'intro' && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">M14U is my personal project. I built it to show how a music app comes together, from search and playback to the website and Android app.</p>}
            <fieldset className="mt-5 space-y-2">
                <legend className="mb-2 text-sm font-semibold">Music catalog</legend>
                {options.map(({ value, label, description }) => (
                    <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${provider === value ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <input type="radio" name="music-catalog" value={value} checked={provider === value} onChange={() => choose(value)} className="mt-1 accent-primary" />
                        <span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{description}</span></span>
                    </label>
                ))}
            </fieldset>
            <p className="mt-4 text-sm text-muted-foreground">{dialog === 'intro' ? 'Choose here or change it later in Settings.' : 'Home and Favorites show the selected catalog. Your queue and current playback stay as they are.'}</p>
            <div className="mt-5 flex justify-end">
                <button type="button" onClick={close} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{dialog === 'intro' ? 'Continue' : 'Done'}</button>
            </div>
        </dialog>
    );
}
