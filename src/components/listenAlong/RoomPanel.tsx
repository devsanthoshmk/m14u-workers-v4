/**
 * RoomPanel — Coming Soon placeholder.
 * 
 * This feature will be re-enabled with a new architecture in the future.
 */

import { X, Radio } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

export function RoomPanel() {
    const setRoomPanelOpen = useUIStore(s => s.setRoomPanelOpen);

    return (
        <div className="flex flex-col h-full w-full items-center justify-center p-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 mb-4">
                <Radio className="h-8 w-8 text-amber-500" />
            </div>
            
            <h2 className="text-lg font-bold text-foreground mb-2">
                Listen Along
            </h2>
            
            <p className="text-sm text-muted-foreground mb-4">
                Coming Soon
            </p>

            <button
                onClick={() => setRoomPanelOpen(false)}
                className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground"
                aria-label="Close"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
