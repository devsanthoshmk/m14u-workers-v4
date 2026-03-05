/**
 * JoinRoomPage — Handles URL-based room join at /room/:code.
 *
 * Workflow:
 * 1. Extracts room code from URL params
 * 2. Checks if already in the room → redirect
 * 3. Shows room info preview + display name input
 * 4. On join → navigates to home with room panel open
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Radio, Users, Loader2, AlertCircle } from 'lucide-react';
import { useListenAlongStore } from '@/stores/listenAlongStore';
import { useUIStore } from '@/stores/uiStore';
import * as api from '@/services/listenAlong';
import type { PeerInfo } from '@/types/listenAlong';

export function JoinRoomPage() {
    const { code } = useParams<{ code: string }>();
    const navigate = useNavigate();

    const isInRoom = useListenAlongStore(s => s.isInRoom);
    const roomCode = useListenAlongStore(s => s.roomCode);
    const savedName = useListenAlongStore(s => s.displayName);
    const joinRoom = useListenAlongStore(s => s.joinRoom);
    const setRoomPanelOpen = useUIStore(s => s.setRoomPanelOpen);

    const [displayName, setDisplayName] = useState(savedName || '');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [roomPreview, setRoomPreview] = useState<{ peers: PeerInfo[]; hostName: string } | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(true);

    // If already in this room, redirect
    useEffect(() => {
        if (isInRoom && roomCode === code?.toUpperCase()) {
            navigate('/', { replace: true });
        }
    }, [isInRoom, roomCode, code, navigate]);

    // Load room preview
    useEffect(() => {
        if (!code) return;
        setIsLoadingPreview(true);
        api.getRoomInfo(code.toUpperCase())
            .then(info => {
                const host = info.peers.find(p => p.isHost);
                setRoomPreview({
                    peers: info.peers,
                    hostName: host?.displayName || 'Unknown',
                });
            })
            .catch(() => {
                setError('Room not found or expired');
            })
            .finally(() => setIsLoadingPreview(false));
    }, [code]);

    const handleJoin = useCallback(async () => {
        if (!code || !displayName.trim()) {
            setError('Enter your name');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            await joinRoom(code.toUpperCase(), displayName.trim());
            setRoomPanelOpen(true);
            navigate('/', { replace: true });
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [code, displayName, joinRoom, navigate, setRoomPanelOpen]);

    return (
        <div className="flex items-center justify-center min-h-full p-6">
            <div className="w-full max-w-[380px] animate-fade-in">
                {/* Icon */}
                <div className="flex justify-center mb-6">
                    <div className="h-16 w-16 rounded-2xl bg-primary/15 flex items-center justify-center">
                        <Radio className="h-8 w-8 text-primary" />
                    </div>
                </div>

                {/* Title */}
                <h1 className="text-2xl font-bold font-heading text-center mb-1">Join Listen Along</h1>
                <p className="text-sm text-muted-foreground text-center mb-6">
                    Room code: <span className="font-bold font-heading tracking-[0.1em] text-foreground">{code?.toUpperCase()}</span>
                </p>

                {/* Room Preview */}
                {isLoadingPreview ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : error && !roomPreview ? (
                    <div className="flex flex-col items-center gap-3 py-8">
                        <AlertCircle className="h-8 w-8 text-destructive/60" />
                        <p className="text-sm text-destructive text-center">{error}</p>
                        <button
                            onClick={() => navigate('/')}
                            className="text-sm text-primary hover:underline"
                        >
                            Go Home
                        </button>
                    </div>
                ) : roomPreview ? (
                    <div className="space-y-4">
                        {/* Host info */}
                        <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] px-4 py-3">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                Hosted by
                            </p>
                            <p className="text-sm font-semibold text-foreground">{roomPreview.hostName}</p>
                            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                                <Users className="h-3 w-3" />
                                {roomPreview.peers.length} listener{roomPreview.peers.length !== 1 ? 's' : ''}
                            </div>
                        </div>

                        {/* Name input */}
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                Your Name
                            </label>
                            <input
                                type="text"
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                                placeholder="Enter your name"
                                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                                maxLength={30}
                                autoFocus
                            />
                        </div>

                        {/* Join button */}
                        <button
                            onClick={handleJoin}
                            disabled={isLoading}
                            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> Joining…</>
                            ) : (
                                <><Users className="h-4 w-4" /> Join Room</>
                            )}
                        </button>

                        {/* Error */}
                        {error && (
                            <p className="text-destructive text-xs text-center animate-fade-in">{error}</p>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
