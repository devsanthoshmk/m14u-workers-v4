import type { TrackItem } from '@/types/music';

export function trackProviderUrl(track: TrackItem): string {
    if (track.sourceUrl?.startsWith('https://')) return track.sourceUrl;
    const archive = /^archive:([\w.-]+):/.exec(track.id);
    if (archive) return `https://archive.org/details/${archive[1]}`;
    return `https://youtu.be/${encodeURIComponent(track.videoId || track.id)}`;
}

export function trackShareUrl(track: TrackItem, _origin: string): string {
    void _origin;
    return trackProviderUrl(track);
}
