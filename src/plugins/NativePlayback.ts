import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativePlaybackState {
    queueId: string;
    position: number;
    duration: number;
    playing: boolean;
    buffering: boolean;
    error: string;
    sleepEnded: boolean;
}

interface NativeQueueItem {
    queueId: string;
    id: string;
    title: string;
    artist: string;
    artwork: string[];
    url?: string;
    proxy?: string;
}

export default registerPlugin<{
    loadQueue(options: { queue: NativeQueueItem[]; index: number; repeat: number; volume: number; play: boolean }): Promise<NativePlaybackState>;
    updateQueue(options: { queue: NativeQueueItem[] }): Promise<void>;
    control(options: { action: string; value?: number }): Promise<NativePlaybackState>;
    getState(): Promise<NativePlaybackState>;
    addListener(event: 'state', listener: (state: NativePlaybackState) => void): Promise<PluginListenerHandle>;
}>('NativePlayback');
