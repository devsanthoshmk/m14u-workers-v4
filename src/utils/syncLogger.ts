/**
 * SyncLogger — Structured logging utility for the Listen Along sync protocol.
 *
 * Every sync operation (clock calibration, buffer measurement, sync broadcast, sync apply,
 * drift correction, connection state changes) is logged with precise timestamps.
 *
 * Logs to console AND an in-memory ring buffer for diagnostics.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
    timestamp: number;
    level: LogLevel;
    category: string;
    message: string;
    data?: Record<string, unknown>;
}

const PREFIX = '[ListenAlong]';
const MAX_ENTRIES = 5000;

class SyncLoggerImpl {
    private entries: LogEntry[] = [];
    private streamHandler?: (logs: LogEntry[]) => void;
    private streamBuffer: LogEntry[] = [];
    private streamInterval: ReturnType<typeof setInterval> | null = null;

    private push(level: LogLevel, category: string, message: string, data?: Record<string, unknown>): void {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            category,
            message,
            data,
        };

        // Ring buffer — drop oldest when full
        if (this.entries.length >= MAX_ENTRIES) {
            this.entries.shift();
        }
        this.entries.push(entry);

        if (this.streamHandler) {
            this.streamBuffer.push(entry);
        }

        // Console output
        const ts = new Date(entry.timestamp).toISOString().slice(11, 23); // HH:mm:ss.SSS
        const tag = `${PREFIX}[${category}]`;
        const formatted = `${ts} ${tag} ${message}`;

        switch (level) {
            case 'debug':
                console.debug(formatted, data ?? '');
                break;
            case 'info':
                console.info(formatted, data ?? '');
                break;
            case 'warn':
                console.warn(formatted, data ?? '');
                break;
            case 'error':
                console.error(formatted, data ?? '');
                break;
        }
    }

    // ─── Public API ────────────────────────────────────────────

    /** Register a handler to receive logs in chunks continuously. Useful for API streaming. */
    setStreamHandler(handler: (logs: LogEntry[]) => void): void {
        this.streamHandler = handler;
        if (!this.streamInterval) {
            this.streamInterval = setInterval(() => {
                if (this.streamBuffer.length > 0 && this.streamHandler) {
                    this.streamHandler([...this.streamBuffer]);
                    this.streamBuffer = [];
                }
            }, 3000);
        }
    }

    debug(category: string, message: string, data?: Record<string, unknown>): void {
        this.push('debug', category, message, data);
    }

    info(category: string, message: string, data?: Record<string, unknown>): void {
        this.push('info', category, message, data);
    }

    warn(category: string, message: string, data?: Record<string, unknown>): void {
        this.push('warn', category, message, data);
    }

    error(category: string, message: string, data?: Record<string, unknown>): void {
        this.push('error', category, message, data);
    }

    /** Returns the full in-memory log buffer for diagnostics. */
    getEntries(): ReadonlyArray<LogEntry> {
        return this.entries;
    }

    /** Returns only unsent streamed logs and clears the stream buffer. */
    flushStreamBuffer(): LogEntry[] {
        const logs = [...this.streamBuffer];
        this.streamBuffer = [];
        return logs;
    }

    /** Returns entries filtered by category. */
    getByCategory(category: string): LogEntry[] {
        return this.entries.filter(e => e.category === category);
    }

    /** Clears the ring buffer. */
    clear(): void {
        this.entries = [];
    }

    /** Dumps the log buffer as a JSON string — useful for copy/paste debugging. */
    dump(): string {
        return JSON.stringify(this.entries, null, 2);
    }
}

/** Singleton export */
export const syncLogger = new SyncLoggerImpl();

// Expose on window for development console access
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__syncLogger = syncLogger;
}
