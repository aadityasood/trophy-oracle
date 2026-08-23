import { LocalProgressStoreV3Schema } from '../domain/hunt-memory-schema';
import type {
  LocalProgressStoreV3,
  ProgressMigrationReport,
} from '../domain/hunt-memory-schema';
import { transformProgressStoreV2ToV3 } from '../domain/progress-migration';
import { createDefaultHuntMemoryStore } from '../domain/hunt-memory-lifecycle';
import { DEFAULT_STORAGE_KEY } from './progress-storage';
import type { StorageLike } from './progress-storage';

export { createDefaultHuntMemoryStore };

export const HUNT_MEMORY_STORAGE_KEY = DEFAULT_STORAGE_KEY;

export type LoadHuntMemoryFailureCode =
  | 'STORAGE_ACCESS_ERROR'
  | 'INVALID_SOURCE_STORE'
  | 'TRANSFORMATION_ERROR'
  | 'INVALID_TARGET_STORE'
  | 'STORAGE_WRITE_ERROR';

export type LoadHuntMemoryProgressResult =
  | { success: true; source: 'default'; store: LocalProgressStoreV3 }
  | { success: true; source: 'loaded-v3'; store: LocalProgressStoreV3 }
  | {
      success: true;
      source: 'migrated-v2';
      store: LocalProgressStoreV3;
      report: ProgressMigrationReport;
    }
  | {
      success: false;
      code: LoadHuntMemoryFailureCode;
      message: string;
      conflicts: string[];
    };

export type SaveHuntMemoryErrorCode = 'INVALID_SAVE_STATE' | 'STORAGE_WRITE_ERROR';

export type SaveHuntMemoryProgressResult =
  | { success: true }
  | { success: false; code: SaveHuntMemoryErrorCode; message: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function loadFailure(
  code: LoadHuntMemoryFailureCode,
  message: string,
  conflicts: string[] = [],
): LoadHuntMemoryProgressResult {
  return { success: false, code, message, conflicts };
}

function formatIssues(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string[] {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

function readSchemaVersion(parsed: unknown): unknown {
  if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
    return (parsed as { schemaVersion?: unknown }).schemaVersion;
  }
  return undefined;
}

export function loadOrMigrateHuntMemoryProgress(
  storage: StorageLike,
  migratedAt: string,
  key: string = HUNT_MEMORY_STORAGE_KEY,
): LoadHuntMemoryProgressResult {
  let rawValue: string | null;
  try {
    rawValue = storage.getItem(key);
  } catch (err) {
    return loadFailure(
      'STORAGE_ACCESS_ERROR',
      `Failed to read from storage: ${errorMessage(err)}`,
    );
  }

  if (rawValue === null) {
    return {
      success: true,
      source: 'default',
      store: createDefaultHuntMemoryStore(),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch (err) {
    return loadFailure(
      'INVALID_SOURCE_STORE',
      `Failed to parse stored JSON: ${errorMessage(err)}`,
    );
  }

  const schemaVersion = readSchemaVersion(parsed);

  if (schemaVersion === '2.0') {
    const migrationResult = transformProgressStoreV2ToV3(parsed, migratedAt);
    if (!migrationResult.success) {
      return {
        success: false,
        code: migrationResult.code,
        message: migrationResult.message,
        conflicts: migrationResult.conflicts,
      };
    }

    try {
      const serialized = JSON.stringify(migrationResult.store);
      storage.setItem(key, serialized);
    } catch (err) {
      return loadFailure(
        'STORAGE_WRITE_ERROR',
        `Failed to write migrated store to storage: ${errorMessage(err)}`,
      );
    }

    return {
      success: true,
      source: 'migrated-v2',
      store: migrationResult.store,
      report: migrationResult.report,
    };
  }

  if (schemaVersion === '3.0') {
    const validation = LocalProgressStoreV3Schema.safeParse(parsed);
    if (!validation.success) {
      const conflicts = formatIssues(validation.error);
      return loadFailure(
        'INVALID_SOURCE_STORE',
        conflicts.join('; ') || validation.error.message,
        conflicts,
      );
    }

    return {
      success: true,
      source: 'loaded-v3',
      store: validation.data,
    };
  }

  return loadFailure(
    'INVALID_SOURCE_STORE',
    'Stored schemaVersion is missing, unsupported, or not a string',
    [`schemaVersion: ${JSON.stringify(schemaVersion)} is not a supported schema version`],
  );
}

export function saveHuntMemoryProgress(
  store: LocalProgressStoreV3,
  storage: StorageLike,
  key: string = HUNT_MEMORY_STORAGE_KEY,
): SaveHuntMemoryProgressResult {
  const validation = LocalProgressStoreV3Schema.safeParse(store);
  if (!validation.success) {
    const conflicts = formatIssues(validation.error);
    return {
      success: false,
      code: 'INVALID_SAVE_STATE',
      message: `Refused to save invalid Schema 3.0 store state: ${conflicts.join('; ') || validation.error.message}`,
    };
  }

  try {
    const serialized = JSON.stringify(validation.data);
    storage.setItem(key, serialized);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      code: 'STORAGE_WRITE_ERROR',
      message: `Failed to write to storage: ${errorMessage(err)}`,
    };
  }
}
