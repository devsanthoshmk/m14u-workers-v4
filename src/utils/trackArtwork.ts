import type { TrackItem } from '@/types/music';
import { getThumbnail } from './format';

export function compactTrackArtworkUrls(track: TrackItem, size: number): string[] {
    return [...new Set([
        track.img,
        track.thumbnails && getThumbnail(track.thumbnails, size),
        ...trackArtworkUrls(track),
    ].filter((url): url is string => !!url))];
}

export function trackArtworkUrls(track: TrackItem): string[] {
    const thumbnails = [...(track.thumbnails ?? [])].sort((a, b) => b.width - a.width);
    const supplied = [track.img, ...thumbnails.map(image => image.url)]
        .filter((url): url is string => typeof url === 'string' && url.startsWith('https://'));
    const covers = supplied.flatMap(url => {
        const cover = url.replace(
            /^(https:\/\/(?:[^/]+\.)?(?:googleusercontent\.com|ggpht\.com)\/[^?]+)=w\d+-h\d+[^?]*$/,
            '$1=w800-h800',
        );
        return cover === url ? [] : [cover];
    });
    const id = track.videoId || track.id;
    const youtube = /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}` : '';
    return [...new Set([
        ...covers,
        ...thumbnails.filter(image => image.width >= 800 && image.url.startsWith('https://')).map(image => image.url),
        ...(youtube ? [`${youtube}/maxresdefault.jpg`, `${youtube}/sddefault.jpg`, `${youtube}/hqdefault.jpg`] : []),
        ...supplied,
    ])];
}
