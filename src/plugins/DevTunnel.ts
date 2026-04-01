import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface TunnelLogEvent {
  raw: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'fatal';
  message: string;
  timestamp?: string;
  fields?: Record<string, string>;
}

export interface TunnelPanicEvent {
  type: 'restarting' | 'restarted' | 'failed';
  attempt: number;
  newUrl?: string;
  reason: string;
}

export interface DevTunnelPlugin {
  startTunnel(opts: { port?: number; username: string }): Promise<{ url: string }>;
  sendMessage(opts: { message: string }): Promise<{ sent: string; clients: number }>;
  updateRoomState(opts: { state: string }): Promise<void>;
  debugTunnel(): Promise<{ binary: string; exists: boolean; canExecute: boolean; size: number; versionOutput: string; exitCode: number }>;
  stopTunnel(): Promise<void>;
  getTunnelUrl(): Promise<{ url: string }>;
  addListener(event: 'tunnelLog', fn: (data: TunnelLogEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tunnelPanic', fn: (data: TunnelPanicEvent) => void): Promise<PluginListenerHandle>;
}

const DevTunnel = registerPlugin<DevTunnelPlugin>('DevTunnel');
export default DevTunnel;
