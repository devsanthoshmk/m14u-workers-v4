import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useListenAlongStore } from '@/stores/listenAlongStore';
import { Radio, Wifi, WifiOff, Loader2, Music, Users } from 'lucide-react';

export function RoomPage() {
    const { roomName } = useParams<{ roomName: string }>();
    const { roomState, connectionStatus, error, joinRoom, leaveRoom, isInRoom, memberName } = useListenAlongStore();
    const [elapsed, setElapsed] = useState(0);
    const [nameInput, setNameInput] = useState('');
    const [joining, setJoining] = useState(false);

    // If already in room (rejoining from navigation), skip name input
    const showNameInput = !isInRoom;

    async function handleJoin() {
        if (!roomName || !nameInput.trim()) return;
        setJoining(true);
        try {
            await joinRoom(roomName, nameInput.trim());
        } catch {}
        setJoining(false);
    }

    useEffect(() => {
        return () => { leaveRoom(); };
    }, []);

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

    // Queue items after current
    const upNext = roomState ? roomState.queue.slice((roomState.queueIndex ?? 0) + 1) : [];

    // --- Name Input Screen ---
    if (showNameInput) {
        return (
            <div className="min-h-[100dvh] bg-background text-foreground flex flex-col items-center justify-center px-6">
                <div className="w-full max-w-sm flex flex-col items-center gap-6">
                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-[#ff3b6b]/10">
                        <Radio className="h-8 w-8 text-[#ff3b6b]" />
                    </div>
                    <div className="text-center">
                        <h1 className="text-2xl font-bold">Join Room</h1>
                        <p className="text-sm text-white/50 mt-1">{roomName}</p>
                    </div>

                    {error && (
                        <div className="w-full rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    <div className="w-full space-y-3">
                        <input
                            type="text"
                            placeholder="Your display name"
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleJoin()}
                            className="w-full rounded-xl bg-white/[0.05] border border-white/[0.08] px-4 py-3 text-sm text-foreground placeholder:text-white/30 focus:outline-none focus:border-[#ff3b6b]/40 transition-colors"
                            autoFocus
                        />
                        <button
                            onClick={handleJoin}
                            disabled={!nameInput.trim() || joining}
                            className="w-full rounded-xl bg-[#ff3b6b] px-4 py-3 text-sm font-semibold text-white hover:bg-[#ff3b6b]/90 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {joining ? 'Joining...' : 'Join'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --- Room View ---
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

            <div className="relative z-10 flex-1 flex flex-col items-center px-6 py-8 safe-area-inset">
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
                        {memberName && (
                            <>
                                <span className="text-white/15">·</span>
                                <span className="text-sm text-white/35">{memberName}</span>
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

                    {/* Listeners count */}
                    {roomState?.listeners && roomState.listeners.length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-white/35">
                            <Users className="h-3.5 w-3.5" />
                            <span>{roomState.listeners.length} listening</span>
                        </div>
                    )}
                </div>

                {/* Up Next Queue */}
                {upNext.length > 0 && (
                    <div className="w-full max-w-sm mt-8">
                        <div className="flex items-center gap-2 mb-3">
                            <Music className="h-4 w-4 text-white/40" />
                            <h2 className="text-sm font-semibold text-white/60">Up Next</h2>
                            <span className="text-xs text-white/25 ml-auto">{upNext.length} song{upNext.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex flex-col gap-1 max-h-[40vh] overflow-y-auto overscroll-contain">
                            {upNext.map((item, i) => {
                                const s = item.song;
                                const thumb = s?.img || (s?.id ? `https://i.ytimg.com/vi/${s.id}/mqdefault.jpg` : null);
                                return (
                                    <div
                                        key={item.queueId || i}
                                        className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.05] transition-colors"
                                    >
                                        {thumb ? (
                                            <img src={thumb} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                                        ) : (
                                            <div className="w-10 h-10 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                                                <Music className="h-4 w-4 text-white/20" />
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium truncate">{s?.title || s?.name || 'Unknown'}</p>
                                            <p className="text-xs text-white/40 truncate">{s?.author || (s as any)?.artist?.name || ''}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
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
