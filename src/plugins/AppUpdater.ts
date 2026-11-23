import { registerPlugin } from '@capacitor/core';

export interface CheckForUpdateOptions {
  repo?: string;
}

export interface AppUpdateResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
  releaseNotes?: string;
  error?: string;
}

export interface AppUpdaterPlugin {
  checkForUpdate(options?: CheckForUpdateOptions): Promise<AppUpdateResult>;
  openDownloadUrl(options: { url: string }): Promise<void>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');
export default AppUpdater;
