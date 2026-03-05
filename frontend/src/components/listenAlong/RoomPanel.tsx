/**
 * RoomPanel — Right-side panel showing active Listen Along room.
 *
 * Same pattern as QueuePanel / LyricsPanel.
 * Shows: room code, peer list, connection status, and suggestions.
 * Host sees pending suggestion approvals.
 * Members can suggest songs.
 */

import { useState, useCallback } from 'react';
import { X, Copy, Check, Crown, Radio, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListenAlongStore } from '@/stores/listenAlongStore';
import { useUIStore } from '@/stores/uiStore';

export function RoomPanel() {
    const roomCode = useListenAlongStore(s => s.roomCode);
    const peers = useListenAlongStore(s => s.peers);
    const isHost = useListenAlongStore(s => s.isHost);
    const connectionStatus = useListenAlongStore(s => s.connectionStatus);
    const leaveRoom = useListenAlongStore(s => s.leaveRoom);
    const testHostOnline = useListenAlongStore(s => s.testHostOnline);
    const roomEventMessage = useListenAlongStore(s => s.roomEventMessage);
    const clearRoomEventMessage = useListenAlongStore(s => s.clearRoomEventMessage);
    const hostOnlineStatus = useListenAlongStore(s => s.hostOnlineStatus);
    const isSyncPaused = useListenAlongStore(s => s.isSyncPaused);
    const toggleSyncPause = useListenAlongStore(s => s.toggleSyncPause);
    const setRoomPanelOpen = useUIStore(s => s.setRoomPanelOpen);

    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        if (!roomCode) return;
        const shareUrl = `${window.location.origin}/room/${roomCode}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [roomCode]);

    const handleLeave = useCallback(async () => {
        await leaveRoom();
        setRoomPanelOpen(false);
    }, [leaveRoom, setRoomPanelOpen]);

    return (
        <div className="flex flex-col h-full w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 flex-shrink-0 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                    <Radio className="h-4 w-4 text-primary animate-pulse-soft" />
                    <h2 className="text-base font-bold font-heading">Listen Along</h2>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleLeave}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                    >
                        {isHost ? 'Close Room' : 'Leave'}
                    </button>
                    <button
                        onClick={() => setRoomPanelOpen(false)}
                        className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-4">
                {/* Room Code */}
                <div className="mt-3 flex items-center justify-between bg-white/[0.03] rounded-xl px-3.5 py-2.5 border border-white/[0.06]">
                    <div>
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Room Code</p>
                        <p className="text-lg font-bold font-heading tracking-[0.15em] text-foreground">{roomCode}</p>
                    </div>
                    <button
                        onClick={handleCopy}
                        className="p-2 rounded-lg hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-colors"
                        title="Copy share link"
                    >
                        {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                </div>

                {/* Connection Status */}
                <div className="mt-3 flex items-center gap-2 px-1">
                    <ConnectionBadge status={connectionStatus} />
                </div>

                {!isHost && (
                    <div className="mt-2 px-1 flex items-center justify-between">
                        <div>
                            <button
                                onClick={testHostOnline}
                                className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-foreground transition-colors mr-2"
                            >
                                Test Host Online
                            </button>
                            <button
                                onClick={toggleSyncPause}
                                className={cn(
                                    "text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors",
                                    isSyncPaused
                                        ? "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20 text-amber-400"
                                        : "bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08] text-foreground"
                                )}
                            >
                                {isSyncPaused ? 'Resume Sync with Host' : 'Pause Sync'}
                            </button>
                        </div>
                        {hostOnlineStatus !== null && (
                            <p className={cn(
                                'text-[11px] mt-1.5',
                                hostOnlineStatus ? 'text-emerald-400' : 'text-muted-foreground',
                            )}>
                                {hostOnlineStatus ? 'Host is online' : 'Offline'}
                            </p>
                        )}
                    </div>
                )}

                {roomEventMessage && (
                    <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] text-foreground flex items-start justify-between gap-2">
                        <span>{roomEventMessage}</span>
                        <button
                            onClick={clearRoomEventMessage}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Dismiss room event"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}

                {/* Peers */}
                <div className="mt-4">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Listeners · {peers.length}
                    </p>
                    <div className="space-y-1">
                        {peers.map(peer => (
                            <div
                                key={peer.peerId}
                                className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.03] transition-colors"
                            >
                                {/* Avatar circle */}
                                <div className="relative">
                                    <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
                                        {peer.displayName.charAt(0).toUpperCase()}
                                    </div>
                                    {/* Online indicator */}
                                    <div className={cn(
                                        'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[hsl(240_6%_7%)]',
                                        peer.isOnline !== false ? 'bg-emerald-400' : 'bg-muted-foreground/40',
                                    )} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-medium text-foreground line-clamp-1">
                                        {peer.displayName}
                                    </p>
                                </div>
                                {peer.isHost && (
                                    <span className="flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                        <Crown className="h-3 w-3" /> Head
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>


            </div>
        </div>
    );
}

// ─── Connection Status Badge ────────────────────────────────────

function ConnectionBadge({ status }: { status: string }) {
    const config = {
        disconnected: { icon: WifiOff, label: 'Disconnected', color: 'text-muted-foreground' },
        connecting: { icon: Loader2, label: 'Connecting…', color: 'text-primary', spin: true },
        calibrating: { icon: Loader2, label: 'Calibrating sync…', color: 'text-primary', spin: true },
        connected: { icon: Wifi, label: 'Connected', color: 'text-emerald-400' },
    }[status] || { icon: WifiOff, label: status, color: 'text-muted-foreground' };

    const Icon = config.icon;

    return (
        <div className={cn('flex items-center gap-1.5 text-[11px] font-medium', config.color)}>
            <Icon className={cn('h-3.5 w-3.5', 'spin' in config && config.spin && 'animate-spin')} />
            {config.label}
        </div>
    );
}
