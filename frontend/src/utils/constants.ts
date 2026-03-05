/**
 * Application constants.
 * Single source of truth for magic values across the app.
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const LRCLIB_BASE_URL = 'https://lrclib.net';

/** LocalStorage keys — centralized to prevent collisions */
export const STORAGE_KEYS = {
    PLAYER_STATE: 'm14u-player-state',
    FAVORITES: 'm14u-favorites',
    LISTENING_HISTORY: 'm14u-history',
    RECENT_SEARCHES: 'm14u-recent-searches',
    USER_LOCALE: 'm14u-user-locale',
    ONBOARDING_DONE: 'm14u-onboarding-done',
    VOLUME: 'm14u-volume',
    THEME: 'm14u-theme',
    LISTEN_ALONG_NAME: 'm14u-listen-along-name',
} as const;

/** Maximum items stored in various lists */
export const LIMITS = {
    LISTENING_HISTORY: 100,
    RECENT_SEARCHES: 20,
    FAVORITES: 500,
    QUEUE: 200,
} as const;

/** Listen Along configuration */
export const LISTEN_ALONG = {
    /** ACK freshness window used for online/offline indication */
    ACK_ONLINE_TTL: 90_000,
    /** Signal polling interval during WebRTC connection setup */
    SIGNAL_POLL_FAST: 1_500,
    /** Signal polling interval after connection is established */
    SIGNAL_POLL_SLOW: 5_000,
    /** ICE servers for WebRTC.
     *  Only Google STUN is used — all free public TURN services are defunct.
     *  For cross-network (different NAT) connections, self-host coturn and add
     *  TURN entries here via VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS. */
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Self-hosted TURN — uncomment and set env vars for cross-network use:
        // {
        //     urls: import.meta.env.VITE_TURN_URL || 'turn:your-server:3478',
        //     username: import.meta.env.VITE_TURN_USER || '',
        //     credential: import.meta.env.VITE_TURN_PASS || '',
        // },
    ] as RTCIceServer[],
    /** Number of clock-ping samples for offset calibration */
    CLOCK_SAMPLES: 5,
    /** Delay between clock-ping samples in ms */
    CLOCK_SAMPLE_INTERVAL: 200,
    /** Number of buffer delay calibration test plays */
    BUFFER_SAMPLES: 5,
    /** Time between clock re-calibrations in ms (5 minutes) */
    CLOCK_RECALIBRATE_INTERVAL: 5 * 60 * 1000,
    /** V1 Architecture: Polling interval for members in ms */
    POLL_INTERVAL: 4_000,
    /** Peer-list refresh interval (ACK-only presence, not heartbeat) */
    PRESENCE_POLL_INTERVAL: 8_000,
    /** Drift threshold in seconds — re-sync if drift exceeds this */
    DRIFT_THRESHOLD: 0.4,
} as const;

export const FIREBASE_CONFIG = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAFkyY1Lrigj2dAQ0t9amDbwGLcdzyiRXU',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'm14u-js.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'm14u-js',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'm14u-js.firebasestorage.app',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '102126601252',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:102126601252:web:dada5103b4d382e1f604b1',
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-SG98J8L065',
} as const;

export const FIREBASE_VAPID_KEY =
    import.meta.env.VITE_FIREBASE_VAPID_KEY ||
    'BP_VPRCvWJ1H-FMqhWhkFEYWnteomZwu_B9UhP1XCxwabGAXygP8Gx5Hfs2W1TXqvNvV_ytgbZHLYL3MwJSYKVQ';

/** Debounce delays in ms */
export const DEBOUNCE = {
    SEARCH: 350,
    SEEK: 100,
    VOLUME: 50,
    RESIZE: 150,
} as const;

/** Breakpoints matching Tailwind defaults */
export const BREAKPOINTS = {
    SM: 640,
    MD: 768,
    LG: 1024,
    XL: 1280,
} as const;

/** Keyboard shortcut mappings */
export const SHORTCUTS: Record<string, string> = {
    'Space': 'Play / Pause',
    'ArrowLeft': 'Seek backward 5s',
    'ArrowRight': 'Seek forward 5s',
    'ArrowUp': 'Volume up',
    'ArrowDown': 'Volume down',
    'KeyN': 'Next track',
    'KeyP': 'Previous track',
    'KeyM': 'Mute / Unmute',
    'KeyL': 'Toggle lyrics',
    'KeyQ': 'Toggle queue',
} as const;

/** Supported locale options for the language picker */
export const LOCALE_OPTIONS = [
    { label: 'English', value: 'english' },
    { label: 'Tamil', value: 'tamil' },
    { label: 'Hindi', value: 'hindi' },
    { label: 'Telugu', value: 'telugu' },
    { label: 'Kannada', value: 'kannada' },
    { label: 'Malayalam', value: 'malayalam' },
    { label: 'Bengali', value: 'bengali' },
    { label: 'Marathi', value: 'marathi' },
    { label: 'Punjabi', value: 'punjabi' },
    { label: 'Korean', value: 'korean' },
    { label: 'Japanese', value: 'japanese' },
    { label: 'Spanish', value: 'spanish' },
    { label: 'French', value: 'french' },
    { label: 'German', value: 'german' },
    { label: 'Arabic', value: 'arabic' },
    { label: 'Portuguese', value: 'portuguese' },
] as const;
