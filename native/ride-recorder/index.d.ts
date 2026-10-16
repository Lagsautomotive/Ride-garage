import type { PluginListenerHandle } from '@capacitor/core';
export interface RidePoint {
  latitude: number;
  longitude: number;
  /** Unix epoch milliseconds from CLLocation.timestamp. */
  timestamp: number;
  /** Horizontal accuracy radius in metres. */
  accuracy: number;
  /** Metres per second; null when unavailable. */
  speed: number | null;
  /** Draw and calculate distance only within a segment. */
  segment: number;
}
export interface RideSession {
  id: string;
  name: string;
  country: string;
  startedAt: number;
  endedAt?: number;
  status: 'recording' | 'paused' | 'stopped' | 'interrupted';
  points: RidePoint[];
  durationMs: number;
  lastError?: string;
}
export interface RideRecorderPlugin {
  start(options: { name: string; country: string }): Promise<{ session: RideSession }>;
  pause(): Promise<{ session: RideSession }>;
  resume(): Promise<{ session: RideSession }>;
  stop(): Promise<{ session: RideSession }>;
  getSession(): Promise<{ session: RideSession | null }>;
  updateMetadata(options: { name: string; country: string }): Promise<{ session: RideSession }>;
  /** Call only after durable import using native id to deduplicate. */
  acknowledge(options: { id: string }): Promise<void>;
  /** Foreground updates; getSession is authoritative after returning to the foreground. */
  addListener(eventName: 'sessionChanged', listener: (event: { session: RideSession | null }) => void): Promise<PluginListenerHandle>;
}
export const RideRecorder: RideRecorderPlugin;
