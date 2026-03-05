/**
 * AppShell — Root layout wrapper.
 * Desktop: Sidebar(220px) + Content + RightPanel(Queue/Lyrics/Room) + PlayerBar
 * Mobile: Content + MobileNav + PlayerBar + Room bottom drawer
 *
 * Psychology: Spatial consistency — users always know where everything lives.
 * The right-side panel (queue/lyrics/room) keeps the main content visible while
 * providing contextual info — no jarring modal or overlay.
 */

import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { PlayerBar } from '@/components/player/PlayerBar';
import { QueuePanel } from '@/components/queue/QueuePanel';
import { LyricsPanel } from '@/components/lyrics/LyricsPanel';
import { RoomPanel } from '@/components/listenAlong/RoomPanel';
import { useUIStore } from '@/stores/uiStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMediaSession } from '@/hooks/useMediaSession';
import { usePlayerStore } from '@/stores/playerStore';
import { useListenAlongStore } from '@/stores/listenAlongStore';
import { OnboardingModal } from '@/components/onboarding/OnboardingModal';
import { AnimatePresence, motion } from 'framer-motion';
import { Radio, Loader2 } from 'lucide-react';

import { HomePage } from '@/pages/HomePage';
import { SearchPage } from '@/pages/SearchPage';
import { FavoritesPage } from '@/pages/FavoritesPage';

function KeepAliveRoute({ path, children }: { path: string; children: React.ReactNode }) {
    const location = useLocation();
    const isActive = location.pathname === path;
    const [isMounted, setIsMounted] = useState(isActive);

    if (isActive && !isMounted) {
        setIsMounted(true);
    }

    if (!isMounted) return null;

    return (
        <div style={{ display: isActive ? 'block' : 'none' }} className="h-full w-full overflow-y-auto scrollbar-thin">
            {children}
        </div>
    );
}

export function AppShell() {
    useKeyboardShortcuts();
    useMediaSession();

    const location = useLocation();
    const isQueueOpen = useUIStore(s => s.isQueueOpen);
    const isLyricsOpen = useUIStore(s => s.isLyricsOpen);
    const isRoomPanelOpen = useUIStore(s => s.isRoomPanelOpen);
    const setRoomPanelOpen = useUIStore(s => s.setRoomPanelOpen);
    const onboardingDone = useUIStore(s => s.onboardingDone);
    const currentSong = usePlayerStore(s => s.currentSong);
    const isInRoom = useListenAlongStore(s => s.isInRoom);
    const isRestoring = useListenAlongStore(s => s.isRestoring);

    // Show right panel: queue/lyrics need a song playing, room panel is always available when in a room
    const showRightPanel = ((isQueueOpen || isLyricsOpen) && !!currentSong) || (isRoomPanelOpen && isInRoom);
    const isKeepAliveRoute = ['/', '/search', '/favorites'].includes(location.pathname);

    // Determine which panel to show in desktop sidepanel
    const rightPanelKey = isRoomPanelOpen ? 'room' : isQueueOpen ? 'queue' : 'lyrics';

    // Mobile room drawer is open when in a room and room panel is toggled
    const showMobileRoomDrawer = isInRoom && isRoomPanelOpen;

    return (
        <>
            {!onboardingDone && <OnboardingModal />}

            {/* Session restoring overlay — shows briefly on reload when reconnecting to a room */}
            <AnimatePresence>
                {isRestoring && (
                    <motion.div
                        key="restoring"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm"
                    >
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
                            <Radio className="h-7 w-7 text-primary" />
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Reconnecting to your room…
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
                <div className="flex flex-1 overflow-hidden">
                    {/* ─── Desktop sidebar ─── */}
                    <div className="hidden md:block flex-shrink-0">
                        <Sidebar />
                    </div>

                    {/* ─── Main content area ─── */}
                    <main className="flex-1 overflow-hidden relative">
                        <KeepAliveRoute path="/">
                            <HomePage />
                        </KeepAliveRoute>
                        <KeepAliveRoute path="/search">
                            <SearchPage />
                        </KeepAliveRoute>
                        <KeepAliveRoute path="/favorites">
                            <FavoritesPage />
                        </KeepAliveRoute>

                        <div
                            style={{ display: isKeepAliveRoute ? 'none' : 'block' }}
                            className="h-full w-full overflow-y-auto scrollbar-thin"
                        >
                            <Outlet />
                        </div>
                    </main>

                    {/* ─── Right panel: Queue OR Lyrics OR Room (desktop only) ─── */}
                    <AnimatePresence mode="wait">
                        {showRightPanel && (
                            <motion.aside
                                key={rightPanelKey}
                                initial={{ width: 0, opacity: 0 }}
                                animate={{ width: 340, opacity: 1 }}
                                exit={{ width: 0, opacity: 0 }}
                                transition={{ duration: 0.25, ease: 'easeInOut' }}
                                className="hidden md:flex flex-col flex-shrink-0 border-l border-white/[0.06] bg-[hsl(240_6%_7%)] overflow-hidden"
                            >
                                {isRoomPanelOpen ? <RoomPanel /> : isQueueOpen ? <QueuePanel /> : <LyricsPanel />}
                            </motion.aside>
                        )}
                    </AnimatePresence>
                </div>

                {/* ─── Player bar ─── */}
                {currentSong && location.pathname !== '/now-playing' && <PlayerBar />}

                {/* ─── Mobile bottom nav ─── */}
                {location.pathname !== '/now-playing' && (
                    <div className="block md:hidden">
                        <MobileNav />
                    </div>
                )}
            </div>

            {/* ─── Mobile Room Panel Bottom Drawer ─── */}
            <AnimatePresence>
                {showMobileRoomDrawer && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            key="room-backdrop"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
                            onClick={() => setRoomPanelOpen(false)}
                        />
                        {/* Drawer slides up from bottom */}
                        <motion.div
                            key="room-drawer"
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                            className="fixed bottom-0 left-0 right-0 z-50 md:hidden rounded-t-2xl bg-[hsl(240_6%_8%)] border-t border-white/[0.08] overflow-hidden"
                            style={{ maxHeight: '80dvh' }}
                        >
                            {/* Drag handle */}
                            <div className="flex justify-center pt-2.5 pb-1">
                                <div className="h-1 w-10 rounded-full bg-white/20" />
                            </div>
                            <div className="overflow-y-auto scrollbar-thin" style={{ maxHeight: 'calc(80dvh - 20px)' }}>
                                <RoomPanel />
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
