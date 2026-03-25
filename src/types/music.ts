/**
 * Core music domain types.
 * Mirrors the backend API response shapes exactly.
 */

export interface Thumbnail {
    url: string;
    width: number;
    height: number;
}

export interface Artist {
    name: string;
    artistId: string;
}

export interface Album {
    name: string;
    albumId: string;
}

export interface Song {
    type: 'SONG';
    videoId: string;
    name: string;
    artist: Artist;
    album: Album | null;
    duration: number | null; // seconds
    thumbnails: Thumbnail[];
    description?: string;
    streamUrl: string;
}

export interface AlbumItem {
    type: 'ALBUM';
    albumId: string;
    playlistId?: string;
    name: string;
    artist: Artist;
    year?: number;
    thumbnails: Thumbnail[];
}

export interface ArtistItem {
    type: 'ARTIST';
    artistId: string;
    name: string;
    thumbnails: Thumbnail[];
}

export interface PlaylistItem {
    type: 'PLAYLIST';
    playlistId: string;
    name: string;
    thumbnails: Thumbnail[];
}

export interface VideoItem {
    type: 'VIDEO';
    videoId: string;
    name: string;
    artist: Artist;
    duration: number | null;
    thumbnails: Thumbnail[];
    streamUrl?: string;
}

export type SectionContent = Song | AlbumItem | ArtistItem | PlaylistItem | VideoItem;

export interface Section {
    title: string;
    contents: SectionContent[];
}

export interface TrendingResponse {
    locale: {
        gl: string;
        hl: string;
    };
    sections: Section[];
}

export interface StreamResponse {
    url: string;
}

export interface ErrorResponse {
    error: string;
}

// ytify-style types with backwards compatibility
export interface TrackItem {
    // ytify style
    id: string;
    title: string;
    author: string;
    authorId: string;
    duration: string;
    subtext?: string;
    type: 'song' | 'video';
    albumId?: string;
    img?: string;
    
    // Legacy M14U style (for backwards compatibility)
    videoId?: string;
    name?: string;
    artist?: { name: string; artistId: string };
    album?: { name: string; albumId: string } | null;
    durationSec?: number | null;
    thumbnails?: Thumbnail[];
    streamUrl?: string;
}

// Backend types
export interface YTItem extends TrackItem {}

export interface YTListItem {
    id: string;
    name: string;
    videoCount?: string;
    subscribers?: string;
    img: string;
    type: 'playlist' | 'artist' | 'album' | 'channel';
    playlistId?: string;
    author?: string;
    year?: string;
    description?: string;
}

export interface YTPlaylistItem {
    id: string;
    name: string;
    author: string;
    img: string;
    type: 'playlist';
    items: YTItem[];
    hasContinuation?: boolean;
}

export interface AudioStream {
    url: string;
    bitrate: string;
    encoding: string;
    type: string;
    quality?: string;
}

export interface Invidious {
    adaptiveFormats: AudioStream[];
    title: string;
    recommendedVideos?: unknown[];
    [key: string]: unknown;
}
