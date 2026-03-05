/**
 * Mobile bottom navigation.
 * Psychology: Bottom nav is within thumb reach (Thumb Zone UX).
 * Icons + labels because icon-only nav has 20%+ lower tap accuracy.
 */

import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, Search, Heart, ListMusic, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useListenAlongStore } from '@/stores/listenAlongStore';
import { useUIStore } from '@/stores/uiStore';
import { ListenAlongModal } from '@/components/listenAlong/ListenAlongModal';

const NAV_ITEMS = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/search', label: 'Search', icon: Search },
    { to: '/favorites', label: 'Favorites', icon: Heart },
    { to: '/queue', label: 'Queue', icon: ListMusic },
];

export function MobileNav() {
    const location = useLocation();
    const isInRoom = useListenAlongStore(s => s.isInRoom);
    const toggleRoomPanel = useUIStore(s => s.toggleRoomPanel);
    const isRoomPanelOpen = useUIStore(s => s.isRoomPanelOpen);
    const [showModal, setShowModal] = useState(false);

    const handleListenAlong = () => {
        if (isInRoom) {
            toggleRoomPanel();
        } else {
            setShowModal(true);
        }
    };

    return (
        <>
            <nav className="flex items-center justify-around border-t border-border/50 bg-card/80 glass px-1 pb-[env(safe-area-inset-bottom)]">
                {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
                    const isActive = location.pathname === to;
                    return (
                        <NavLink
                            key={to}
                            to={to}
                            className={cn(
                                'flex flex-col items-center gap-0.5 py-2 px-3 text-[10px] font-medium transition-colors min-w-[60px]',
                                isActive ? 'text-primary' : 'text-muted-foreground'
                            )}
                        >
                            <Icon className={cn('h-5 w-5', isActive && 'text-primary')} strokeWidth={isActive ? 2.5 : 2} />
                            <span>{label}</span>
                        </NavLink>
                    );
                })}

                {/* Always show Listen Along button */}
                <button
                    onClick={handleListenAlong}
                    className={cn(
                        'flex flex-col items-center gap-0.5 py-2 px-3 text-[10px] font-medium transition-colors min-w-[60px]',
                        (isInRoom && isRoomPanelOpen) ? 'text-primary' : isInRoom ? 'text-emerald-400' : 'text-muted-foreground'
                    )}
                >
                    <div className="relative">
                        <Radio
                            className={cn('h-5 w-5', (isInRoom && isRoomPanelOpen) && 'text-primary')}
                            strokeWidth={(isInRoom && isRoomPanelOpen) ? 2.5 : 2}
                        />
                        {isInRoom && (
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                    </div>
                    <span>{isInRoom ? 'Room' : 'Listen'}</span>
                </button>
            </nav>

            <ListenAlongModal open={showModal} onOpenChange={setShowModal} />
        </>
    );
}
