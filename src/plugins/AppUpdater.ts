import { registerPlugin } from '@capacitor/core';

export interface AppUpdaterPlugin {
  checkForUpdate(): Promise<{
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion?: string;
    downloadUrl?: string;
    releaseNotes?: string;
    error?: string;
  }>;
  openDownloadUrl(options: { url: string }): Promise<void>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');
export default AppUpdater;
