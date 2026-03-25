/**
 * Types for LRCLIB lyrics integration.
 */

export interface LyricLine {
    time: number; // seconds
    text: string;
}

export interface LRCLibResponse {
    id: number;
    trackName: string;
    artistName: string;
    albumName: string;
    duration: number;
    instrumental: boolean;
    plainLyrics: string | null;
    syncedLyrics: string | null;
}

export interface LyricsData {
    synced: LyricLine[] | null;
    unsynced: string | null;
    instrumental: boolean;
    source: 'lrclib';
}
