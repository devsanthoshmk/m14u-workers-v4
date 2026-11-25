import { Search } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { Link } from 'react-router-dom';
import { usePlayerStore } from '@/stores/playerStore';
import { SongCard } from '@/components/song/SongCard';
import { matchesCatalog, useCatalogStore } from '@/stores/catalogStore';

export function HomePage() {
    const history = usePlayerStore(s => s.listeningHistory);
    const setQueue = usePlayerStore(s => s.setQueue);
    const provider = useCatalogStore(s => s.provider);
    const recent = history.filter(({ song }) => matchesCatalog(provider, song.id)).slice(0, 8);

    return (
        <div className="mx-auto w-full max-w-6xl px-5 py-7 md:px-8 md:py-10">
            <h1 className="flex items-center gap-3 text-3xl font-bold md:text-4xl">
                <BrandLogo className="size-8 md:hidden" alt="M14U" />
                Home
            </h1>
            {recent.length > 0 ? (
                <section className="mt-8" aria-labelledby="recently-played">
                    <h2 id="recently-played" className="mb-3 text-lg font-semibold">Recently played</h2>
                    <div className="-mx-2 grid grid-cols-2 gap-y-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {recent.map(({ song }, index) => (
                            <SongCard key={song.id} song={song} index={index} highQualityArtwork onPlay={() => void setQueue([song])} />
                        ))}
                    </div>
                </section>
            ) : (
                <section className="mt-8 border-t border-border py-8 md:py-12" aria-labelledby="start-listening">
                    <h2 id="start-listening" className="text-xl font-semibold">Start listening</h2>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                        Find a song you love. Tracks you play will show up here so you can find them again.
                    </p>
                    <Link to="/search" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                        <Search className="size-4" aria-hidden="true" /> Search music
                    </Link>
                </section>
            )}
        </div>
    );
}
