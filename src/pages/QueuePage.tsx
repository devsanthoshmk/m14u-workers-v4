/**
 * QueuePage — Dedicated queue management page (esp. useful on mobile).
 * Wraps QueuePanel in a full-page layout.
 */

import { QueuePanel } from '@/components/queue/QueuePanel';

export function QueuePage() {
    return (
        <div className="mx-auto h-full min-h-0 w-full min-w-0 max-w-4xl">
            <QueuePanel fullPage />
        </div>
    );
}
