/**
 * AppShell — Root layout wrapper.
 * Desktop: Sidebar(220px) + Content + RightPanel(Queue/Lyrics) + PlayerBar
 * Mobile: Content + MobileNav + PlayerBar
 *
 * Psychology: Spatial consistency — users always know where everything lives.
 */

import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { PlayerBar } from '@/components/player/PlayerBar';
import { QueuePanel } from '@/components/queue/QueuePanel';
import { LyricsPanel } from '@/components/lyrics/LyricsPanel';
import { useUIStore } from '@/stores/uiStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMediaSession } from '@/hooks/useMediaSession';
import { usePlayerStore } from '@/stores/playerStore';
import { OnboardingModal } from '@/components/onboarding/OnboardingModal';
import { routerRef } from '@/lib/testing/router-ref';
import { AnimatePresence, motion } from 'framer-motion';

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

    const navigate = useNavigate();
    const location = useLocation();

    // Set router ref for console testing API
    useEffect(() => {
        routerRef.set(navigate, location);
    }, [navigate, location]);
    const isQueueOpen = useUIStore(s => s.isQueueOpen);
    const isLyricsOpen = useUIStore(s => s.isLyricsOpen);
    const onboardingDone = useUIStore(s => s.onboardingDone);
    const currentSong = usePlayerStore(s => s.currentSong);

    const showRightPanel = (isQueueOpen || isLyricsOpen) && !!currentSong;
    const isKeepAliveRoute = ['/', '/search', '/favorites'].includes(location.pathname);

    const rightPanelKey = isQueueOpen ? 'queue' : 'lyrics';

    return (
        <>
            {!onboardingDone && <OnboardingModal />}

            <div className="flex h-dvh w-full flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
                <div className="flex flex-1 overflow-hidden">
                    {/* Desktop sidebar */}
                    <div className="hidden md:block flex-shrink-0">
                        <Sidebar />
                    </div>

                    {/* Main content area */}
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

                    {/* Right panel: Queue OR Lyrics (desktop only) */}
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
                                {isQueueOpen ? <QueuePanel /> : <LyricsPanel />}
                            </motion.aside>
                        )}
                    </AnimatePresence>
                </div>

                {/* Player bar */}
                {currentSong && location.pathname !== '/now-playing' && <PlayerBar />}

                {/* Mobile bottom nav */}
                {location.pathname !== '/now-playing' && (
                    <div className="block md:hidden">
                        <MobileNav />
                    </div>
                )}
            </div>
        </>
    );
}
