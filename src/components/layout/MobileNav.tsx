/**
 * Mobile bottom navigation.
 * Psychology: Bottom nav is within thumb reach (Thumb Zone UX).
 * 4 destinations evenly spread across the width.
 */

import { NavLink, useLocation } from 'react-router-dom';
import { Home, Search, Heart, ListMusic } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/search', label: 'Search', icon: Search },
    { to: '/favorites', label: 'Favorites', icon: Heart },
    { to: '/queue', label: 'Queue', icon: ListMusic },
];

export function MobileNav() {
    const location = useLocation();

    return (
        <nav aria-label="Mobile navigation" className="grid grid-cols-4 items-center border-t border-border/50 bg-card/80 glass px-1 pb-[env(safe-area-inset-bottom)]">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
                const isActive = location.pathname === to;
                return (
                    <NavLink
                        key={to}
                        to={to}
                        className={cn(
                            'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors w-full',
                            isActive ? 'text-primary' : 'text-muted-foreground'
                        )}
                    >
                        <Icon className={cn('h-5 w-5', isActive && 'text-primary')} strokeWidth={isActive ? 2.5 : 2} />
                        <span>{label}</span>
                    </NavLink>
                );
            })}
        </nav>
    );
}
