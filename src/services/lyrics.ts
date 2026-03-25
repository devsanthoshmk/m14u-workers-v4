/**
 * LRCLIB Lyrics Service.
 * Fetches time-synced and plain lyrics from lrclib.net.
 * Docs: https://lrclib.net/docs
 */

import { LRCLIB_BASE_URL } from '@/utils/constants';
import type { LyricLine, LRCLibResponse, LyricsData } from '@/types/lyrics';

/**
 * Parses LRC format string into structured LyricLine array.
 * LRC format: [mm:ss.xx] text
 * @example parseLRC("[00:12.34] Hello world\n[00:15.00] Second line")
 */
export function parseLRC(lrcString: string): LyricLine[] {
    if (!lrcString) return [];

    const lines: LyricLine[] = [];
    const lineRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/;

    for (const rawLine of lrcString.split('\n')) {
        const match = rawLine.trim().match(lineRegex);
        if (!match) continue;

        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const centiseconds = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
        const time = minutes * 60 + seconds + centiseconds / 1000;
        const text = match[4].trim();

        // Skip empty lines and metadata tags
        if (text) {
            lines.push({ time, text });
        }
    }

    return lines.sort((a, b) => a.time - b.time);
}

/**
 * Fetch lyrics for a track using exact match (best quality).
 * Uses /api/get which requires track_name, artist_name, album_name, duration.
 */
export async function getLyrics(
    trackName: string,
    artistName: string,
    albumName?: string,
    duration?: number | null
): Promise<LyricsData> {
    try {
        const params = new URLSearchParams({
            track_name: trackName,
            artist_name: artistName,
        });

        if (albumName) params.set('album_name', albumName);
        if (duration) params.set('duration', String(Math.round(duration)));

        const res = await fetch(`${LRCLIB_BASE_URL}/api/get?${params.toString()}`);

        if (!res.ok) {
            // If exact match fails, try search
            return searchAndGetLyrics(trackName, artistName);
        }

        const data: LRCLibResponse = await res.json();
        return transformResponse(data);
    } catch {
        // Fallback to search
        return searchAndGetLyrics(trackName, artistName);
    }
}

/**
 * Fallback: search LRCLIB for lyrics when exact match fails.
 */
async function searchAndGetLyrics(trackName: string, artistName: string): Promise<LyricsData> {
    try {
        const query = `${trackName} ${artistName}`;
        const res = await fetch(
            `${LRCLIB_BASE_URL}/api/search?q=${encodeURIComponent(query)}`
        );

        if (!res.ok) {
            return emptyLyrics();
        }

        const results: LRCLibResponse[] = await res.json();

        if (!results || results.length === 0) {
            return emptyLyrics();
        }

        // Pick the best match — prefer one with synced lyrics
        const withSynced = results.find(r => r.syncedLyrics);
        const best = withSynced || results[0];
        return transformResponse(best);
    } catch {
        return emptyLyrics();
    }
}

function transformResponse(data: LRCLibResponse): LyricsData {
    return {
        synced: data.syncedLyrics ? parseLRC(data.syncedLyrics) : null,
        unsynced: data.plainLyrics || null,
        instrumental: data.instrumental,
        source: 'lrclib',
    };
}

function emptyLyrics(): LyricsData {
    return {
        synced: null,
        unsynced: null,
        instrumental: false,
        source: 'lrclib',
    };
}
