/**
 * Listen Along Store — Disabled for refactoring
 * 
 * This feature will be re-enabled in the future with a new architecture.
 * Currently shows "Coming Soon" placeholder.
 */

import { create } from 'zustand';

interface ListenAlongState {
    isInRoom: boolean;
    isHost: boolean;
    roomCode: string | null;
    displayName: string;
    isSyncPaused: boolean;
    
    // All methods are stubs that show "Coming Soon"
    createRoom: (displayName: string) => Promise<string>;
    joinRoom: (roomCode: string, displayName: string) => Promise<void>;
    leaveRoom: () => void;
    toggleSyncPause: () => void;
    reconnect: () => Promise<void>;
    setDisplayName: (name: string) => void;
}

export const useListenAlongStore = create<ListenAlongState>(() => ({
    isInRoom: false,
    isHost: false,
    roomCode: null,
    displayName: '',
    isSyncPaused: false,

    createRoom: async (_displayName: string) => {
        console.info('Listen Along: Coming Soon');
        throw new Error('Listen Along is coming soon!');
    },

    joinRoom: async (_roomCode: string, _displayName: string) => {
        console.info('Listen Along: Coming Soon');
        throw new Error('Listen Along is coming soon!');
    },

    leaveRoom: () => {
        console.info('Listen Along: Coming Soon');
    },

    toggleSyncPause: () => {
        console.info('Listen Along: Coming Soon');
    },

    reconnect: async () => {
        console.info('Listen Along: Coming Soon');
    },

    setDisplayName: (_name: string) => {
        console.info('Listen Along: Coming Soon');
    },
}));
