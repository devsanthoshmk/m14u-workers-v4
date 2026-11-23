import type { Song, TrackItem } from '@/types/music';
import { formatDuration } from './format';

export function toTrackItem(song: Song | TrackItem): TrackItem {
    if (song.type !== 'SONG') return song;
    return {
        ...song,
        type: 'song',
        id: song.videoId,
        title: song.name,
        author: song.artist.name,
        authorId: song.artist.artistId,
        albumId: song.album?.albumId,
        duration: formatDuration(song.duration),
        durationSec: song.duration,
    };
}

export function trackDurationSeconds(track: TrackItem): number | undefined {
    if (typeof track.duration === 'number') return track.duration;
    if (track.durationSec != null) return track.durationSec;
    // Catalog durations are display text; ignore subtext such as view counts.
    if (!/^\d+:[0-5]\d(?::[0-5]\d)?$/.test(track.duration)) return undefined;
    return track.duration.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
}
