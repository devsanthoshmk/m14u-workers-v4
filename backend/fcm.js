import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : null;

let initialized = false;
let enabled = false;

if (!admin.apps.length) {
    try {
        if (
            process.env.FIREBASE_PROJECT_ID &&
            process.env.FIREBASE_CLIENT_EMAIL &&
            process.env.FIREBASE_PRIVATE_KEY
        ) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                }),
            });
            initialized = true;
            enabled = true;
            console.log('[FCM] Initialized Firebase Admin SDK from environment variables');
        } else if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
            const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
            initialized = true;
            enabled = true;
            console.log(`[FCM] Initialized Firebase Admin SDK from ${serviceAccountPath}`);
        } else {
            console.warn('[FCM] Firebase credentials not found in environment or at path; push notifications disabled');
        }
    } catch (err) {
        console.error('[FCM] Failed to initialize Firebase Admin SDK:', err);
    }
} else {
    initialized = true;
    enabled = true;
}

export function isFcmEnabled() {
    return initialized && enabled;
}

export async function sendRoomEventToTokens(tokens, data) {
    if (!isFcmEnabled()) return { sentCount: 0, failedCount: 0, invalidTokens: [] };
    if (!Array.isArray(tokens) || tokens.length === 0) {
        return { sentCount: 0, failedCount: 0, invalidTokens: [] };
    }

    const multicastMessage = {
        tokens,
        data,
        webpush: {
            headers: {
                Urgency: 'high',
            },
        },
    };

    const response = await admin.messaging().sendEachForMulticast(multicastMessage);

    const invalidTokens = [];
    response.responses.forEach((res, index) => {
        if (!res.success && res.error) {
            const code = res.error.code || '';
            if (
                code.includes('registration-token-not-registered') ||
                code.includes('invalid-registration-token')
            ) {
                invalidTokens.push(tokens[index]);
            }
        }
    });

    return {
        sentCount: response.successCount,
        failedCount: response.failureCount,
        invalidTokens,
    };
}
