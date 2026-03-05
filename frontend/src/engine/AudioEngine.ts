/**
 * AudioEngine — singleton class managing the HTMLAudioElement.
 *
 * Why a class instead of a hook?
 * The audio element must persist across React re-renders and component unmounts.
 * A singleton ensures exactly one <audio> element exists regardless of UI state.
 *
 * All state changes are forwarded to callbacks which the Zustand store subscribes to.
 */

type AudioEventCallback = {
    onTimeUpdate?: (currentTime: number, duration: number) => void;
    onEnded?: () => void;
    onPlay?: () => void;
    onPause?: () => void;
    onError?: (error: string) => void;
    onWaiting?: () => void;
    onCanPlay?: () => void;
    onLoadStart?: () => void;
    onDurationChange?: (duration: number) => void;
};

class AudioEngine {
    private audio: HTMLAudioElement;
    private callbacks: AudioEventCallback = {};
    private retryCount = 0;
    private maxRetries = 3;
    private currentVideoId: string | null = null;
    private loadTimeoutId: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.audio = new Audio();
        this.audio.preload = 'auto';
        // NOTE: Do NOT set crossOrigin — Google CDN URLs reject CORS preflight
        this.bindEvents();
    }

    private bindEvents(): void {
        this.audio.addEventListener('timeupdate', () => {
            this.callbacks.onTimeUpdate?.(this.audio.currentTime, this.audio.duration);
        });

        this.audio.addEventListener('ended', () => {
            this.callbacks.onEnded?.();
        });

        this.audio.addEventListener('play', () => {
            this.retryCount = 0;
            this.clearLoadTimeout();
            this.callbacks.onPlay?.();
        });

        this.audio.addEventListener('pause', () => {
            this.callbacks.onPause?.();
        });

        this.audio.addEventListener('error', () => {
            const errorCode = this.audio.error?.code;
            const errorMsg = this.audio.error?.message || 'Unknown audio error';

            // Retry on network errors (code 2) or decode errors (code 3)
            if ((errorCode === 2 || errorCode === 3) && this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.warn(`[AudioEngine] Retry ${this.retryCount}/${this.maxRetries}: ${errorMsg}`);
                setTimeout(() => {
                    const currentSrc = this.audio.src;
                    if (currentSrc) {
                        this.audio.src = currentSrc;
                        this.audio.load();
                        this.audio.play().catch(() => {
                            // Will trigger error event again if it fails
                        });
                    }
                }, 1000 * this.retryCount);
            } else {
                this.clearLoadTimeout();
                this.callbacks.onError?.(errorMsg);
            }
        });

        this.audio.addEventListener('waiting', () => {
            this.callbacks.onWaiting?.();
        });

        // Use canplaythrough (not just canplay) — means enough data buffered for continuous play
        this.audio.addEventListener('canplaythrough', () => {
            this.clearLoadTimeout();
            this.callbacks.onCanPlay?.();
        });

        this.audio.addEventListener('canplay', () => {
            // Also clear buffering on canplay as a safety net
            this.callbacks.onCanPlay?.();
        });

        this.audio.addEventListener('loadstart', () => {
            this.callbacks.onLoadStart?.();
        });

        this.audio.addEventListener('durationchange', () => {
            if (Number.isFinite(this.audio.duration)) {
                this.callbacks.onDurationChange?.(this.audio.duration);
            }
        });

        // Handle stalled event — audio data stopped arriving
        this.audio.addEventListener('stalled', () => {
            console.warn('[AudioEngine] Audio stalled — data stopped arriving');
            this.callbacks.onWaiting?.();
        });

        // Handle visibility change — some browsers pause audio when tab is hidden
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.audio.paused) {
                this.audio.play().catch(() => { });
            }
        });
    }

    private clearLoadTimeout(): void {
        if (this.loadTimeoutId) {
            clearTimeout(this.loadTimeoutId);
            this.loadTimeoutId = null;
        }
    }

    setCallbacks(callbacks: AudioEventCallback): void {
        this.callbacks = callbacks;
    }

    load(url: string, videoId: string): void {
        this.retryCount = 0;
        this.currentVideoId = videoId;
        this.clearLoadTimeout();

        // Set a hard timeout — if audio doesn't start within 20s, report error
        this.loadTimeoutId = setTimeout(() => {
            if (this.audio.readyState < 2 && this.currentVideoId === videoId) {
                console.error('[AudioEngine] Load timeout — audio did not buffer within 20s');
                this.callbacks.onError?.('Audio load timed out. Try again.');
            }
        }, 20000);

        this.audio.src = url;
        this.audio.load();
    }

    getReadyState(): number {
        return this.audio.readyState;
    }

    async loadAndPlay(url: string, videoId: string): Promise<void> {
        this.load(url, videoId);

        try {
            await this.audio.play();
        } catch (error) {
            // Autoplay may be blocked — surface to UI
            if (error instanceof DOMException && error.name === 'NotAllowedError') {
                this.callbacks.onPause?.();
                // Don't treat as an error — user just needs to tap play
            } else {
                this.clearLoadTimeout();
                this.callbacks.onError?.(String(error));
            }
        }
    }

    async play(): Promise<void> {
        try {
            await this.audio.play();
        } catch {
            // Silently handle — event listeners will broadcast the state
        }
    }

    pause(): void {
        this.audio.pause();
    }

    async togglePlay(): Promise<void> {
        if (this.audio.paused) {
            await this.play();
        } else {
            this.pause();
        }
    }

    seek(time: number): void {
        if (Number.isFinite(time) && Number.isFinite(this.audio.duration)) {
            this.audio.currentTime = Math.min(Math.max(0, time), this.audio.duration);
        }
    }

    setVolume(volume: number): void {
        this.audio.volume = Math.min(Math.max(0, volume), 1);
    }

    setMuted(muted: boolean): void {
        this.audio.muted = muted;
    }

    getCurrentTime(): number {
        return this.audio.currentTime;
    }

    getDuration(): number {
        return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    }

    getVideoId(): string | null {
        return this.currentVideoId;
    }

    isPaused(): boolean {
        return this.audio.paused;
    }

    isBuffering(): boolean {
        return this.audio.readyState < 3;
    }

    destroy(): void {
        this.clearLoadTimeout();
        this.audio.pause();
        this.audio.src = '';
        this.audio.load();
    }
}

/** Singleton export */
export const audioEngine = new AudioEngine();
