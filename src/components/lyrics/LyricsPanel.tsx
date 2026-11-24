import { MicOff, X } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';

interface LyricsPanelProps {
    embedded?: boolean;
    onClose?: () => void;
}

export function LyricsPanel({ embedded = false, onClose }: LyricsPanelProps) {
    const song = usePlayerStore(s => s.currentSong);
    const setLyricsOpen = useUIStore(s => s.setLyricsOpen);
    if (!song) return null;

    // The Saavn catalog does not expose lyrics.
    return (
        <div className="flex h-full w-full flex-col">
            {(!embedded || onClose) && (
                <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-4">
                    <h2 className="font-heading text-base font-bold">Lyrics</h2>
                    <button
                        type="button"
                        onClick={onClose ?? (() => setLyricsOpen(false))}
                        className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                        aria-label="Close lyrics"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center text-muted-foreground">
                <MicOff aria-hidden="true" className="h-8 w-8" />
                <p className="text-sm">Lyrics are unavailable for this track.</p>
            </div>
        </div>
    );
}
