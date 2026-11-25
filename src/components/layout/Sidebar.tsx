/**
 * Sidebar — Desktop left navigation.
 * Reference-matched: clean navigation with icon + label, no distracting footer.
 * Width: 220px fixed. Navigation items follow F-pattern reading.
 */

import { NavLink } from 'react-router-dom';
import { Home, Search, Heart, ListMusic, Settings } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { cn } from '@/lib/utils';
import { useCatalogStore } from '@/stores/catalogStore';

const NAV_ITEMS = [
    { to: '/', icon: Home, label: 'Home' },
    { to: '/search', icon: Search, label: 'Search' },
    { to: '/favorites', icon: Heart, label: 'Favorites' },
    { to: '/queue', icon: ListMusic, label: 'Queue' },
] as const;

export function Sidebar() {
    return (
        <aside className="flex flex-col h-full w-[220px] bg-[hsl(240_6%_6%)] border-r border-white/[0.06]">
            {/* ─── Logo ─── */}
            <div className="flex items-center gap-2.5 px-5 h-16 flex-shrink-0">
                <BrandLogo className="size-8" />
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

            <div className="mt-4 px-3">
                <button
                    type="button"
                    onClick={() => useCatalogStore.getState().openSettings()}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium text-muted-foreground hover:bg-white/[0.04] hover:text-foreground transition-colors"
                >
                    <Settings className="size-[18px] shrink-0" />
                    Settings
                </button>
            </div>

            {/* ─── Spacer + branding ─── */}
            <div className="flex-1" />
            <div className="px-5 py-4 text-[10px] text-muted-foreground/40">
                M14U · {new Date().getFullYear()}
            </div>
        </aside>
    );
}
