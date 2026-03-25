/**
 * Formatting utilities used across the app.
 * Pure functions — no side effects, easily testable.
 */

import type { Thumbnail } from '@/types/music';

/**
 * Formats seconds into mm:ss or h:mm:ss display.
 * @example formatDuration(205) → "3:25"
 * @example formatDuration(3661) → "1:01:01"
 */
export function formatDuration(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
    if (seconds === 0) return '0:00';

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Picks the best thumbnail for a given size context.
 * Thumbnails are sorted ascending by width — picks the smallest one that is >= the preferred size.
 * Falls back to the largest available thumbnail.
 */
export function getThumbnail(thumbnails: Thumbnail[], preferredSize: number = 226): string {
    if (!thumbnails || thumbnails.length === 0) return '';
    return (
        thumbnails.find(t => t.width >= preferredSize) ||
        thumbnails[thumbnails.length - 1]
    ).url;
}

/**
 * Returns a time-based greeting.
 * Psychology: personal greeting creates ownership & habit loop.
 */
export function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 5) return 'Late night vibes';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    if (hour < 21) return 'Good evening';
    return 'Night owl mode';
}

/**
 * Generates a unique ID for queue items.
 * Uses crypto.randomUUID when available, fallback to timestamp + random.
 */
export function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Truncates text with ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + '…';
}

/**
 * Shuffles an array using Fisher-Yates.
 * Returns a new array — does not mutate the original.
 */
export function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Clamps a number between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}
