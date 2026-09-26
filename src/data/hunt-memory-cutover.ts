import type { StorageLike } from './progress-storage';
import {
  DEFAULT_HUNT_MEMORY_STORAGE_KEYS,
  ProgressV3CutoverRecordSchema,
  inspectHuntMemoryStorage,
  type HuntMemoryStorageKeys,
  type ProgressV3CutoverRecord,
} from './hunt-memory-storage';
import {
  LocalProgressStoreV3Schema,
  type LocalProgressStoreV3,
  type ProgressMigrationReport,
} from '../domain/hunt-memory-schema';
import { isIsoUtcString } from '../domain/progress-schema-common';

import {
  PROGRESS_V3_WRITE_LOCK_NAME,
  resolveLockManager,
  type WebLockCallback,
  type WebLockManagerLike,
} from './hunt-memory-write-lock';

export {
  PROGRESS_V3_WRITE_LOCK_NAME,
  type WebLockCallback,
  type WebLockManagerLike,
};

export interface UpgradeCutoverRequest {
  readonly mode: 'upgrade';
  readonly expectedV2Token: string;
  readonly migratedAt: string;
}

export interface FreshCutoverRequest {
  readonly mode: 'fresh';
  readonly candidateStore: unknown;
}

export type HuntMemoryCutoverRequest =
  | UpgradeCutoverRequest
  | FreshCutoverRequest;

export interface HuntMemoryCutoverOptions {
  readonly keys?: Partial<HuntMemoryStorageKeys>;
  readonly lockManager?: WebLockManagerLike | null;
}

export type HuntMemoryCutoverSuccessResult = {
  readonly status: 'success';
  readonly mode: 'upgrade' | 'fresh';
  readonly store: LocalProgressStoreV3;
  readonly v3Token: string;
  readonly cutoverRecord: ProgressV3CutoverRecord;
  readonly report?: ProgressMigrationReport;
  readonly v2Token?: string;
};

export type HuntMemoryCutoverBlockedReason =
  | 'STATE_MISMATCH'
  | 'STALE_V2_TOKEN'
  | 'SOURCE_V2_CHANGED'
  | 'INVALID_CANDIDATE_STORE'
  | 'INVALID_MIGRATION_TIMESTAMP'
  | 'INVALID_STORAGE_KEYS'
  | 'EXISTING_CUTOVER_OR_V3_PRESENT'
  | 'STORAGE_INSPECTION_FAILED';

export type HuntMemoryCutoverBlockedResult = {
  readonly status: 'blocked';
  readonly reason: HuntMemoryCutoverBlockedReason;
  readonly message: string;
  readonly details?: {
    readonly inspectionStatus?: string;
    readonly conflicts?: readonly string[];
    readonly rawV2?: string | null;
    readonly rawV3?: string | null;
    readonly rawCutover?: string | null;
  };
};

export type HuntMemoryCutoverFailureCode =
  | 'LOCK_UNAVAILABLE'
  | 'LOCK_ACQUISITION_REJECTED'
  | 'STORAGE_ACCESS_ERROR'
  | 'RECORD_WRITE_ERROR';

export type HuntMemoryCutoverFailureResult = {
  readonly status: 'failure';
  readonly code: HuntMemoryCutoverFailureCode;
  readonly message: string;
  readonly rawCutover?: string | null;
  readonly rawV2?: string | null;
};

export type HuntMemoryCutoverRecoveryReason =
  | 'INTERRUPTED_WRITE_V3_UNVERIFIED'
  | 'RECORD_WRITE_UNREADABLE'
  | 'RECORD_WRITE_DIFFERENT'
  | 'EXISTING_RECOVERY_STATE';

export type HuntMemoryCutoverRecoveryResult = {
  readonly status: 'recovery-required';
  readonly reason: HuntMemoryCutoverRecoveryReason;
  readonly message: string;
  readonly cutoverRecord?: ProgressV3CutoverRecord | null;
  readonly rawCutover?: string | null;
  readonly rawV3?: string | null;
  readonly rawV2?: string | null;
  readonly conflicts?: readonly string[];
};

export type HuntMemoryCutoverResult =
  | HuntMemoryCutoverSuccessResult
  | HuntMemoryCutoverBlockedResult
  | HuntMemoryCutoverFailureResult
  | HuntMemoryCutoverRecoveryResult;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseCutoverRecord(raw: string): ProgressV3CutoverRecord | null {
  try {
    const result = ProgressV3CutoverRecordSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function validateStorageKeys(keys: HuntMemoryStorageKeys): string | null {
  const { v2Key, v3Key, cutoverKey } = keys;
  if (!v2Key?.trim() || !v3Key?.trim() || !cutoverKey?.trim()) {
    return 'Configured storage keys must be nonblank strings';
  }
  if (v2Key === v3Key || v2Key === cutoverKey || v3Key === cutoverKey) {
    return 'Configured storage keys must be pairwise distinct';
  }
  return null;
}


function executeInLock(
  storage: StorageLike,
  request: HuntMemoryCutoverRequest,
  keys: HuntMemoryStorageKeys,
): HuntMemoryCutoverResult {
  let freshStore: LocalProgressStoreV3 | undefined;
  if (request.mode === 'upgrade') {
    if (!isIsoUtcString(request.migratedAt)) {
      return {
        status: 'blocked',
        reason: 'INVALID_MIGRATION_TIMESTAMP',
        message: `Migration timestamp '${request.migratedAt}' is not a valid ISO-8601 UTC timestamp`,
      };
    }
  } else if (request.mode === 'fresh') {
    const candParsed = LocalProgressStoreV3Schema.safeParse(
      request.candidateStore,
    );
    if (!candParsed.success) {
      return {
        status: 'blocked',
        reason: 'INVALID_CANDIDATE_STORE',
        message: 'Candidate V3 store failed Schema 3.0 validation',
        details: {
          conflicts: candParsed.error.issues.map(
            (i) => `${i.path.join('.')}: ${i.message}`,
          ),
        },
      };
    }
    freshStore = candParsed.data;
  }

  const inspection = inspectHuntMemoryStorage(storage, {
    keys,
    migratedAt: request.mode === 'upgrade' ? request.migratedAt : undefined,
  });

  if (inspection.status === 'loaded-v3') {
    return {
      status: 'blocked',
      reason: 'STATE_MISMATCH',
      message: 'V3 progress already exists; first-write cutover is blocked',
      details: {
        inspectionStatus: 'loaded-v3',
        rawV3: inspection.v3Token,
        rawCutover: JSON.stringify(inspection.cutoverRecord),
      },
    };
  }

  if (inspection.status === 'recovery-required') {
    return {
      status: 'recovery-required',
      reason: 'EXISTING_RECOVERY_STATE',
      message: `Storage is in recovery state: ${inspection.message}`,
      rawCutover: inspection.rawCutover,
      rawV3: inspection.rawV3,
      rawV2: inspection.rawV2,
      cutoverRecord: inspection.cutoverRecord,
      conflicts: inspection.conflicts,
    };
  }

  if (inspection.status === 'failure') {
    if (inspection.code === 'STORAGE_ACCESS_ERROR') {
      return {
        status: 'failure',
        code: 'STORAGE_ACCESS_ERROR',
        message: inspection.message,
        rawV2: inspection.rawV2,
      };
    }
    return {
      status: 'blocked',
      reason: 'STORAGE_INSPECTION_FAILED',
      message: inspection.message,
      details: {
        inspectionStatus: 'failure',
        conflicts: inspection.conflicts,
        rawV2: inspection.rawV2,
        rawV3: inspection.rawV3,
        rawCutover: inspection.rawCutover,
      },
    };
  }

  let cutoverRecord: ProgressV3CutoverRecord;
  let targetStore: LocalProgressStoreV3;
  let migrationReport: ProgressMigrationReport | undefined;
  let finalRawV2: string | null = null;

  if (request.mode === 'upgrade') {
    if (inspection.status !== 'upgrade-required') {
      return {
        status: 'blocked',
        reason: 'STATE_MISMATCH',
        message: `Expected upgrade-required storage but inspection returned '${inspection.status}'`,
        details: { inspectionStatus: inspection.status },
      };
    }

    if (inspection.v2Token !== request.expectedV2Token) {
      return {
        status: 'blocked',
        reason: 'STALE_V2_TOKEN',
        message: 'Stored V2 progress has changed since preview; cutover aborted',
        details: { rawV2: inspection.v2Token },
      };
    }

    finalRawV2 = inspection.v2Token;

    cutoverRecord = {
      recordVersion: 1,
      source: 'migrated-v2',
      rawV2: finalRawV2,
    };
    targetStore = inspection.candidateStore;
    migrationReport = inspection.report;
  } else {
    if (inspection.status !== 'fresh') {
      return {
        status: 'blocked',
        reason: 'STATE_MISMATCH',
        message: `Expected fresh storage but inspection returned '${inspection.status}'`,
        details: { inspectionStatus: inspection.status },
      };
    }

    cutoverRecord = {
      recordVersion: 1,
      source: 'fresh',
    };
    targetStore = freshStore!;
  }

  let checkCutover: string | null;
  let checkV3: string | null;
  try {
    // Fresh expects no V2; upgrades require the exact inspected source bytes.
    const checkV2 = storage.getItem(keys.v2Key);
    if (checkV2 !== finalRawV2) {
      return {
        status: 'blocked',
        reason: 'SOURCE_V2_CHANGED',
        message: 'V2 progress changed immediately before first write; cutover aborted',
        details: { rawV2: checkV2 },
      };
    }
    checkCutover = storage.getItem(keys.cutoverKey);
    checkV3 = storage.getItem(keys.v3Key);
  } catch (err) {
    return {
      status: 'failure',
      code: 'STORAGE_ACCESS_ERROR',
      message: `Failed to verify V2 source and absence of V3/cutover keys: ${errorMessage(err)}`,
    };
  }

  if (checkCutover !== null || checkV3 !== null) {
    return {
      status: 'blocked',
      reason: 'EXISTING_CUTOVER_OR_V3_PRESENT',
      message: 'Cutover record or V3 store already present in storage; refusing to overwrite',
      details: { rawCutover: checkCutover, rawV3: checkV3 },
    };
  }

  const parsedRecord = ProgressV3CutoverRecordSchema.safeParse(cutoverRecord);
  if (!parsedRecord.success) {
    return {
      status: 'blocked',
      reason: 'STORAGE_INSPECTION_FAILED',
      message: 'Internal cutover record schema validation failed',
    };
  }
  const recordBytes = JSON.stringify(parsedRecord.data);
  const v3Bytes = JSON.stringify(targetStore);

  let recordWriteErr: unknown = null;
  try {
    storage.setItem(keys.cutoverKey, recordBytes);
  } catch (err) {
    recordWriteErr = err;
  }

  let recordReadBack: string | null = null;
  let recordReadErr: unknown = null;
  try {
    recordReadBack = storage.getItem(keys.cutoverKey);
  } catch (err) {
    recordReadErr = err;
  }

  const recordVerified =
    recordReadErr === null && recordReadBack === recordBytes;

  if (!recordVerified) {
    if (recordReadErr !== null) {
      return {
        status: 'recovery-required',
        reason: 'RECORD_WRITE_UNREADABLE',
        message: `Cutover record write could not be verified due to read error: ${errorMessage(recordReadErr)}`,
        rawCutover: null,
        rawV3: null,
        rawV2: finalRawV2,
      };
    }

    if (recordReadBack !== null) {
      return {
        status: 'recovery-required',
        reason: 'RECORD_WRITE_DIFFERENT',
        message:
          'Cutover record present in storage but did not match intended bytes; recovery required',
        cutoverRecord: parseCutoverRecord(recordReadBack),
        rawCutover: recordReadBack,
        rawV3: null,
        rawV2: finalRawV2,
      };
    }

    return {
      status: 'failure',
      code: 'RECORD_WRITE_ERROR',
      message: recordWriteErr
        ? `Failed to write cutover record: ${errorMessage(recordWriteErr)}`
        : 'Cutover record write failed; record verified absent from storage',
      rawCutover: null,
      rawV2: finalRawV2,
    };
  }

  let v3WriteErr: unknown = null;
  try {
    storage.setItem(keys.v3Key, v3Bytes);
  } catch (err) {
    v3WriteErr = err;
  }

  let finalRecordRead: string | null = null;
  let finalRecordReadErr: unknown = null;
  try {
    finalRecordRead = storage.getItem(keys.cutoverKey);
  } catch (err) {
    finalRecordReadErr = err;
  }

  let finalV3Read: string | null = null;
  let finalV3ReadErr: unknown = null;
  try {
    finalV3Read = storage.getItem(keys.v3Key);
  } catch (err) {
    finalV3ReadErr = err;
  }

  const finalRecordVerified = finalRecordReadErr === null && finalRecordRead === recordBytes;
  const finalV3Verified = finalV3ReadErr === null && finalV3Read === v3Bytes;

  if (finalRecordVerified && finalV3Verified) {
    return {
      status: 'success',
      mode: request.mode,
      store: targetStore,
      v3Token: v3Bytes,
      cutoverRecord,
      report: migrationReport,
      v2Token: request.mode === 'upgrade' ? finalRawV2! : undefined,
    };
  }

  return {
    status: 'recovery-required',
    reason: 'INTERRUPTED_WRITE_V3_UNVERIFIED',
    message: v3WriteErr
      ? `Cutover record written and verified, but V3 write threw: ${errorMessage(v3WriteErr)}`
      : !finalV3Verified
        ? 'Cutover record written and verified, but V3 read-back did not match candidate bytes'
        : 'Cutover record read-back failed after V3 write',
    cutoverRecord,
    rawCutover: finalRecordRead,
    rawV3: finalV3Read,
    rawV2: finalRawV2,
  };
}

export async function executeHuntMemoryCutover(
  storage: StorageLike,
  request: HuntMemoryCutoverRequest,
  options?: HuntMemoryCutoverOptions,
): Promise<HuntMemoryCutoverResult> {
  const keys: HuntMemoryStorageKeys = {
    ...DEFAULT_HUNT_MEMORY_STORAGE_KEYS,
    ...options?.keys,
  };

  const keyError = validateStorageKeys(keys);
  if (keyError) {
    return {
      status: 'blocked',
      reason: 'INVALID_STORAGE_KEYS',
      message: keyError,
    };
  }

  const lockManager = resolveLockManager(options);
  if (!lockManager) {
    return {
      status: 'failure',
      code: 'LOCK_UNAVAILABLE',
      message:
        'Web Locks API is unavailable; persistent V3 cutover requires an exclusive lock',
    };
  }

  try {
    return await lockManager.request(
      PROGRESS_V3_WRITE_LOCK_NAME,
      { mode: 'exclusive' },
      async () => executeInLock(storage, request, keys),
    );
  } catch (err) {
    return {
      status: 'failure',
      code: 'LOCK_ACQUISITION_REJECTED',
      message: `Failed to acquire exclusive lock '${PROGRESS_V3_WRITE_LOCK_NAME}': ${errorMessage(err)}`,
    };
  }
}
