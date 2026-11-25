import { useState } from 'react';

// Muted tints for the charcoal surfaces, with small shifts from the amber mark.
const artworkPalette = [
    { tint: 'hsl(var(--primary))', shift: 0 }, // amber
    { tint: '#ab6248', shift: -16 }, // copper
    { tint: '#756c9a', shift: 230 }, // slate violet
    { tint: '#518184', shift: 147 }, // muted teal
    { tint: '#9b596f', shift: -55 }, // dusty rose
    { tint: '#8a8552', shift: 24 }, // antique gold
];

export function TrackArtworkFallback({ seed, className = '' }: { seed: string; className?: string }) {
    let hash = 2166136261;
    for (const char of seed) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    const { tint, shift } = artworkPalette[(hash >>> 0) % artworkPalette.length];
    return (
        <div aria-hidden="true" className={`grid place-items-center ${className}`}
            style={{ background: `linear-gradient(145deg, color-mix(in srgb, ${tint} 32%, hsl(var(--surface))), hsl(var(--background)))` }}>
            <img src={`${import.meta.env.BASE_URL}branding/mark.svg`} alt="" className="size-[64%] object-contain"
                style={{ filter: shift === 0 ? undefined : `hue-rotate(${shift}deg) saturate(.68)` }} />
        </div>
    );
}

export function TrackArtwork({ seed, sources, className, lazy }: {
    seed: string; sources: string[]; className: string; lazy?: boolean;
}) {
    const [failure, setFailure] = useState({ key: '', index: 0 });
    const key = JSON.stringify([seed, sources]);
    const index = failure.key === key ? failure.index : 0;
    const src = sources[index];
    return src ? <img key={src} src={src} alt="" className={className} loading={lazy ? 'lazy' : undefined}
        onError={() => setFailure({ key, index: index + 1 })} />
        : <TrackArtworkFallback seed={seed} className={className} />;
}
