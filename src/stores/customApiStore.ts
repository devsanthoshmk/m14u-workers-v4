import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import DevTunnel from '@/plugins/DevTunnel';
import { Capacitor } from '@capacitor/core';

interface CustomApiState {
    apiCode: string;
    tunnelUrl: string | null;
    status: 'idle' | 'connecting' | 'connected' | 'error';
    error: string | null;
    isHostServer: boolean;
    hostServerCode: string | null;
    connectCode: (code: string) => Promise<void>;
    startHostServer: () => Promise<void>;
    stopHostServer: () => Promise<void>;
    disconnect: () => void;
}

const KV_BASE = 'https://m14u.sanpro.workers.dev/';

export const useCustomApiStore = create<CustomApiState>()(
    persist(
        (set) => ({
            apiCode: '',
            tunnelUrl: null,
            status: 'idle',
            error: null,
            isHostServer: false,
            hostServerCode: null,
            connectCode: async (code: string) => {
                if (!code.trim()) return;
                set({ status: 'connecting', error: null, apiCode: code, isHostServer: false, hostServerCode: null });
                
                let retries = 10;
                while (retries > 0) {
                    try {
                        const res = await fetch(`${KV_BASE}?key=${encodeURIComponent(code)}`);
                        if (!res.ok) {
                            if (res.status === 404) throw new Error(`Tunnel URL not found on edge yet. Retrying...`);
                            throw new Error(`KV lookup failed: ${res.status}`);
                        }
                        const url = await res.text();
                        if (!url || !url.startsWith('http')) throw new Error('No tunnel URL found for this code');
                        
                        set({ tunnelUrl: url.trim(), status: 'connected', error: null });
                        return;
                    } catch (err: any) {
                        retries--;
                        if (retries <= 0) {
                            set({ status: 'error', error: "Failed to connect: The tunnel might be offline or code is incorrect." });
                        } else {
                            await new Promise(r => setTimeout(r, 1500)); // wait 1.5s then retry
                        }
                    }
                }
            },
            startHostServer: async () => {
                if (!Capacitor.isNativePlatform()) return;
                
                // Disconnect any active DevTunnel sessions 
                try { await DevTunnel.stopTunnel(); } catch (e) {}

                set({ status: 'connecting', error: null });
                const code = Math.floor(1000 + Math.random() * 9000).toString();
                try {
                    const { url } = await DevTunnel.startTunnel({ username: code, port: 8080 });
                    set({
                        isHostServer: true,
                        hostServerCode: code,
                        tunnelUrl: url,
                        status: 'connected',
                        apiCode: code
                    });
                } catch (err: any) {
                    set({ status: 'error', error: err.message });
                }
            },
            stopHostServer: async () => {
                set({ status: 'idle', isHostServer: false, hostServerCode: null, tunnelUrl: null, apiCode: '' });
                if (Capacitor.isNativePlatform()) {
                    try { await DevTunnel.stopTunnel(); } catch (e) {}
                }
            },
            disconnect: () => {
                set({ apiCode: '', tunnelUrl: null, status: 'idle', error: null, isHostServer: false, hostServerCode: null });
                // If it was host, stop it
                if (Capacitor.isNativePlatform()) {
                    DevTunnel.stopTunnel().catch(() => {});
                }
            }
        }),
        {
            name: 'custom-api-storage',
            storage: createJSONStorage(() => localStorage),
        }
    )
);
