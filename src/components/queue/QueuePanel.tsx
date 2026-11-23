/**
 * QueuePanel — Right-side panel showing the current queue.
 *
 * Features: Now playing item, upcoming items, played history, drag-to-reorder, clear queue.
 * Rendered inside AppShell's right panel — not an overlay.
 */

import { useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePlayerStore } from '@/stores/playerStore';
import { useUIStore } from '@/stores/uiStore';
import { getThumbnail } from '@/utils/format';
import { X, Trash2, GripVertical, Play, ChevronLeft, ListMusic } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    DndContext,
    closestCenter,
    pointerWithin,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CollisionDetection, DragEndEvent } from '@dnd-kit/core';
import type { QueueItem } from '@/types/player';

const iconButton = 'inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
const nowPlayingDropId = 'now-playing-drop';
const upcomingEndDropId = 'upcoming-end-drop';

export function QueuePanel({ fullPage = false, embedded = false }: { fullPage?: boolean; embedded?: boolean }) {
    const navigate = useNavigate();
    const queue = usePlayerStore(s => s.queue);
    const queueIndex = usePlayerStore(s => s.queueIndex);
    const reorderQueue = usePlayerStore(s => s.reorderQueue);
    const clearQueue = usePlayerStore(s => s.clearQueue);
    const setQueueOpen = useUIStore(s => s.setQueueOpen);

    const currentItem = queue[queueIndex];
    const playedItems = queue.slice(0, queueIndex);
    const upcomingItems = queue.slice(queueIndex + 1);

    const nowPlayingRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to "Now Playing" when it changes
    useEffect(() => {
        nowPlayingRef.current?.scrollIntoView({
            block: 'nearest',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
    }, [queueIndex]);

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const detectCollision: CollisionDetection = (args) => {
        const section = args.active.data.current?.section;
        const droppableContainers = args.droppableContainers.filter(({ data, id }) => (
            data.current?.section === 'upcoming' || (
                section === 'played' && (id === nowPlayingDropId || id === upcomingEndDropId)
            )
        ));
        const detect = section === 'played' && args.pointerCoordinates ? pointerWithin : closestCenter;
        return detect({
            ...args,
            droppableContainers,
        });
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const { queue: latestQueue, queueIndex: currentIndex, playFromQueue } = usePlayerStore.getState();
        const oldIndex = latestQueue.findIndex(q => q.queueId === active.id);
        if (oldIndex < 0 || oldIndex === currentIndex) return;
        const wasPlayed = oldIndex < currentIndex;
        if (over.id === nowPlayingDropId) {
            if (wasPlayed) void playFromQueue(oldIndex);
            return;
        }
        if (over.id === upcomingEndDropId) {
            if (wasPlayed) reorderQueue(oldIndex, latestQueue.length - 1);
            return;
        }

        const newIndex = latestQueue.findIndex(q => q.queueId === over.id);
        if (newIndex > currentIndex) {
            // Removing a played track shifts the target one slot earlier.
            reorderQueue(oldIndex, wasPlayed ? newIndex - 1 : newIndex);
        }
    };

    const handleClose = () => {
        setQueueOpen(false);
    };

    const handleBack = () => {
        handleClose();
        // Use the same history entry as the browser or Android Back button.
        // A direct visit has no previous in-app entry to return to.
        if (window.history.state?.idx > 0) navigate(-1);
        else navigate('/', { replace: true });
    };

    return (
        <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
            {/* Header */}
            <header className={cn('flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-3', fullPage && 'sm:px-6 sm:py-5', embedded && 'border-white/[0.06] px-4 py-3')}>
                <div className="flex min-w-0 items-center gap-2">
                    {fullPage && !embedded && (
                        <button
                            type="button"
                            onClick={handleBack}
                            aria-label="Go back"
                            className={cn(iconButton, 'size-11')}
                        >
                            <ChevronLeft className="size-5" aria-hidden="true" />
                        </button>
                    )}
                    <div className="min-w-0">
                        {fullPage ? <h1 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">Queue</h1> : <h2 className="font-heading text-base font-bold tracking-tight">Queue</h2>}
                        <p className="text-xs text-muted-foreground">{queue.length} {queue.length === 1 ? 'track' : 'tracks'}</p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center">
                    {queue.length > 0 && (
                        <button
                            onClick={clearQueue}
                            className={iconButton}
                            aria-label="Clear queue"
                            title="Clear queue"
                        >
                            <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                    )}
                    {!fullPage && !embedded && <button
                        onClick={handleClose}
                        aria-label="Close queue"
                        className={iconButton}
                    >
                        <X className="size-4" aria-hidden="true" />
                    </button>}
                </div>
            </header>

            {/* Content */}
            <div className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-4', fullPage && 'sm:px-6')}>
                {queue.length === 0 ? (
                    <div className="mx-1 mt-4 rounded-xl bg-surface p-4 sm:p-5">
                        <ListMusic className="mb-3 size-6 text-primary" aria-hidden="true" />
                        <p className="font-heading text-sm font-semibold text-foreground">Your queue is empty</p>
                         <p className="mt-1 max-w-sm text-sm text-muted-foreground">Play a song or choose Add to queue from a song’s menu.</p>
                         <Link to="/search" onClick={() => setQueueOpen(false)} className="mt-2 inline-flex min-h-11 items-center rounded text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
                             Find music
                         </Link>
                    </div>
                ) : (
                    <DndContext sensors={sensors} collisionDetection={detectCollision} onDragEnd={handleDragEnd}>
                        {/* Previously Played */}
                        {playedItems.length > 0 && (
                            <div className="pt-3 pb-2">
                                <QueueSectionHeading fullPage={fullPage}>Played ({playedItems.length})</QueueSectionHeading>
                                {playedItems.map((item) => (
                                    <SortableQueueItem key={item.queueId} item={item} isPlayed />
                                ))}
                            </div>
                        )}

                        {/* Now Playing */}
                        {currentItem && (
                            <div className="pt-3 pb-2" ref={nowPlayingRef}>
                                <QueueSectionHeading fullPage={fullPage}>Now playing</QueueSectionHeading>
                                <NowPlayingDropTarget item={currentItem} />
                            </div>
                        )}

                        {/* Upcoming */}
                        {(upcomingItems.length > 0 || playedItems.length > 0) && (
                            <div className="pt-2">
                                <QueueSectionHeading fullPage={fullPage}>Up next ({upcomingItems.length})</QueueSectionHeading>
                                <SortableContext
                                    items={upcomingItems.map(q => q.queueId)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    {upcomingItems.map((item) => (
                                        <SortableQueueItem key={item.queueId} item={item} />
                                    ))}
                                </SortableContext>
                                {playedItems.length > 0 && <UpcomingEndDropTarget />}
                            </div>
                        )}
                    </DndContext>
                )}
            </div>
        </div>
    );
}

function QueueSectionHeading({ fullPage, children }: { fullPage: boolean; children: ReactNode }) {
    const Heading = fullPage ? 'h2' : 'h3';
    return <Heading className="mb-1 px-2 text-sm font-semibold text-foreground">{children}</Heading>;
}

function QueueItemRow({ item, isCurrent = false, isPlayed = false }: { item: QueueItem; isCurrent?: boolean; isPlayed?: boolean }) {
    const playFromQueue = usePlayerStore(s => s.playFromQueue);
    const removeFromQueue = usePlayerStore(s => s.removeFromQueue);
    const queueLength = usePlayerStore(s => s.queue.length);
    const queue = usePlayerStore(s => s.queue);

    const index = queue.findIndex(q => q.queueId === item.queueId);
    const s = item.song;
    const title = s.name || s.title || 'Unknown track';
    const thumbnail = s.img || (s.thumbnails ? getThumbnail(s.thumbnails, 60) : '') || `https://i.ytimg.com/vi/${s.videoId || s.id}/mqdefault.jpg`;

    return (
        <div
            aria-current={isCurrent ? 'true' : undefined}
            className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 transition-colors sm:px-2',
                isCurrent ? 'bg-primary/[0.09]' : 'hover:bg-white/[0.04]'
            )}
        >
            <div className="relative size-9 shrink-0 overflow-hidden rounded-md bg-surface ring-1 ring-white/10 sm:size-10">
                <img src={thumbnail} alt="" className="size-full object-cover" loading="lazy" />
            </div>
            <div className="flex-1 min-w-0">
                <p className={cn('truncate text-sm font-medium', isCurrent ? 'text-primary' : isPlayed ? 'text-secondary-foreground' : 'text-foreground')} title={title}>
                    {title}
                </p>
                <p className="truncate text-xs text-muted-foreground">{s.artist?.name || s.author}</p>
            </div>
            <div className="flex shrink-0 items-center">
                {!isCurrent && (
                    <button
                        onClick={(e) => { e.stopPropagation(); playFromQueue(index); }}
                        aria-label={`Play ${title}`}
                        title="Play track"
                        className={iconButton}
                    >
                        <Play className="size-4" fill="currentColor" aria-hidden="true" />
                    </button>
                )}
                {(!isCurrent || queueLength === 1) && <button
                    onClick={(e) => { e.stopPropagation(); removeFromQueue(item.queueId); }}
                    aria-label={`Remove ${title} from queue`}
                    title="Remove from queue"
                    className={iconButton}
                >
                    <X className="size-4" aria-hidden="true" />
                </button>}
            </div>
        </div>
    );
}

function NowPlayingDropTarget({ item }: { item: QueueItem }) {
    const { setNodeRef, isOver, active } = useDroppable({ id: nowPlayingDropId });
    const canDrop = active?.data.current?.section === 'played';

    return (
        <div ref={setNodeRef} className={cn('rounded-lg', canDrop && 'ring-1 ring-primary/40', isOver && canDrop && 'bg-primary/20 ring-2 ring-primary')}>
            <QueueItemRow item={item} isCurrent />
        </div>
    );
}

function UpcomingEndDropTarget() {
    const { setNodeRef, isOver, active } = useDroppable({ id: upcomingEndDropId });
    const canDrop = active?.data.current?.section === 'played';

    return (
        <div ref={setNodeRef} className={cn('mt-1 flex min-h-11 items-center rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground', canDrop && 'border-primary/50', isOver && 'bg-primary/20')}>
            Drop a played track here to add it to the end
        </div>
    );
}

function SortableQueueItem({ item, isPlayed = false }: { item: QueueItem; isPlayed?: boolean }) {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
        id: item.queueId,
        disabled: { droppable: isPlayed },
        data: { section: isPlayed ? 'played' : 'upcoming' },
    });
    const song = item.song;

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} className={cn('flex min-w-0 items-center rounded-lg', isOver && active?.data.current?.section === 'played' && 'shadow-[inset_0_2px_0_0_var(--color-primary)]')}>
            <button
                {...attributes}
                {...listeners}
                ref={setActivatorNodeRef}
                aria-label={`${isPlayed ? 'Move' : 'Reorder'} ${song.name || song.title || 'track'}`}
                title={isPlayed ? 'Move to Up next or Now playing' : 'Reorder track'}
                className={cn(iconButton, 'size-11 cursor-grab touch-none active:cursor-grabbing')}
            >
                <GripVertical className="size-4" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1">
                <QueueItemRow item={item} isPlayed={isPlayed} />
            </div>
        </div>
    );
}
