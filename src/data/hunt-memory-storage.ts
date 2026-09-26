import { z } from 'zod';
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

export const DEFAULT_PROGRESS_V2_STORAGE_KEY = DEFAULT_STORAGE_KEY;
export const DEFAULT_PROGRESS_V3_STORAGE_KEY = 'trophy-oracle.progress.v3';
export const DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY =
  'trophy-oracle.progress.v3-cutover';

export interface HuntMemoryStorageKeys {
  readonly v2Key: string;
  readonly v3Key: string;
  readonly cutoverKey: string;
}

export const DEFAULT_HUNT_MEMORY_STORAGE_KEYS: HuntMemoryStorageKeys = {
  v2Key: DEFAULT_PROGRESS_V2_STORAGE_KEY,
  v3Key: DEFAULT_PROGRESS_V3_STORAGE_KEY,
  cutoverKey: DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
};

export const ProgressV3CutoverRecordSchema = z.discriminatedUnion('source', [
  z.strictObject({
    recordVersion: z.literal(1),
    source: z.literal('migrated-v2'),
    rawV2: z.string(),
  }),
  z.strictObject({
    recordVersion: z.literal(1),
    source: z.literal('fresh'),
  }),
]);

export type ProgressV3CutoverRecord = z.infer<
  typeof ProgressV3CutoverRecordSchema
>;

function parseCutoverRecord(raw: string): ProgressV3CutoverRecord | null {
  try {
    const result = ProgressV3CutoverRecordSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export type LegacyV2Status =
  | 'unchanged'
  | 'changed'
  | 'missing'
  | 'unavailable'
  | 'not-applicable';

export type HuntMemoryRecoveryReason =
  | 'CUTOVER_WITHOUT_V3'
  | 'INVALID_CUTOVER_WITHOUT_V3'
  | 'V3_WITHOUT_CUTOVER'
  | 'V3_WITH_INVALID_CUTOVER'
  | 'INVALID_V3';

export type HuntMemoryInspectionFailureCode =
  | 'INVALID_STORAGE_KEYS'
  | 'STORAGE_ACCESS_ERROR'
  | 'INVALID_SOURCE_STORE'
  | 'TRANSFORMATION_ERROR'
  | 'INVALID_TARGET_STORE';

export type HuntMemoryInspectionResult =
  | {
      readonly status: 'fresh';
      readonly store: LocalProgressStoreV3;
      readonly v3Token: null;
    }
  | {
      readonly status: 'upgrade-required';
      readonly v2Token: string;
      readonly candidateStore: LocalProgressStoreV3;
      readonly report: ProgressMigrationReport;
    }
  | {
      readonly status: 'loaded-v3';
      readonly store: LocalProgressStoreV3;
      readonly v3Token: string;
      readonly cutoverRecord: ProgressV3CutoverRecord;
      readonly legacyV2Status: LegacyV2Status;
      readonly legacyV2Warning?: string;
      readonly rawV2: string | null;
      readonly rawCutover: string;
    }
  | {
      readonly status: 'recovery-required';
      readonly reason: HuntMemoryRecoveryReason;
      readonly message: string;
      readonly conflicts?: readonly string[];
      readonly rawV2: string | null;
      readonly rawV3: string | null;
      readonly rawCutover: string | null;
      readonly cutoverRecord?: ProgressV3CutoverRecord;
      readonly validatedStore?: LocalProgressStoreV3;
    }
  | {
      readonly status: 'failure';
      readonly code: HuntMemoryInspectionFailureCode;
      readonly message: string;
      readonly conflicts: readonly string[];
      readonly rawV2?: string | null;
      readonly rawV3?: string | null;
      readonly rawCutover?: string | null;
    };

export interface HuntMemoryInspectionOptions {
  readonly keys?: Partial<HuntMemoryStorageKeys>;
  readonly migratedAt?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function failureResult(
  code: HuntMemoryInspectionFailureCode,
  message: string,
  conflicts: readonly string[] = [],
  rawValues?: {
    rawV2?: string | null;
    rawV3?: string | null;
    rawCutover?: string | null;
  },
): HuntMemoryInspectionResult {
  return {
    status: 'failure',
    code,
    message,
    conflicts,
    ...rawValues,
  };
}

function recoveryResult(
  reason: HuntMemoryRecoveryReason,
  message: string,
  extra?: {
    conflicts?: readonly string[];
    rawV2?: string | null;
    rawV3?: string | null;
    rawCutover?: string | null;
    cutoverRecord?: ProgressV3CutoverRecord;
    validatedStore?: LocalProgressStoreV3;
  },
): HuntMemoryInspectionResult {
  return {
    status: 'recovery-required',
    reason,
    message,
    rawV2: extra?.rawV2 ?? null,
    rawV3: extra?.rawV3 ?? null,
    rawCutover: extra?.rawCutover ?? null,
    conflicts: extra?.conflicts,
    cutoverRecord: extra?.cutoverRecord,
    validatedStore: extra?.validatedStore,
  };
}

// Unlocked snapshot: re-inspect under the exclusive V3 write lock before
// treating an ambiguous state as durable recovery or performing a write.
export function inspectHuntMemoryStorage(
  storage: StorageLike,
  options?: HuntMemoryInspectionOptions,
): HuntMemoryInspectionResult {
  const keys: HuntMemoryStorageKeys = {
    ...DEFAULT_HUNT_MEMORY_STORAGE_KEYS,
    ...options?.keys,
  };

  if (
    !keys.v2Key ||
    keys.v2Key.trim() === '' ||
    !keys.v3Key ||
    keys.v3Key.trim() === '' ||
    !keys.cutoverKey ||
    keys.cutoverKey.trim() === ''
  ) {
    return failureResult(
      'INVALID_STORAGE_KEYS',
      'Configured storage keys must be nonblank strings',
    );
  }

  if (
    keys.v2Key === keys.v3Key ||
    keys.v2Key === keys.cutoverKey ||
    keys.v3Key === keys.cutoverKey
  ) {
    return failureResult(
      'INVALID_STORAGE_KEYS',
      'Configured storage keys must be pairwise distinct',
    );
  }

  let rawV3: string | null;
  try {
    rawV3 = storage.getItem(keys.v3Key);
  } catch (err) {
    return failureResult(
      'STORAGE_ACCESS_ERROR',
      `Failed to read V3 key '${keys.v3Key}': ${errorMessage(err)}`,
    );
  }

  let rawCutover: string | null;
  try {
    rawCutover = storage.getItem(keys.cutoverKey);
  } catch (err) {
    return failureResult(
      'STORAGE_ACCESS_ERROR',
      `Failed to read cutover key '${keys.cutoverKey}': ${errorMessage(err)}`,
      [],
      { rawV3 },
    );
  }

  const cutoverRecord =
    rawCutover !== null ? parseCutoverRecord(rawCutover) : null;

  if (rawV3 === null && rawCutover === null) {
    let rawV2: string | null;
    try {
      rawV2 = storage.getItem(keys.v2Key);
    } catch (err) {
      return failureResult(
        'STORAGE_ACCESS_ERROR',
        `Failed to read V2 key '${keys.v2Key}': ${errorMessage(err)}`,
      );
    }

    if (rawV2 === null) {
      return {
        status: 'fresh',
        store: createDefaultHuntMemoryStore(),
        v3Token: null,
      };
    }

    let parsedV2: unknown;
    try {
      parsedV2 = JSON.parse(rawV2);
    } catch (err) {
      return failureResult(
        'INVALID_SOURCE_STORE',
        `Failed to parse stored V2 JSON: ${errorMessage(err)}`,
        [],
        { rawV2 },
      );
    }

    const migration = transformProgressStoreV2ToV3(
      parsedV2,
      options?.migratedAt ?? '',
    );
    if (!migration.success) {
      return failureResult(
        migration.code,
        migration.message,
        migration.conflicts,
        { rawV2 },
      );
    }

    return {
      status: 'upgrade-required',
      v2Token: rawV2,
      candidateStore: migration.store,
      report: migration.report,
    };
  }

  if (rawV3 === null) {
    return cutoverRecord !== null
      ? recoveryResult(
          'CUTOVER_WITHOUT_V3',
          'Cutover record present without V3 store',
          { rawCutover, cutoverRecord },
        )
      : recoveryResult(
          'INVALID_CUTOVER_WITHOUT_V3',
          'Invalid cutover record present without V3 store',
          { rawCutover },
        );
  }

  let parsedV3: unknown;
  try {
    parsedV3 = JSON.parse(rawV3);
  } catch (err) {
    return recoveryResult(
      'INVALID_V3',
      `Failed to parse V3 JSON: ${errorMessage(err)}`,
      {
        rawV3,
        rawCutover,
        cutoverRecord: cutoverRecord ?? undefined,
      },
    );
  }

  const v3Validation = LocalProgressStoreV3Schema.safeParse(parsedV3);
  if (!v3Validation.success) {
    return recoveryResult(
      'INVALID_V3',
      'Stored V3 progress does not satisfy Schema 3.0',
      {
        conflicts: v3Validation.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
        rawV3,
        rawCutover,
        cutoverRecord: cutoverRecord ?? undefined,
      },
    );
  }

  const validV3Store = v3Validation.data;

  if (rawCutover === null) {
    return recoveryResult(
      'V3_WITHOUT_CUTOVER',
      'V3 store present without cutover record',
      {
        rawV3,
        validatedStore: validV3Store,
      },
    );
  }

  if (cutoverRecord === null) {
    return recoveryResult(
      'V3_WITH_INVALID_CUTOVER',
      'V3 store present with invalid cutover record',
      {
        rawV3,
        rawCutover,
        validatedStore: validV3Store,
      },
    );
  }

  let rawV2: string | null;
  try {
    rawV2 = storage.getItem(keys.v2Key);
  } catch (err) {
    return {
      status: 'loaded-v3',
      store: validV3Store,
      v3Token: rawV3,
      cutoverRecord,
      legacyV2Status: 'unavailable',
      legacyV2Warning: `Could not check older V2 progress: ${errorMessage(err)}`,
      rawV2: null,
      rawCutover,
    };
  }

  if (cutoverRecord.source === 'fresh') {
    if (rawV2 === null) {
      return {
        status: 'loaded-v3',
        store: validV3Store,
        v3Token: rawV3,
        cutoverRecord,
        legacyV2Status: 'not-applicable',
        rawV2: null,
        rawCutover,
      };
    }

    return {
      status: 'loaded-v3',
      store: validV3Store,
      v3Token: rawV3,
      cutoverRecord,
      legacyV2Status: 'changed',
      legacyV2Warning:
        'Unexpected legacy V2 progress detected after fresh cutover',
      rawV2,
      rawCutover,
    };
  }

  const legacyV2Status: LegacyV2Status =
    rawV2 === null
      ? 'missing'
      : rawV2 === cutoverRecord.rawV2
        ? 'unchanged'
        : 'changed';

  const legacyV2Warning =
    legacyV2Status === 'changed'
      ? 'Legacy V2 progress has changed since cutover'
      : undefined;

  return {
    status: 'loaded-v3',
    store: validV3Store,
    v3Token: rawV3,
    cutoverRecord,
    legacyV2Status,
    legacyV2Warning,
    rawV2,
    rawCutover,
  };
}
