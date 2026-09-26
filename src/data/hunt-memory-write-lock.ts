export const PROGRESS_V3_WRITE_LOCK_NAME = 'trophy-oracle.progress.v3-write';

export type WebLockCallback<T> = () => Promise<T>;

export interface WebLockManagerLike {
  request<T>(name: string, callback: WebLockCallback<T>): Promise<T>;
  request<T>(
    name: string,
    options: {
      readonly mode?: 'exclusive' | 'shared';
      readonly ifAvailable?: boolean;
      readonly signal?: AbortSignal;
    },
    callback: WebLockCallback<T>,
  ): Promise<T>;
}

export interface WebLockOptions {
  readonly lockManager?: WebLockManagerLike | null;
}

export function resolveLockManager(
  options?: WebLockOptions,
): WebLockManagerLike | null {
  if (options && 'lockManager' in options) {
    return options.lockManager ?? null;
  }
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.locks?.request === 'function'
  ) {
    return navigator.locks as unknown as WebLockManagerLike;
  }
  return null;
}
