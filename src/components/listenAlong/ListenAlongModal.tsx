import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Radio, Loader2, Users, Plus, Copy, Check, LogOut, Wifi, WifiOff, Headphones } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Capacitor } from '@capacitor/core';
import { QRCodeSVG } from 'qrcode.react';
import { useListenAlongStore } from '@/stores/listenAlongStore';
import { useCustomApiStore } from '@/stores/customApiStore';
import { useNavigate } from 'react-router-dom';

interface ListenAlongModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type Tab = 'create' | 'join' | 'server';

export function ListenAlongModal({ open, onOpenChange }: ListenAlongModalProps) {
    const isNative = Capacitor.isNativePlatform();
    const [tab, setTab] = useState<Tab>(isNative ? 'create' : 'join');
    const [roomName, setRoomName] = useState('');
    const [apiCodeInput, setApiCodeInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createdUrl, setCreatedUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const { createRoom, isInRoom, isHost, roomName: activeRoomName, connectionStatus, roomState, leaveRoom } = useListenAlongStore();
    const { connectCode, disconnect, tunnelUrl, status: apiStatus, error: apiError, apiCode, isHostServer, hostServerCode, startHostServer, stopHostServer } = useCustomApiStore();
    const navigate = useNavigate();

    const listeners = roomState?.listeners || [];
    const hasListeners = listeners.length > 0;

    const activeRoomLink = activeRoomName ? `https://m14u.pages.dev/room/${activeRoomName}` : '';
    const roomLink = roomName ? `https://m14u.pages.dev/room/${roomName}` : '';
    const activeServerLink = hostServerCode ? `https://m14u.pages.dev/server/${hostServerCode}` : '';

    async function handleCreate() {
        if (!roomName.trim()) return;
        setLoading(true);
        setError(null);
        try {
            const url = await createRoom(roomName.trim());
            setCreatedUrl(url);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    function handleJoin() {
        if (!roomName.trim()) return;
        onOpenChange(false);
        navigate(`/room/${roomName.trim()}`);
    }

    function handleClose() {
        if (!isInRoom) {
            setCreatedUrl(null);
            setError(null);
            setRoomName('');
            setLoading(false);
        }
        onOpenChange(false);
    }

    function handleLeave() {
        leaveRoom();
        setCreatedUrl(null);
        setError(null);
        setRoomName('');
        onOpenChange(false);
    }

    function handleCopyLink() {
        let link = '';
        if (tab === 'server' && isHostServer) link = activeServerLink;
        else if (isInRoom) link = activeRoomLink;
        else link = roomLink;

        navigator.clipboard.writeText(link).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
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
        <Dialog.Root open={open} onOpenChange={handleClose}>
            <Dialog.Portal>
                <Dialog.Overlay asChild>
                    <motion.div
                        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    />
                </Dialog.Overlay>
                <Dialog.Content asChild>
                    <motion.div
                        className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2"
                        initial={{ opacity: 0, y: '100%' }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: '100%' }}
                        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                    >
                        <div className="rounded-t-3xl md:rounded-2xl border border-white/[0.08] bg-card shadow-2xl shadow-black/40 overflow-hidden">
                            {/* Drag handle - mobile only */}
                            <div className="flex justify-center pt-3 pb-1 md:hidden">
                                <div className="w-10 h-1 rounded-full bg-white/20" />
                            </div>

                            <div className="px-5 pb-6 pt-3 md:p-6">
                                {/* Header */}
                                <div className="flex items-center justify-between mb-5">
                                    <Dialog.Title className="text-lg font-bold text-foreground flex items-center gap-2.5">
                                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#ff3b6b]/10">
                                            <Radio className="h-4 w-4 text-[#ff3b6b]" />
                                        </div>
                                        Listen Along
                                    </Dialog.Title>
                                    <Dialog.Close asChild>
                                        <button
                                            className="rounded-full p-2 text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
                                            aria-label="Close"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </Dialog.Close>
                                </div>

                                {/* ── Active room view ── */}
                                {isInRoom ? (
                                    <div className="flex flex-col gap-5">
                                        {/* Status pill */}
                                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                                            <div className={`flex items-center justify-center w-5 h-5 rounded-full ${
                                                connectionStatus === 'connected' ? 'bg-green-400/10' : connectionStatus === 'disconnected' ? 'bg-red-400/10' : 'bg-amber-400/10'
                                            }`}>
                                                <StatusIcon className={`h-3 w-3 ${statusColor}`} />
                                            </div>
                                            <span className="text-sm text-white/60 capitalize">{connectionStatus}</span>
                                            <span className="text-white/20">·</span>
                                            <span className="text-sm text-white/40 truncate">{activeRoomName}</span>
                                            <span className="ml-auto text-[11px] font-medium text-[#ff3b6b]/80 bg-[#ff3b6b]/10 px-2 py-0.5 rounded-full">
                                                {isHost ? 'Host' : 'Joined'}
                                            </span>
                                        </div>

                                        {/* QR + share link (host) */}
                                        {isHost && (
                                            <div className="flex flex-col items-center gap-4">
                                                <a 
                                                    href={activeRoomLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="bg-white p-4 rounded-2xl shadow-lg hover:scale-105 transition-transform block"
                                                    title="Open room link"
                                                >
                                                    <QRCodeSVG value={activeRoomLink} size={160} />
                                                </a>
                                                <div className="text-center w-full space-y-2">
                                                    <p className="text-xs font-medium text-white/40 uppercase tracking-wider">Share this link</p>
                                                    <div className="flex items-center gap-2 bg-white/[0.04] rounded-xl px-4 py-3 border border-white/[0.06]">
                                                        <a
                                                            href={activeRoomLink}
                                                            target="_blank"
                                                            rel="noopener"
                                                            className="text-sm text-[#ff3b6b] hover:underline break-all flex-1 min-w-0"
                                                        >
                                                            {activeRoomLink}
                                                        </a>
                                                        <button
                                                            onClick={handleCopyLink}
                                                            className="shrink-0 rounded-lg p-2 text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                                                        >
                                                            {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Listeners list (host) - scrollable horizontal */}
                                        {isHost && hasListeners && (
                                            <div className="w-full">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Headphones className="h-3.5 w-3.5 text-[#ff3b6b]" />
                                                    <span className="text-xs font-medium text-white/40 uppercase tracking-wider">
                                                        {listeners.length} {listeners.length === 1 ? 'listener' : 'listeners'} connected
                                                    </span>
                                                </div>
                                                <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                                                    {listeners.map((l) => (
                                                        <div
                                                            key={l.id}
                                                            className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06]"
                                                        >
                                                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#ff3b6b] to-[#ff6b8a] flex items-center justify-center text-[10px] font-bold text-white">
                                                                {l.name.charAt(0).toUpperCase()}
                                                            </div>
                                                            <span className="text-sm text-white/80 whitespace-nowrap">{l.name}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Leave / Stop */}
                                        <button
                                            onClick={handleLeave}
                                            className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-500/8 border border-red-500/10 px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-500/15 active:scale-[0.98] transition-all"
                                        >
                                            <LogOut className="h-4 w-4" />
                                            {isHost ? 'Stop Room' : 'Leave Room'}
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        {/* ── Create / Join / Server tabs ── */}
                                        <div className="flex gap-1 mb-5 bg-white/[0.04] rounded-xl p-1 border border-white/[0.04]">
                                            {isNative && (
                                                <button
                                                    onClick={() => { setTab('create'); setCreatedUrl(null); setError(null); }}
                                                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-sm font-medium transition-all ${
                                                        tab === 'create'
                                                            ? 'bg-[#ff3b6b] text-white shadow-lg shadow-[#ff3b6b]/20'
                                                            : 'text-white/50 hover:text-white/80 active:bg-white/5'
                                                    }`}
                                                >
                                                    <Plus className="h-3.5 w-3.5 hidden sm:block" />
                                                    Create
                                                </button>
                                            )}
                                            <button
                                                onClick={() => { setTab('join'); setCreatedUrl(null); setError(null); }}
                                                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-sm font-medium transition-all ${
                                                    tab === 'join'
                                                        ? 'bg-[#ff3b6b] text-white shadow-lg shadow-[#ff3b6b]/20'
                                                        : 'text-white/50 hover:text-white/80 active:bg-white/5'
                                                }`}
                                            >
                                                <Users className="h-3.5 w-3.5 hidden sm:block" />
                                                Join
                                            </button>
                                            <button
                                                onClick={() => { setTab('server'); setCreatedUrl(null); setError(null); }}
                                                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-sm font-medium transition-all ${
                                                    tab === 'server'
                                                        ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                                                        : 'text-white/50 hover:text-white/80 active:bg-white/5'
                                                }`}
                                            >
                                                <Wifi className="h-3.5 w-3.5 hidden sm:block" />
                                                Server
                                            </button>
                                        </div>

                                        {/* Error */}
                                        <AnimatePresence>
                                            {error && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 mb-4"
                                                >
                                                    {error}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        {/* Create - input state */}
                                        {tab === 'create' && !createdUrl && (
                                            <motion.div
                                                key="create-form"
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className="flex flex-col gap-3"
                                            >
                                                <input
                                                    type="text"
                                                    placeholder="Enter room name"
                                                    value={roomName}
                                                    onChange={e => setRoomName(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                                    className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3.5 text-sm text-foreground placeholder:text-white/25 outline-none focus:border-[#ff3b6b]/50 focus:ring-1 focus:ring-[#ff3b6b]/20 transition-all"
                                                />
                                                <button
                                                    onClick={handleCreate}
                                                    disabled={loading || !roomName.trim()}
                                                    className="w-full rounded-xl bg-[#ff3b6b] px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-[#ff3b6b]/20 hover:shadow-[#ff3b6b]/30"
                                                >
                                                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                                    {loading ? 'Starting tunnel...' : 'Create Room'}
                                                </button>
                                            </motion.div>
                                        )}

                                        {/* Create - success state */}
                                        {tab === 'create' && createdUrl && (
                                            <motion.div
                                                key="create-success"
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                className="flex flex-col items-center gap-5"
                                            >
                                                <a 
                                                    href={roomLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="bg-white p-4 rounded-2xl shadow-lg hover:scale-105 transition-transform block"
                                                    title="Open room link"
                                                >
                                                    <QRCodeSVG value={roomLink} size={160} />
                                                </a>
                                                <div className="text-center w-full space-y-2">
                                                    <p className="text-xs font-medium text-white/40 uppercase tracking-wider">Share this link</p>
                                                    <div className="flex items-center gap-2 bg-white/[0.04] rounded-xl px-4 py-3 border border-white/[0.06]">
                                                        <a
                                                            href={roomLink}
                                                            target="_blank"
                                                            rel="noopener"
                                                            className="text-sm text-[#ff3b6b] hover:underline break-all flex-1 min-w-0"
                                                        >
                                                            {roomLink}
                                                        </a>
                                                        <button
                                                            onClick={handleCopyLink}
                                                            className="shrink-0 rounded-lg p-2 text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                                                        >
                                                            {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-white/30">Room: <span className="text-white/50">{roomName}</span></p>
                                            </motion.div>
                                        )}

                                        {/* Join */}
                                        {tab === 'join' && (
                                            <motion.div
                                                key="join-form"
                                                initial={{ opacity: 0, x: 10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className="flex flex-col gap-3"
                                            >
                                                <input
                                                    type="text"
                                                    placeholder="Enter room name"
                                                    value={roomName}
                                                    onChange={e => setRoomName(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleJoin()}
                                                    className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3.5 text-sm text-foreground placeholder:text-white/25 outline-none focus:border-[#ff3b6b]/50 focus:ring-1 focus:ring-[#ff3b6b]/20 transition-all"
                                                />
                                                <button
                                                    onClick={handleJoin}
                                                    disabled={!roomName.trim()}
                                                    className="w-full rounded-xl bg-[#ff3b6b] px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-40 active:scale-[0.98] transition-all shadow-lg shadow-[#ff3b6b]/20 hover:shadow-[#ff3b6b]/30"
                                                >
                                                    Join Room
                                                </button>
                                            </motion.div>
                                        )}

                                        {/* Server API */}
                                        {tab === 'server' && (
                                            <motion.div
                                                key="server-form"
                                                initial={{ opacity: 0, x: 10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className="flex flex-col gap-3"
                                            >
                                                <div className="text-center mb-2 px-2">
                                                    {isNative ? (
                                                        <>
                                                            <p className="text-sm font-medium text-white/80">Host YT-DLP Server</p>
                                                            <p className="text-xs text-white/40 mt-1">Share your phone's native audio extractor directly with your other devices.</p>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <p className="text-sm font-medium text-white/80">YT-DLP Custom Tunnel</p>
                                                            <p className="text-xs text-white/40 mt-1">Connect your private yt-dlp API using a cloudflared tunnel code to bypass proxies.</p>
                                                        </>
                                                    )}
                                                </div>
                                                
                                                {isNative && isHostServer && hostServerCode ? (
                                                    <div className="flex flex-col items-center gap-5 mt-2">
                                                        <a 
                                                            href={activeServerLink}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="bg-white p-4 rounded-2xl shadow-lg hover:scale-105 transition-transform block"
                                                            title="Open server link"
                                                        >
                                                            <QRCodeSVG value={activeServerLink} size={160} />
                                                        </a>
                                                        <div className="text-center w-full space-y-2">
                                                            <p className="text-xs font-medium text-white/40 uppercase tracking-wider">Join Server Code: <span className="text-white font-bold">{hostServerCode}</span></p>
                                                            <div className="flex items-center gap-2 bg-white/[0.04] rounded-xl px-4 py-3 border border-white/[0.06]">
                                                                <a
                                                                    href={activeServerLink}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-sm text-blue-400 hover:underline break-all flex-1 min-w-0"
                                                                >
                                                                    {activeServerLink}
                                                                </a>
                                                                <button
                                                                    onClick={handleCopyLink}
                                                                    className="shrink-0 rounded-lg p-2 text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                                                                >
                                                                    {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={stopHostServer}
                                                            className="w-full flex items-center justify-center gap-2 rounded-xl bg-red-500/8 border border-red-500/10 px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-500/15 active:scale-[0.98] transition-all mt-2"
                                                        >
                                                            <LogOut className="h-4 w-4" />
                                                            Stop Phone Server
                                                        </button>
                                                    </div>
                                                ) : tunnelUrl && !isHostServer ? (
                                                    <div className="flex flex-col gap-3">
                                                        <div className="rounded-xl bg-green-500/10 border border-green-500/20 px-4 py-3 text-sm text-green-400">
                                                            Connected to API code <span className="font-bold text-white">{apiCode}</span>
                                                        </div>
                                                        <div className="text-xs text-white/40 break-all bg-white/[0.04] p-3 rounded-lg border border-white/[0.08]">
                                                            {tunnelUrl}
                                                        </div>
                                                        <button
                                                            onClick={disconnect}
                                                            className="w-full rounded-xl bg-white/[0.08] px-4 py-3.5 text-sm font-semibold text-white hover:bg-white/[0.12] active:scale-[0.98] transition-all"
                                                        >
                                                            Disconnect
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <AnimatePresence>
                                                            {apiError && (
                                                                <motion.div
                                                                    initial={{ opacity: 0, height: 0 }}
                                                                    animate={{ opacity: 1, height: 'auto' }}
                                                                    exit={{ opacity: 0, height: 0 }}
                                                                    className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 mb-1"
                                                                >
                                                                    {apiError}
                                                                </motion.div>
                                                            )}
                                                        </AnimatePresence>
                                                        {isNative ? (
                                                            <button
                                                                onClick={startHostServer}
                                                                disabled={apiStatus === 'connecting'}
                                                                className="w-full rounded-xl bg-blue-500 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 mt-2"
                                                            >
                                                                {apiStatus === 'connecting' && <Loader2 className="h-4 w-4 animate-spin" />}
                                                                {apiStatus === 'connecting' ? 'Starting Server...' : 'Start Phone Server'}
                                                            </button>
                                                        ) : (
                                                            <>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Enter 4-digit code"
                                                                    value={apiCodeInput}
                                                                    onChange={e => setApiCodeInput(e.target.value)}
                                                                    onKeyDown={e => e.key === 'Enter' && connectCode(apiCodeInput)}
                                                                    className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-3.5 text-sm text-foreground placeholder:text-white/25 outline-none focus:border-[#ff3b6b]/50 focus:ring-1 focus:ring-[#ff3b6b]/20 transition-all font-mono tracking-widest text-center text-lg"
                                                                    maxLength={8}
                                                                />
                                                                <button
                                                                    onClick={() => connectCode(apiCodeInput)}
                                                                    disabled={apiStatus === 'connecting' || !apiCodeInput.trim()}
                                                                    className="w-full rounded-xl bg-blue-500 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-40 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
                                                                >
                                                                    {apiStatus === 'connecting' && <Loader2 className="h-4 w-4 animate-spin" />}
                                                                    {apiStatus === 'connecting' ? 'Connecting...' : 'Connect Server'}
                                                                </button>
                                                            </>
                                                        )}
                                                    </>
                                                )}
                                            </motion.div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
