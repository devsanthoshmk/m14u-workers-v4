import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { clampPanelWidth } from '@/stores/uiStore';

interface ResizeHandleProps {
    side: 'left' | 'right';
    width: number;
    defaultWidth: number;
    minWidth: number;
    maxWidth: number;
    label: string;
    onWidthChange: (width: number) => void;
    onResizeStateChange?: (resizing: boolean) => void;
}

export function ResizeHandle({
    side,
    width,
    defaultWidth,
    minWidth,
    maxWidth,
    label,
    onWidthChange,
    onResizeStateChange,
}: ResizeHandleProps) {
    const [isDragging, setIsDragging] = useState(false);
    const cleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        return () => {
            cleanupRef.current?.();
        };
    }, []);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();

        const startX = e.clientX;
        const startWidth = width;
        const prevCursor = document.body.style.cursor;
        const prevUserSelect = document.body.style.userSelect;

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        setIsDragging(true);
        onResizeStateChange?.(true);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            const delta = side === 'left'
                ? moveEvent.clientX - startX
                : startX - moveEvent.clientX;
            onWidthChange(clampPanelWidth(startWidth + delta, minWidth, maxWidth));
        };

        const finishDrag = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', finishDrag);
            window.removeEventListener('pointercancel', finishDrag);
            document.body.style.cursor = prevCursor;
            document.body.style.userSelect = prevUserSelect;
            setIsDragging(false);
            onResizeStateChange?.(false);
            cleanupRef.current = null;
        };

        cleanupRef.current = finishDrag;
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', finishDrag);
        window.addEventListener('pointercancel', finishDrag);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const delta = side === 'left' ? -step : step;
            onWidthChange(clampPanelWidth(width + delta, minWidth, maxWidth));
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            const delta = side === 'left' ? step : -step;
            onWidthChange(clampPanelWidth(width + delta, minWidth, maxWidth));
        } else if (e.key === 'Home') {
            e.preventDefault();
            onWidthChange(minWidth);
        } else if (e.key === 'End') {
            e.preventDefault();
            onWidthChange(maxWidth);
        }
    };

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={label}
            aria-valuemin={minWidth}
            aria-valuemax={maxWidth}
            aria-valuenow={width}
            tabIndex={0}
            title="Drag to resize · Double-click to reset"
            onPointerDown={handlePointerDown}
            onDoubleClick={() => onWidthChange(clampPanelWidth(defaultWidth, minWidth, maxWidth))}
            onKeyDown={handleKeyDown}
            className={cn(
                'group absolute top-0 bottom-0 z-20 w-2 cursor-col-resize select-none touch-none focus-visible:outline-none',
                side === 'left' ? 'right-0 translate-x-1/2' : 'left-0'
            )}
        >
            <div
                className={cn(
                    'h-full w-[2px] transition-colors duration-150',
                    side === 'left' ? 'mx-auto' : 'mr-auto',
                    isDragging
                        ? 'bg-primary'
                        : 'bg-transparent group-hover:bg-primary/60 group-focus-visible:bg-primary'
                )}
            />
        </div>
    );
}
