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
import { ListenAlongModal } from '@/components/listenAlong/ListenAlongModal';

const NAV_ITEMS = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/search', label: 'Search', icon: Search },
    { to: '/favorites', label: 'Favorites', icon: Heart },
    { to: '/queue', label: 'Queue', icon: ListMusic },
];

export function MobileNav() {
    const location = useLocation();
    const [modalOpen, setModalOpen] = useState(false);
    const isInRoom = useListenAlongStore(s => s.isInRoom);
    const connectionStatus = useListenAlongStore(s => s.connectionStatus);

    const handleListenAlongClick = () => {
        setModalOpen(true);
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

                {/* Listen Along */}
                <button
                    onClick={handleListenAlongClick}
                    className={cn(
                        'flex flex-col items-center gap-0.5 py-2 px-3 text-[10px] font-medium transition-colors min-w-[60px]',
                        isInRoom ? 'text-[#ff3b6b]' : 'text-muted-foreground'
                    )}
                >
                    <div className="relative">
                        <Radio className="h-5 w-5" strokeWidth={2} />
                        {isInRoom && connectionStatus === 'connected' && (
                            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                        )}
                    </div>
                    <span>Listen</span>
                </button>
            </nav>

            <ListenAlongModal open={modalOpen} onOpenChange={setModalOpen} />
        </>
    );
}
