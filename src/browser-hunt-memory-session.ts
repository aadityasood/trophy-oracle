import type { HuntMemorySessionConfig } from './HuntMemoryApp';
import {
  DEFAULT_HUNT_MEMORY_STORAGE_KEYS,
  type HuntMemoryStorageKeys,
} from './data/hunt-memory-storage';
import {
  resolveLockManager,
  type WebLockManagerLike,
} from './data/hunt-memory-write-lock';
import type { StorageLike } from './data/progress-storage';
import { defaultRawDownload } from './features/progress/hunt-memory-export';

export interface BrowserHuntMemorySessionOptions {
  readonly storage?: StorageLike | null;
  readonly lockManager?: WebLockManagerLike | null;
  readonly keys?: HuntMemoryStorageKeys;
  readonly clock?: () => string;
  readonly download?: (filename: string, content: string) => void;
  readonly session?: string;
}

export const defaultIsoUtcClock = (): string => new Date().toISOString();

function acquireBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    const candidate = window.localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

function acquireBrowserLockManager(): WebLockManagerLike | null {
  try {
    if (typeof navigator === 'undefined') {
      return null;
    }
    return resolveLockManager();
  } catch {
    return null;
  }
}

function generateSessionId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    try {
      return `hunt-session-${crypto.randomUUID()}`;
    } catch {
      // Fallback for restricted security environments
    }
  }
  return `hunt-session-${Math.random().toString(36).slice(2, 11)}`;
}

export function createBrowserHuntMemorySession(
  options?: BrowserHuntMemorySessionOptions,
): HuntMemorySessionConfig {
  const storage =
    options && 'storage' in options
      ? (options.storage ?? null)
      : acquireBrowserStorage();

  const lockManager =
    options && 'lockManager' in options
      ? (options.lockManager ?? null)
      : acquireBrowserLockManager();

  const keys: HuntMemoryStorageKeys = options?.keys
    ? {
        v2Key: options.keys.v2Key,
        v3Key: options.keys.v3Key,
        cutoverKey: options.keys.cutoverKey,
      }
    : {
        v2Key: DEFAULT_HUNT_MEMORY_STORAGE_KEYS.v2Key,
        v3Key: DEFAULT_HUNT_MEMORY_STORAGE_KEYS.v3Key,
        cutoverKey: DEFAULT_HUNT_MEMORY_STORAGE_KEYS.cutoverKey,
      };

  const session =
    typeof options?.session === 'string' && options.session.trim().length > 0
      ? options.session
      : generateSessionId();

  const clock = options?.clock ?? defaultIsoUtcClock;
  const download = options?.download ?? defaultRawDownload;

  return {
    session,
    storage,
    lockManager,
    keys,
    clock,
    download,
  };
}
