import type { TrackItem } from '@/types/music';

export function saavnTrackUrl(track: TrackItem): string | undefined {
    if (!track.shareUrl) return;
    try {
        const url = new URL(track.shareUrl);
        if (url.protocol === 'https:' && /^(www\.)?(jiosaavn|saavn)\.com$/.test(url.hostname) && !url.username && !url.password) {
            return url.href;
        }
    } catch {
        // Invalid catalog URLs fall back to an app search link.
    }
}

export function trackShareUrl(track: TrackItem, origin: string): string {
    return saavnTrackUrl(track) ?? new URL(`/search?${new URLSearchParams({
        q: [track.name || track.title, track.artist?.name || track.author].filter(Boolean).join(' '),
    })}`, origin).href;
}
