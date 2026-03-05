/**
 * Sidebar — Desktop left navigation.
 * Reference-matched: clean navigation with icon + label, no distracting footer.
 * Width: 220px fixed. Navigation items follow F-pattern reading.
 */

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Search, Heart, ListMusic, Music2, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListenAlongStore } from '@/stores/listenAlongStore';
import { useUIStore } from '@/stores/uiStore';
import { ListenAlongModal } from '@/components/listenAlong/ListenAlongModal';

const NAV_ITEMS = [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/search', icon: Search, label: 'Search' },
    { to: '/favorites', icon: Heart, label: 'Library' },
    { to: '/queue', icon: ListMusic, label: 'Queue' },
] as const;

export function Sidebar() {
    const [showModal, setShowModal] = useState(false);
    const isInRoom = useListenAlongStore(s => s.isInRoom);
    const toggleRoomPanel = useUIStore(s => s.toggleRoomPanel);

    const handleListenAlong = () => {
        if (isInRoom) {
            toggleRoomPanel();
        } else {
            setShowModal(true);
        }
    };

    return (
        <>
            <aside className="flex flex-col h-full w-[220px] bg-[hsl(240_6%_6%)] border-r border-white/[0.06]">
                {/* ─── Logo ─── */}
                <div className="flex items-center gap-2.5 px-5 h-16 flex-shrink-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
                        <Music2 className="h-[18px] w-[18px] text-primary" />
                    </div>
                    <span className="text-base font-bold font-heading tracking-tight text-foreground">
                        M14U
                    </span>
                </div>

                {/* ─── Navigation ─── */}
                <nav className="flex flex-col gap-0.5 px-3 mt-2">
                    {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
                        <NavLink
                            key={to}
                            to={to}
                            end={to === '/'}
                            className={({ isActive }) =>
                                cn(
                                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-medium transition-all duration-150',
                                    isActive
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                                )
                            }
                        >
                            <Icon className="h-[18px] w-[18px] flex-shrink-0" />
                            {label}
                        </NavLink>
                    ))}
                </nav>

                {/* ─── Listen Along ─── */}
                <div className="px-3 mt-4">
                    <button
                        onClick={handleListenAlong}
                        className={cn(
                            'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-[14px] font-medium transition-all duration-150',
                            isInRoom
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]'
                        )}
                    >
                        <div className="relative">
                            <Radio className="h-[18px] w-[18px] flex-shrink-0" />
                            {isInRoom && (
                                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                            )}
                        </div>
                        Listen Along
                    </button>
                </div>

                {/* ─── Spacer + branding ─── */}
                <div className="flex-1" />
                <div className="px-5 py-4 text-[10px] text-muted-foreground/40">
                    M14U · {new Date().getFullYear()}
                </div>
            </aside>

            <ListenAlongModal open={showModal} onOpenChange={setShowModal} />
        </>
    );
}
