import type { CapacitorConfig } from '@capacitor/cli';

const PRODUCTION_SERVER_URL = 'https://m14u.pages.dev';
const debugUrl = process.env.CAPACITOR_DEBUG_URL?.trim();

if (debugUrl !== undefined && (process.env.RELEASE_BUILD === 'true' || process.env.CAPACITOR_RELEASE === '1')) {
  throw new Error('Refusing CAPACITOR_DEBUG_URL debug remote override in a release build');
}

const loopbackHttp = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+(?:[/?#]|$)/.test(debugUrl ?? '');
const allowedDebugHttps = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]|$)/i.test(debugUrl ?? '');

if (debugUrl && !loopbackHttp && !allowedDebugHttps) {
  throw new Error(
    `Refusing invalid CAPACITOR_DEBUG_URL (${debugUrl}); expected https://... or loopback http://127.0.0.1:<port>`
  );
}

const config: CapacitorConfig = {
  appId: 'dev.m14u.app',
  appName: 'M14U',
  webDir: 'dist',
  server: {
    url: debugUrl || PRODUCTION_SERVER_URL,
    cleartext: loopbackHttp
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0f0f11'
  }
};

export default config;
