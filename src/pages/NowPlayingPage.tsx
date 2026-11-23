import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Copy, Heart, ListMusic, Mic2, Music2 } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { getThumbnail, formatDuration } from '@/utils/format';
import { ProgressBar } from '@/components/player/ProgressBar';
import { PlayerControls } from '@/components/player/PlayerControls';
import { LyricsPanel } from '@/components/lyrics/LyricsPanel';
import { SleepTimerButton } from '@/components/player/SleepTimer';
import { cn } from '@/lib/utils';

const iconButton = 'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-secondary-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function NowPlayingPage() {
    const navigate = useNavigate();
    const currentSong = usePlayerStore(s => s.currentSong);
    const currentTime = usePlayerStore(s => s.currentTime);
    const duration = usePlayerStore(s => s.duration);
    const isFavorite = usePlayerStore(s => currentSong ? s.isFavorite(currentSong.id || currentSong.videoId || '') : false);
    const toggleFavorite = usePlayerStore(s => s.toggleFavorite);
    const [showLyrics, setShowLyrics] = useState(false);
    const [copyStatus, setCopyStatus] = useState('');

    function closePlayer() {
        // BrowserRouter starts its app history index at zero, including on direct entry.
        if (window.history.state?.idx > 0) navigate(-1);
        else navigate('/', { replace: true });
    }

    async function copyListenAlongState() {
        setCopyStatus('');
        try {
            const state = usePlayerStore.getState().exportState();
            await navigator.clipboard.writeText(JSON.stringify(state));
            setCopyStatus('Playback state copied.');
        } catch {
            setCopyStatus('Couldn’t copy playback state. Check clipboard permissions and try again.');
        }
    }

    const songId = currentSong?.videoId || currentSong?.id;
    const title = currentSong?.name || currentSong?.title || 'Untitled track';
    const artist = currentSong?.artist?.name || currentSong?.author || 'Unknown artist';
    const album = currentSong?.album?.name;
    const art = (currentSong?.thumbnails && getThumbnail(currentSong.thumbnails, 544)) || currentSong?.img
        || (songId ? `https://i.ytimg.com/vi/${songId}/mqdefault.jpg` : '');

    return (
        <section
            aria-label="Now playing"
            className="relative flex h-full flex-col isolate overflow-hidden bg-background"
            onKeyDown={event => {
                // Native button and slider keys must win over app-wide playback shortcuts.
                const target = event.target as HTMLElement;
                if ((event.code === 'Space' && target.closest('button')) || target.closest('[role="slider"]')) {
                    event.stopPropagation();
                }
            }}
        >
            {art && <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
                <img key={art} src={art} alt="" onError={event => { event.currentTarget.hidden = true; }} className="h-full w-full scale-110 object-cover opacity-25 blur-3xl" />
                <div className="absolute inset-0 bg-gradient-to-b from-background/40 to-background" />
            </div>}

            <header className="mx-auto flex w-full max-w-6xl shrink-0 items-center gap-3 px-4 py-2 sm:px-8 sm:py-4">
                <button type="button" onClick={closePlayer} className={iconButton} aria-label="Close Now Playing" title="Close Now Playing">
                    <ChevronDown className="size-6" aria-hidden="true" />
                </button>
                <p className="min-w-0 flex-1 font-heading text-sm font-semibold">Now playing</p>
                {currentSong && <button type="button" onClick={() => navigate('/queue')} className={iconButton} aria-label="Open queue" title="Open queue">
                    <ListMusic className="size-5" aria-hidden="true" />
                </button>}
            </header>

            {currentSong ? (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
                    <div className="mx-auto grid min-h-full w-full max-w-6xl content-center items-center justify-items-center gap-6 px-6 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 sm:pt-5 landscape:sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] landscape:sm:gap-8 landscape:lg:gap-16">
                        <div className={cn('relative w-full max-w-[26rem] overflow-hidden rounded-lg bg-card shadow-2xl shadow-black/40',
                            showLyrics ? 'h-[clamp(15rem,45dvh,26rem)] landscape:sm:h-auto landscape:sm:aspect-square' : 'aspect-square max-w-[min(26rem,48dvh)] landscape:sm:max-w-[29rem]')}>
                            {showLyrics ? <LyricsPanel embedded /> : <>
                                <div className="absolute inset-0 grid place-items-center text-muted-foreground" aria-hidden="true">
                                    <Music2 className="size-14" strokeWidth={1} />
                                </div>
                                {art && <img key={art} src={art} alt={`Cover art for ${album || title}`} className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.hidden = true; }} />}
                            </>}
                        </div>

                        <div className="w-full min-w-0 max-w-[26rem]">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h1 className="break-words font-heading text-[clamp(1.5rem,4vw,3.5rem)] font-bold leading-tight tracking-tight">{title}</h1>
                                    <p className="mt-2 break-words text-base text-secondary-foreground sm:text-lg">{artist}</p>
                                    {album && <p className="mt-1 break-words text-sm text-muted-foreground">{album}</p>}
                                </div>
                                <button type="button" onClick={() => toggleFavorite(currentSong)} className={cn(iconButton, isFavorite && 'text-primary hover:text-primary')} aria-label="Favorite" aria-pressed={isFavorite} title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
                                    <Heart className={cn('size-6', isFavorite && 'fill-current')} aria-hidden="true" />
                                </button>
                            </div>

                            <div className="mt-4 sm:mt-6">
                                <ProgressBar />
                                <div className="flex justify-between text-xs text-secondary-foreground tabular-nums">
                                    <span>{formatDuration(currentTime)}</span>
                                    <span>{formatDuration(duration)}</span>
                                </div>
                            </div>

                            <div className="mt-3 sm:mt-5"><PlayerControls layout="full" /></div>

                            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-foreground/10 pt-3 sm:mt-6">
                                <button type="button" onClick={() => setShowLyrics(!showLyrics)} aria-pressed={showLyrics} className={cn('inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-secondary-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', showLyrics && 'text-primary')}>
                                    <Mic2 className="size-4" aria-hidden="true" /> Lyrics
                                </button>
                                <button type="button" onClick={copyListenAlongState} title="Copy playback state for Listen Along" className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-secondary-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                                    <Copy className="size-4" aria-hidden="true" /> Copy playback state
                                </button>
                                <SleepTimerButton />
                            </div>
                            <p role="status" className={cn('text-sm text-secondary-foreground', copyStatus ? 'mt-2' : 'sr-only')}>{copyStatus}</p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-8 text-center">
                    <div>
                        <Music2 className="mx-auto mb-4 size-9 text-primary" aria-hidden="true" />
                        <h1 className="font-heading text-2xl font-bold">Nothing is playing</h1>
                        <p className="mt-2 text-secondary-foreground">Pick a track to start listening.</p>
                        <button type="button" onClick={() => navigate('/search', { replace: true })} className="mt-5 min-h-11 rounded-full bg-primary px-5 font-semibold text-primary-foreground hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Find music</button>
                    </div>
                </div>
            )}
        </section>
    );
}
