import type { TrackItem } from '@/types/music';

export function trackArtworkUrls(track: TrackItem, targetWidth = Infinity): string[] {
    const thumbnails = [...(track.thumbnails ?? [])].sort((a, b) => {
        if (a.width >= targetWidth && b.width >= targetWidth) return a.width - b.width;
        return b.width - a.width;
    });
    return [...new Set([...thumbnails.map(image => image.url), track.img].filter((value): value is string => {
        if (!value) return false;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !/(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com|youtube\.com|youtu\.be)$/.test(url.hostname);
        } catch {
            return false;
        }
    }))];
}
