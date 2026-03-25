/**
 * VolumeControl — Volume slider with mute toggle.
 * Compact horizontal slider with speaker icon that reflects volume level.
 */

import * as Slider from '@radix-ui/react-slider';
import { usePlayerStore } from '@/stores/playerStore';
import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react';

export function VolumeControl() {
    const volume = usePlayerStore(s => s.volume);
    const isMuted = usePlayerStore(s => s.isMuted);
    const setVolume = usePlayerStore(s => s.setVolume);
    const toggleMute = usePlayerStore(s => s.toggleMute);

    const effectiveVolume = isMuted ? 0 : volume;

    const VolumeIcon =
        isMuted || effectiveVolume === 0
            ? VolumeX
            : effectiveVolume < 0.33
                ? Volume
                : effectiveVolume < 0.66
                    ? Volume1
                    : Volume2;

    return (
        <div className="flex items-center gap-1 group">
            <button
                onClick={toggleMute}
                className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-all"
                title="Mute (M)"
            >
                <VolumeIcon className="h-4 w-4" />
            </button>

            <div className="w-0 overflow-hidden group-hover:w-24 transition-all duration-300">
                <Slider.Root
                    className="relative flex items-center w-24 h-5 cursor-pointer select-none touch-none"
                    value={[effectiveVolume * 100]}
                    max={100}
                    step={1}
                    onValueChange={(val) => setVolume(val[0] / 100)}
                >
                    <Slider.Track className="relative h-1 w-full rounded-full bg-muted">
                        <Slider.Range className="absolute h-full rounded-full bg-foreground" />
                    </Slider.Track>
                    <Slider.Thumb className="block h-3 w-3 rounded-full bg-white shadow-sm focus:outline-none" />
                </Slider.Root>
            </div>
        </div>
    );
}
