import { createDefaultLocalProgressStore } from '../domain/progress-engine';
import {
  CURRENT_STORE_SCHEMA_VERSION,
  LocalProgressStoreSchema,
} from '../domain/progress-schema';
import type { LocalProgressStore } from '../domain/progress-schema';

export const DEFAULT_STORAGE_KEY = 'trophy-oracle.progress.v2';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type RevisionToken = string | null;

export type LoadProgressErrorCode =
  | 'STORAGE_ACCESS_ERROR'
  | 'MALFORMED_JSON'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INVALID_STRUCTURE';

export type LoadProgressResult =
  | {
      success: true;
      store: LocalProgressStore;
      source: 'loaded' | 'default';
      token: RevisionToken;
    }
  | {
      success: false;
      fallbackStore: LocalProgressStore;
      code: LoadProgressErrorCode;
      message: string;
    };

export type SaveProgressErrorCode =
  | 'INVALID_SAVE_STATE'
  | 'STORAGE_ACCESS_ERROR'
  | 'STALE_WRITE_CONFLICT'
  | 'STORAGE_WRITE_ERROR';

export type SaveProgressResult =
  | { success: true; token: string }
  | { success: false; code: SaveProgressErrorCode; message: string };

export function loadProgressFromStorage(
  storage: StorageLike,
  key: string = DEFAULT_STORAGE_KEY
): LoadProgressResult {
  let rawValue: string | null;
  try {
    rawValue = storage.getItem(key);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      fallbackStore: createDefaultLocalProgressStore(),
      code: 'STORAGE_ACCESS_ERROR',
      message: `Failed to read from storage: ${errorMsg}`,
    };
  }

  if (rawValue === null) {
    return {
      success: true,
      store: createDefaultLocalProgressStore(),
      source: 'default',
      token: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      fallbackStore: createDefaultLocalProgressStore(),
      code: 'MALFORMED_JSON',
      message: `Failed to parse stored JSON: ${errorMsg}`,
    };
  }

  const parseResult = LocalProgressStoreSchema.safeParse(parsed);
  if (parseResult.success) {
    return {
      success: true,
      store: parseResult.data,
      source: 'loaded',
      token: rawValue,
    };
  }

  const isUnsupportedVersion =
    typeof parsed === 'object' &&
    parsed !== null &&
    'schemaVersion' in parsed &&
    (parsed as { schemaVersion?: unknown }).schemaVersion !== CURRENT_STORE_SCHEMA_VERSION;

  const code: LoadProgressErrorCode = isUnsupportedVersion
    ? 'UNSUPPORTED_SCHEMA_VERSION'
    : 'INVALID_STRUCTURE';

  const formattedError = parseResult.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  return {
    success: false,
    fallbackStore: createDefaultLocalProgressStore(),
    code,
    message: formattedError || parseResult.error.message,
  };
}

export function saveProgressToStorage(
  store: LocalProgressStore,
  storage: StorageLike,
  expectedToken: RevisionToken,
  key: string = DEFAULT_STORAGE_KEY
): SaveProgressResult {
  const parseResult = LocalProgressStoreSchema.safeParse(store);
  if (!parseResult.success) {
    const formattedError = parseResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return {
      success: false,
      code: 'INVALID_SAVE_STATE',
      message: `Refused to save invalid store state: ${formattedError}`,
    };
  }

  const serialized = JSON.stringify(parseResult.data);

  let currentRaw: string | null;
  try {
    currentRaw = storage.getItem(key);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      code: 'STORAGE_ACCESS_ERROR',
      message: `Failed to read from storage during save: ${errorMsg}`,
    };
  }

  // Exact raw byte comparison ensures stale or foreign writes are rejected without parsing.
  if (currentRaw !== expectedToken) {
    return {
      success: false,
      code: 'STALE_WRITE_CONFLICT',
      message: 'Storage has been modified by another session.',
    };
  }

  try {
    storage.setItem(key, serialized);
    return { success: true, token: serialized };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      code: 'STORAGE_WRITE_ERROR',
      message: `Failed to write to storage: ${errorMsg}`,
    };
  }
}
