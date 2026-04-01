import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useListenAlongStore } from '@/stores/listenAlongStore';
import { Radio, Wifi, WifiOff, Loader2 } from 'lucide-react';

export function RoomPage() {
    const { roomName } = useParams<{ roomName: string }>();
    const { roomState, connectionStatus, error, joinRoom, leaveRoom, isInRoom } = useListenAlongStore();
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (roomName && !isInRoom) {
            joinRoom(roomName).catch(() => {});
        }
        return () => { leaveRoom(); };
    }, [roomName]);

    // Live progress bar
    useEffect(() => {
        if (!roomState?.isPlaying || !roomState.playbackStartedAt) return;
        const interval = setInterval(() => {
            const now = Date.now() * 1000;
            setElapsed((now - roomState.playbackStartedAt) / 1_000_000);
        }, 250);
        return () => clearInterval(interval);
    }, [roomState?.playbackStartedAt, roomState?.isPlaying]);

    useEffect(() => {
        if (roomState && !roomState.isPlaying) {
            const now = Date.now() * 1000;
            setElapsed((now - roomState.playbackStartedAt) / 1_000_000);
        }
    }, [roomState?.isPlaying]);

    const song = roomState?.currentSong;
    const duration = song?.duration ? parseDuration(song.duration) : 0;
    const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;
    const thumbnail = song?.img || (song?.id ? `https://i.ytimg.com/vi/${song.id}/mqdefault.jpg` : null);

    return (
        <div className="min-h-[100dvh] bg-background text-foreground flex flex-col">
            {/* Background glow */}
            {thumbnail && (
                <div className="fixed inset-0 pointer-events-none overflow-hidden">
                    <img
                        src={thumbnail}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover scale-150 blur-[80px] opacity-20 saturate-150"
                    />
                    <div className="absolute inset-0 bg-background/80" />
                </div>
            )}

            <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-8 safe-area-inset">
                <div className="w-full max-w-sm flex flex-col items-center gap-6 md:gap-8">

                    {/* Connection status pill */}
                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.05] border border-white/[0.06] backdrop-blur-sm">
                        <div className={`flex items-center justify-center w-5 h-5 rounded-full ${
                            connectionStatus === 'connected' ? 'bg-green-400/10' : connectionStatus === 'disconnected' ? 'bg-red-400/10' : 'bg-amber-400/10'
                        }`}>
                            {connectionStatus === 'connected' && <Wifi className="h-3 w-3 text-green-400" />}
                            {connectionStatus === 'connecting' && <Loader2 className="h-3 w-3 text-amber-400 animate-spin" />}
                            {connectionStatus === 'reconnecting' && <Loader2 className="h-3 w-3 text-amber-400 animate-spin" />}
                            {connectionStatus === 'disconnected' && <WifiOff className="h-3 w-3 text-red-400" />}
                        </div>
                        <span className="text-sm text-white/50 capitalize">{connectionStatus}</span>
                        {roomName && (
                            <>
                                <span className="text-white/15">·</span>
                                <span className="text-sm text-white/35">{roomName}</span>
                            </>
                        )}
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="w-full rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    {/* Thumbnail */}
                    {thumbnail ? (
                        <div className="relative">
                            <img
                                src={thumbnail}
                                alt={song?.title || 'Album art'}
                                className="w-56 h-56 sm:w-64 sm:h-64 md:w-72 md:h-72 rounded-3xl object-cover shadow-2xl shadow-black/50"
                            />
                            {/* Now playing overlay */}
                            {roomState?.isPlaying && (
                                <div className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md">
                                    <div className="flex gap-[3px] items-end h-3">
                                        <div className="w-[3px] h-full bg-[#ff3b6b] rounded-full animate-pulse" />
                                        <div className="w-[3px] h-2 bg-[#ff3b6b] rounded-full animate-pulse [animation-delay:150ms]" />
                                        <div className="w-[3px] h-2.5 bg-[#ff3b6b] rounded-full animate-pulse [animation-delay:300ms]" />
                                    </div>
                                    <span className="text-[11px] font-medium text-white/80">LIVE</span>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="w-56 h-56 sm:w-64 sm:h-64 md:w-72 md:h-72 rounded-3xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                            <Radio className="h-16 w-16 text-white/10" />
                        </div>
                    )}

                    {/* Song info */}
                    <div className="text-center w-full px-2">
                        <h1 className="text-xl sm:text-2xl font-bold truncate leading-tight">
                            {song?.title || 'Waiting for host...'}
                        </h1>
                        <p className="text-sm text-white/50 truncate mt-1.5">
                            {song?.author || '\u00A0'}
                        </p>
                    </div>

                    {/* Progress bar */}
                    {duration > 0 && (
                        <div className="w-full px-1">
                            <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                                <div
                                    className="h-full bg-[#ff3b6b] rounded-full transition-[width] duration-200 ease-linear"
                                    style={{ width: `${progress * 100}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-[11px] text-white/35 mt-2 font-medium tabular-nums">
                                <span>{formatTime(elapsed)}</span>
                                <span>{formatTime(duration)}</span>
                            </div>
                        </div>
                    )}

                    {/* Playback indicator */}
                    {roomState && !roomState.isPlaying && (
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04]">
                            <span className="text-xs text-white/35 font-medium">Paused</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="relative z-10 pb-8 pt-4 text-center safe-area-inset">
                <p className="text-[11px] text-white/15 font-medium tracking-wider uppercase">
                    Listening along via M14U
                </p>
            </div>
        </div>
    );
}

function parseDuration(dur: string): number {
    // "3:45" or "1:02:30" or seconds number
    if (!isNaN(Number(dur))) return Number(dur);
    const parts = dur.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

function formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
}
