/**
 * ListenAlongModal — Create or Join a listening room.
 *
 * Two-tab dialog (Create / Join):
 * - Create: display name → creates room → shows room code + share link
 * - Join: room code + display name → joins room
 *
 * Renders as a Radix Dialog. Matches existing design system (dark, amber accents, glassmorphism).
 */

import { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Copy, Check, Loader2, Radio, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListenAlongStore } from '@/stores/listenAlongStore';
import { motion, AnimatePresence } from 'framer-motion';

type Tab = 'create' | 'join';

interface ListenAlongModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ListenAlongModal({ open, onOpenChange }: ListenAlongModalProps) {
    const [activeTab, setActiveTab] = useState<Tab>('create');
    const [displayName, setDisplayName] = useState(useListenAlongStore.getState().displayName || '');
    const [roomCode, setRoomCode] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createdCode, setCreatedCode] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const createRoom = useListenAlongStore(s => s.createRoom);
    const joinRoom = useListenAlongStore(s => s.joinRoom);

    const handleCreate = useCallback(async () => {
        if (!displayName.trim()) {
            setError('Enter your name');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            await createRoom(displayName.trim());
            const code = useListenAlongStore.getState().roomCode;
            setCreatedCode(code);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [displayName, createRoom]);

    const handleJoin = useCallback(async () => {
        if (!displayName.trim()) {
            setError('Enter your name');
            return;
        }
        if (!roomCode.trim()) {
            setError('Enter a room code');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            await joinRoom(roomCode.trim().toUpperCase(), displayName.trim());
            onOpenChange(false);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsLoading(false);
        }
    }, [displayName, roomCode, joinRoom, onOpenChange]);

    const handleCopy = useCallback(() => {
        if (!createdCode) return;
        const shareUrl = `${window.location.origin}/room/${createdCode}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [createdCode]);

    const handleDone = useCallback(() => {
        onOpenChange(false);
        setCreatedCode(null);
    }, [onOpenChange]);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-fade-in" />
                <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90vw] max-w-[420px] animate-slide-up">
                    <div className="rounded-2xl border border-white/[0.08] bg-[hsl(240_6%_9%)] shadow-2xl shadow-black/50 overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 pt-5 pb-3">
                            <div className="flex items-center gap-2.5">
                                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15">
                                    <Radio className="h-[18px] w-[18px] text-primary" />
                                </div>
                                <Dialog.Title className="text-lg font-bold font-heading">
                                    Listen Along
                                </Dialog.Title>
                            </div>
                            <Dialog.Close className="p-2 rounded-full hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-colors">
                                <X className="h-4 w-4" />
                            </Dialog.Close>
                        </div>

                        {/* Tabs */}
                        {!createdCode && (
                            <div className="flex mx-5 mb-4 rounded-lg bg-white/[0.04] p-0.5">
                                {(['create', 'join'] as Tab[]).map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => { setActiveTab(tab); setError(null); }}
                                        className={cn(
                                            'flex-1 py-2 text-[13px] font-semibold rounded-md transition-all capitalize',
                                            activeTab === tab
                                                ? 'bg-primary/15 text-primary'
                                                : 'text-muted-foreground hover:text-foreground',
                                        )}
                                    >
                                        {tab === 'create' ? 'Create Room' : 'Join Room'}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Content */}
                        <div className="px-5 pb-5">
                            <AnimatePresence mode="wait">
                                {createdCode ? (
                                    /* Success — show room code */
                                    <motion.div
                                        key="success"
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                        className="flex flex-col items-center gap-4 py-2"
                                    >
                                        <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                                            <Check className="h-4 w-4" />
                                            Room created
                                        </div>
                                        <div className="flex items-center gap-3 bg-white/[0.04] rounded-xl px-5 py-3.5 w-full">
                                            <span className="text-2xl font-bold font-heading tracking-[0.2em] text-foreground flex-1 text-center">
                                                {createdCode}
                                            </span>
                                            <button
                                                onClick={handleCopy}
                                                className="p-2 rounded-lg hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-colors"
                                                title="Copy share link"
                                            >
                                                {copied ? (
                                                    <Check className="h-4 w-4 text-emerald-400" />
                                                ) : (
                                                    <Copy className="h-4 w-4" />
                                                )}
                                            </button>
                                        </div>
                                        <p className="text-xs text-muted-foreground text-center">
                                            Share this code or link with friends to start listening together
                                        </p>
                                        <button
                                            onClick={handleDone}
                                            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:brightness-110 transition-all"
                                        >
                                            Done
                                        </button>
                                    </motion.div>
                                ) : activeTab === 'create' ? (
                                    /* Create Tab */
                                    <motion.div
                                        key="create"
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 10 }}
                                        transition={{ duration: 0.15 }}
                                        className="space-y-3"
                                    >
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                                Your Name
                                            </label>
                                            <input
                                                type="text"
                                                value={displayName}
                                                onChange={e => setDisplayName(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                                placeholder="Enter your name"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
                                                maxLength={30}
                                                autoFocus
                                            />
                                        </div>
                                        <button
                                            onClick={handleCreate}
                                            disabled={isLoading}
                                            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {isLoading ? (
                                                <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
                                            ) : (
                                                <><Users className="h-4 w-4" /> Create Room</>
                                            )}
                                        </button>
                                    </motion.div>
                                ) : (
                                    /* Join Tab */
                                    <motion.div
                                        key="join"
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                        transition={{ duration: 0.15 }}
                                        className="space-y-3"
                                    >
                                        <div>
                                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                                Room Code
                                            </label>
                                            <input
                                                type="text"
                                                value={roomCode}
                                                onChange={e => setRoomCode(e.target.value.toUpperCase())}
                                                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                                                placeholder="e.g. A7X2QP"
                                                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all uppercase tracking-[0.15em] font-heading font-bold text-center text-lg"
                                                maxLength={6}
                                                autoFocus
                                            />
                                        </div>
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
                                            />
                                        </div>
                                        <button
                                            onClick={handleJoin}
                                            disabled={isLoading}
                                            className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {isLoading ? (
                                                <><Loader2 className="h-4 w-4 animate-spin" /> Joining…</>
                                            ) : (
                                                <><Users className="h-4 w-4" /> Join Room</>
                                            )}
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Error */}
                            {error && (
                                <p className="text-destructive text-xs text-center mt-3 animate-fade-in">
                                    {error}
                                </p>
                            )}
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
