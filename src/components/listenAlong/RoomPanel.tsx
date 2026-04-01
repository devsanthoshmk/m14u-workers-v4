import { X, Radio, Wifi, WifiOff, Loader2, Copy, Check, LogOut } from 'lucide-react';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useUIStore } from '@/stores/uiStore';
import { useListenAlongStore } from '@/stores/listenAlongStore';

export function RoomPanel() {
    const setRoomPanelOpen = useUIStore(s => s.setRoomPanelOpen);
    const { isHost, roomName, tunnelUrl, connectionStatus, roomState, leaveRoom } = useListenAlongStore();
    const [copied, setCopied] = useState(false);

    const roomLink = roomName ? `https://m14u.pages.dev/room/${roomName}` : '';
    const song = roomState?.currentSong;

    function handleCopy() {
        navigator.clipboard.writeText(roomLink).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }

    function handleLeave() {
        leaveRoom();
        setRoomPanelOpen(false);
    }

    const StatusIcon = connectionStatus === 'connected' ? Wifi
        : connectionStatus === 'disconnected' ? WifiOff
        : Loader2;

    const statusColor = connectionStatus === 'connected'
        ? 'text-green-400'
        : connectionStatus === 'disconnected'
            ? 'text-red-400'
            : 'text-amber-400 animate-spin';

    return (
        <div className="flex flex-col h-full w-full p-4 md:p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#ff3b6b]/10">
                        <Radio className="h-4 w-4 text-[#ff3b6b]" />
                    </div>
                    <h2 className="text-base font-bold text-foreground">Listen Along</h2>
                </div>
                <button
                    onClick={() => setRoomPanelOpen(false)}
                    className="rounded-full p-2 text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
                    aria-label="Close"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Status pill */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] mb-5">
                <div className={`flex items-center justify-center w-5 h-5 rounded-full ${
                    connectionStatus === 'connected' ? 'bg-green-400/10' : connectionStatus === 'disconnected' ? 'bg-red-400/10' : 'bg-amber-400/10'
                }`}>
                    <StatusIcon className={`h-3 w-3 ${statusColor}`} />
                </div>
                <span className="text-sm text-white/60 capitalize">{connectionStatus}</span>
                {roomName && (
                    <>
                        <span className="text-white/20">·</span>
                        <span className="text-sm text-white/40 truncate">{roomName}</span>
                    </>
                )}
            </div>

            {/* Host view */}
            {isHost && (
                <div className="flex flex-col items-center gap-5 flex-1 min-h-0">
                    <div className="bg-white p-3 rounded-2xl shadow-lg">
                        <QRCodeSVG value={roomLink} size={120} />
                    </div>
                    <div className="text-center w-full space-y-2">
                        <p className="text-[11px] font-medium text-white/35 uppercase tracking-wider">Share link</p>
                        <div className="flex items-center gap-2 bg-white/[0.04] rounded-xl px-3 py-2.5 border border-white/[0.06]">
                            <span className="text-xs text-[#ff3b6b] truncate flex-1 min-w-0">{roomLink}</span>
                            <button
                                onClick={handleCopy}
                                className="shrink-0 rounded-lg p-1.5 text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                            >
                                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Member view */}
            {!isHost && song && (
                <div className="flex flex-col items-center gap-4 flex-1 min-h-0">
                    {(song.img || song.id) && (
                        <img
                            src={song.img || `https://i.ytimg.com/vi/${song.id}/mqdefault.jpg`}
                            alt={song.title}
                            className="w-28 h-28 md:w-32 md:h-32 rounded-2xl object-cover shadow-xl shadow-black/30"
                        />
                    )}
                    <div className="text-center w-full max-w-[200px]">
                        <p className="text-sm font-semibold truncate">{song.title}</p>
                        <p className="text-xs text-white/50 truncate mt-0.5">{song.author}</p>
                    </div>
                    {roomState && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04]">
                            {roomState.isPlaying ? (
                                <>
                                    <div className="flex gap-[3px] items-end h-3">
                                        <div className="w-[3px] h-full bg-[#ff3b6b] rounded-full animate-pulse" />
                                        <div className="w-[3px] h-2 bg-[#ff3b6b] rounded-full animate-pulse [animation-delay:150ms]" />
                                        <div className="w-[3px] h-2.5 bg-[#ff3b6b] rounded-full animate-pulse [animation-delay:300ms]" />
                                    </div>
                                    <span className="text-xs text-white/50">Playing</span>
                                </>
                            ) : (
                                <span className="text-xs text-white/40">Paused</span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Leave button */}
            <button
                onClick={handleLeave}
                className="mt-auto w-full flex items-center justify-center gap-2 rounded-xl bg-red-500/8 border border-red-500/10 px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-500/15 active:scale-[0.98] transition-all"
            >
                <LogOut className="h-4 w-4" />
                {isHost ? 'Stop Room' : 'Leave Room'}
            </button>
        </div>
    );
}
