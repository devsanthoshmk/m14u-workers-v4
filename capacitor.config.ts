import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.m14u.app',
  appName: 'M14U',
  webDir: 'dist',
  server: {
    url: 'https://m14u.pages.dev',
    cleartext: false
  }
};

export default config;
