import type { TrackItem } from '@/types/music';

export function trackProviderUrl(track: TrackItem): string {
    return `https://youtu.be/${encodeURIComponent(track.videoId || track.id)}`;
}

export function trackShareUrl(track: TrackItem, _origin: string): string {
    void _origin;
    return trackProviderUrl(track);
}
