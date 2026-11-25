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
import { ResizeHandle } from './ResizeHandle';
import { MobileNav } from './MobileNav';
import { CatalogDialog } from './CatalogDialog';
import { useCatalogStore } from '@/stores/catalogStore';
import { PlayerBar } from '@/components/player/PlayerBar';
import { QueuePanel } from '@/components/queue/QueuePanel';
import { LyricsPanel } from '@/components/lyrics/LyricsPanel';
import { clampPanelWidth, PANEL_WIDTHS, useUIStore } from '@/stores/uiStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useMediaSession } from '@/hooks/useMediaSession';
import { usePlayerStore } from '@/stores/playerStore';
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
    const sidebarWidth = useUIStore(s => s.sidebarWidth);
    const rightPanelWidth = useUIStore(s => s.rightPanelWidth);
    const setSidebarWidth = useUIStore(s => s.setSidebarWidth);
    const setRightPanelWidth = useUIStore(s => s.setRightPanelWidth);
    const currentSong = usePlayerStore(s => s.currentSong);

    const [viewportWidth, setViewportWidth] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth : 1280
    );
    const [isResizingRight, setIsResizingRight] = useState(false);

    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const isNowPlaying = location.pathname === '/now-playing';
    const showRightPanel = !isNowPlaying && (isQueueOpen || isLyricsOpen) && !!currentSong;
    const isKeepAliveRoute = ['/', '/search', '/favorites'].includes(location.pathname);

    const availableForPanels = Math.max(0, viewportWidth - PANEL_WIDTHS.MAIN_MIN);
    const effectiveSidebarWidth = clampPanelWidth(
        sidebarWidth,
        PANEL_WIDTHS.SIDEBAR_MIN,
        Math.min(
            PANEL_WIDTHS.SIDEBAR_MAX,
            Math.max(PANEL_WIDTHS.SIDEBAR_MIN, availableForPanels - (showRightPanel ? PANEL_WIDTHS.RIGHT_MIN : 0))
        )
    );
    const effectiveRightWidth = clampPanelWidth(
        rightPanelWidth,
        PANEL_WIDTHS.RIGHT_MIN,
        Math.min(
            PANEL_WIDTHS.RIGHT_MAX,
            Math.max(PANEL_WIDTHS.RIGHT_MIN, availableForPanels - effectiveSidebarWidth)
        )
    );
    const sidebarMaxForDrag = Math.min(
        PANEL_WIDTHS.SIDEBAR_MAX,
        Math.max(PANEL_WIDTHS.SIDEBAR_MIN, availableForPanels - (showRightPanel ? effectiveRightWidth : 0))
    );
    const rightMaxForDrag = Math.min(
        PANEL_WIDTHS.RIGHT_MAX,
        Math.max(PANEL_WIDTHS.RIGHT_MIN, availableForPanels - effectiveSidebarWidth)
    );

    useEffect(() => {
        useCatalogStore.getState().showIntro();
    }, []);

    const rightPanelKey = isQueueOpen ? 'queue' : 'lyrics';

    return (
        <>
            <CatalogDialog />

            <div className="flex h-dvh w-full flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
                <div className="flex flex-1 overflow-hidden">
                    {/* Desktop sidebar */}
                    <div
                        style={{ width: effectiveSidebarWidth }}
                        className="relative hidden md:block flex-shrink-0"
                    >
                        <Sidebar />
                        <ResizeHandle
                            side="left"
                            width={effectiveSidebarWidth}
                            defaultWidth={PANEL_WIDTHS.SIDEBAR_DEFAULT}
                            minWidth={PANEL_WIDTHS.SIDEBAR_MIN}
                            maxWidth={sidebarMaxForDrag}
                            label="Resize navigation sidebar"
                            onWidthChange={setSidebarWidth}
                        />
                    </div>

                    {/* Main content area */}
                    <main className="relative min-w-0 flex-1 overflow-hidden">
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
                                animate={{ width: effectiveRightWidth, opacity: 1 }}
                                exit={{ width: 0, opacity: 0 }}
                                transition={isResizingRight ? { duration: 0 } : { duration: 0.25, ease: 'easeInOut' }}
                                className="relative hidden md:flex flex-col flex-shrink-0 border-l border-white/[0.06] bg-[hsl(240_6%_7%)] overflow-hidden"
                            >
                                <ResizeHandle
                                    side="right"
                                    width={effectiveRightWidth}
                                    defaultWidth={PANEL_WIDTHS.RIGHT_DEFAULT}
                                    minWidth={PANEL_WIDTHS.RIGHT_MIN}
                                    maxWidth={rightMaxForDrag}
                                    label={isQueueOpen ? 'Resize queue panel' : 'Resize lyrics panel'}
                                    onWidthChange={setRightPanelWidth}
                                    onResizeStateChange={setIsResizingRight}
                                />
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
