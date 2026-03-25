/**
 * QueuePanel — Right-side panel showing the current queue.
 *
 * Features: Now playing item, upcoming items, drag-to-reorder, clear queue.
 * Rendered inside AppShell's right panel — not an overlay.
 */

import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { getThumbnail } from '@/utils/format';
import { X, Trash2, GripVertical, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DragEndEvent } from '@dnd-kit/core';
import type { QueueItem } from '@/types/player';

export function QueuePanel() {
    const queue = usePlayerStore(s => s.queue);
    const queueIndex = usePlayerStore(s => s.queueIndex);
    const reorderQueue = usePlayerStore(s => s.reorderQueue);
    const clearQueue = usePlayerStore(s => s.clearQueue);
    const setQueueOpen = useUIStore(s => s.setQueueOpen);

    const currentItem = queue[queueIndex];
    const upcomingItems = queue.slice(queueIndex + 1);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = queue.findIndex(q => q.queueId === active.id);
        const newIndex = queue.findIndex(q => q.queueId === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
            reorderQueue(oldIndex, newIndex);
        }
    };

    return (
        <div className="flex flex-col h-full w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 flex-shrink-0 border-b border-white/[0.06]">
                <h2 className="text-base font-bold font-heading">Queue</h2>
                <div className="flex items-center gap-1">
                    {queue.length > 0 && (
                        <button
                            onClick={clearQueue}
                            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
                            title="Clear queue"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                    <button
                        onClick={() => setQueueOpen(false)}
                        className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-4">
                {queue.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4">
                        <p className="text-sm text-muted-foreground">Queue is empty</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Search for songs to add them here</p>
                    </div>
                ) : (
                    <>
                        {/* Now Playing */}
                        {currentItem && (
                            <div className="pt-3 pb-2">
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">Now Playing</p>
                                <QueueItemRow item={currentItem} isCurrent />
                            </div>
                        )}

                        {/* Upcoming */}
                        {upcomingItems.length > 0 && (
                            <div className="pt-2">
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
                                    Next · {upcomingItems.length}
                                </p>
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleDragEnd}
                                >
                                    <SortableContext
                                        items={upcomingItems.map(q => q.queueId)}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        {upcomingItems.map((item) => (
                                            <SortableQueueItem key={item.queueId} item={item} />
                                        ))}
                                    </SortableContext>
                                </DndContext>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function QueueItemRow({ item, isCurrent = false }: { item: QueueItem; isCurrent?: boolean }) {
    const playFromQueue = usePlayerStore(s => s.playFromQueue);
    const removeFromQueue = usePlayerStore(s => s.removeFromQueue);
    const queue = usePlayerStore(s => s.queue);

    const index = queue.findIndex(q => q.queueId === item.queueId);
    const s = item.song as any;
    const thumbnail = s.img || (s.thumbnails ? getThumbnail(s.thumbnails, 60) : '') || `https://i.ytimg.com/vi/${s.videoId || s.id}/mqdefault.jpg`;

    return (
        <div
            className={cn(
                'flex items-center gap-3 px-2 py-2 rounded-lg group transition-colors',
                isCurrent ? 'bg-primary/[0.08]' : 'hover:bg-white/[0.04]'
            )}
        >
            <div className="relative h-10 w-10 rounded-md overflow-hidden flex-shrink-0 ring-1 ring-white/10">
                <img src={thumbnail} alt={s.name || s.title || ''} className="h-full w-full object-cover" loading="lazy" />
            </div>
            <div className="flex-1 min-w-0">
                <p className={cn('text-[13px] font-medium line-clamp-1', isCurrent ? 'text-primary' : 'text-foreground')}>
                    {s.name || s.title}
                </p>
                <p className="text-[11px] text-muted-foreground line-clamp-1">{s.artist?.name || s.author}</p>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {!isCurrent && (
                    <button
                        onClick={() => playFromQueue(index)}
                        className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground"
                    >
                        <Play className="h-3.5 w-3.5" fill="currentColor" />
                    </button>
                )}
                <button
                    onClick={() => removeFromQueue(item.queueId)}
                    className="p-1.5 rounded-full hover:bg-white/10 text-muted-foreground hover:text-destructive"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

function SortableQueueItem({ item }: { item: QueueItem }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: item.queueId,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} className="flex items-center gap-1">
            <button
                {...attributes}
                {...listeners}
                className="p-1 rounded text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
            >
                <GripVertical className="h-4 w-4" />
            </button>
            <div className="flex-1">
                <QueueItemRow item={item} />
            </div>
        </div>
    );
}
