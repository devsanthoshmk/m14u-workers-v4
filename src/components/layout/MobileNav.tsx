/**
 * Mobile bottom navigation.
 * Psychology: Bottom nav is within thumb reach (Thumb Zone UX).
 * Icons + labels because icon-only nav has 20%+ lower tap accuracy.
 */

import { NavLink, useLocation } from 'react-router-dom';
import { Home, Search, Heart, ListMusic, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isNative } from '@/lib/utils/platform';
import { useCatalogStore } from '@/stores/catalogStore';

const NAV_ITEMS = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/search', label: 'Search', icon: Search },
    { to: '/favorites', label: 'Favorites', icon: Heart },
    { to: '/queue', label: 'Queue', icon: ListMusic },
];

export function MobileNav() {
    const location = useLocation();

    return (
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

            {!isNative() && <button type="button" onClick={() => useCatalogStore.getState().openSettings()}
                className="flex min-w-[60px] flex-col items-center gap-0.5 px-2 py-2 text-[10px] font-medium text-muted-foreground">
                <Settings className="h-5 w-5" />
                <span>Settings</span>
            </button>}
        </nav>
    );
}
