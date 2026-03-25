/**
 * QueuePage — Dedicated queue management page (esp. useful on mobile).
 * Wraps QueuePanel in a full-page layout.
 */

import { QueuePanel } from '@/components/queue/QueuePanel';

export function QueuePage() {
    return (
        <div className="h-full">
            <QueuePanel />
        </div>
    );
}
