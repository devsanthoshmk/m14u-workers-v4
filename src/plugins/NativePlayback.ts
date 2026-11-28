import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeCapabilities {
    abiVersion: number;
    sourceRefresh: boolean;
    localMedia: boolean;
    headlessResolver: boolean;
    resolverAbi: string;
    sandboxSupported?: boolean;
    saavnUnprimed?: boolean;
}

export interface NativeTrackSource {
    url: string;
    mimeType?: string;
    headers?: Record<string, string>;
    expiresAtMs?: number;
}

export interface NativeResolverKey {
    provider: string;
    trackId: string;
}

export interface NativePlaybackState {
    queueId: string;
    position: number;
    duration: number;
    playing: boolean;
    buffering: boolean;
    error: string;
    sleepEnded: boolean;
    generation?: number;
}

export interface NativeQueueItem {
    queueId: string;
    id: string;
    title: string;
    artist: string;
    artwork: string[];
    url?: string;
    proxy?: string;
    source?: NativeTrackSource;
    resolverKey?: NativeResolverKey;
}

export interface NativeResolvedSourceEntry {
    queueId: string;
    resolverKey?: NativeResolverKey;
    source: NativeTrackSource;
}

export interface NativeSetResolvedSourcesResult {
    updated: number;
    rejected: number;
}

export default registerPlugin<{
    getCapabilities(): Promise<NativeCapabilities>;
    loadQueue(options: { queue: NativeQueueItem[]; index: number; repeat: number; volume: number; play: boolean; generation?: number }): Promise<NativePlaybackState>;
    updateQueue(options: { queue: NativeQueueItem[]; generation?: number }): Promise<void>;
    setResolvedSources(options: { generation: number; entries: NativeResolvedSourceEntry[] }): Promise<NativeSetResolvedSourcesResult>;
    control(options: { action: string; value?: number }): Promise<NativePlaybackState>;
    getState(): Promise<NativePlaybackState>;
    addListener(event: 'state', listener: (state: NativePlaybackState) => void): Promise<PluginListenerHandle>;
}>('NativePlayback');
