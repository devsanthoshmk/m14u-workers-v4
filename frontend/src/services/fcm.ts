import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage, type Messaging } from 'firebase/messaging';
import { FIREBASE_CONFIG, FIREBASE_VAPID_KEY } from '@/utils/constants';

export interface RoomFcmEvent {
    type: string;
    roomCode?: string;
    eventId?: string;
    title?: string;
    queueVersion?: string;
    memberPeerId?: string;
    memberName?: string;
    updatedAt?: string;
}

let messagingInstance: Messaging | null = null;
let initialized = false;
let foregroundUnsubscribe: (() => void) | null = null;
let swMessageBound = false;

function parseEvent(data: Record<string, string> | undefined): RoomFcmEvent | null {
    if (!data) return null;
    if (!data.type) return null;
    return {
        type: data.type,
        roomCode: data.roomCode,
        eventId: data.eventId,
        title: data.title,
        queueVersion: data.queueVersion,
        memberPeerId: data.memberPeerId,
        memberName: data.memberName,
        updatedAt: data.updatedAt,
    };
}

async function getMessagingSafe(): Promise<Messaging | null> {
    if (!(await isSupported())) return null;

    if (!getApps().length) {
        initializeApp(FIREBASE_CONFIG);
    }

    if (!messagingInstance) {
        messagingInstance = getMessaging();
    }

    return messagingInstance;
}

export async function initializeFcmListeners(onEvent: (event: RoomFcmEvent) => void): Promise<void> {
    if (initialized) return;

    const messaging = await getMessagingSafe();
    if (!messaging) return;

    foregroundUnsubscribe = onMessage(messaging, (payload) => {
        const event = parseEvent(payload.data as Record<string, string> | undefined);
        if (event) onEvent(event);
    });

    if (!swMessageBound && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (!event?.data || event.data.type !== 'FCM_EVENT') return;
            const parsed = parseEvent(event.data.payload);
            if (parsed) onEvent(parsed);
        });
        swMessageBound = true;
    }

    initialized = true;
}

export async function requestFcmToken(): Promise<string | null> {
    const messaging = await getMessagingSafe();
    if (!messaging) return null;

    if (typeof window === 'undefined' || !('Notification' in window)) {
        return null;
    }

    if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return null;
    }

    if (Notification.permission !== 'granted') return null;

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, {
        vapidKey: FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration,
    });

    return token || null;
}

export function teardownFcmListeners(): void {
    if (foregroundUnsubscribe) {
        foregroundUnsubscribe();
        foregroundUnsubscribe = null;
    }
    initialized = false;
}
