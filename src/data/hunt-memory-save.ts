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
} from '../domain/hunt-memory-schema';
import {
  PROGRESS_V3_WRITE_LOCK_NAME,
  resolveLockManager,
  type WebLockManagerLike,
} from './hunt-memory-write-lock';

export interface HuntMemorySaveOptions {
  readonly keys?: Partial<HuntMemoryStorageKeys>;
  readonly lockManager?: WebLockManagerLike | null;
}

export type HuntMemorySaveSuccessResult = {
  readonly status: 'success';
  readonly store: LocalProgressStoreV3;
  readonly v3Token: string;
  readonly cutoverRecord: ProgressV3CutoverRecord;
  readonly legacyV2Warning?: string;
};

export type HuntMemorySaveBlockedReason =
  | 'INVALID_STORAGE_KEYS' | 'INVALID_EXPECTED_TOKEN' | 'INVALID_CANDIDATE_STORE'
  | 'STATE_MISMATCH' | 'STALE_V3_TOKEN';

export type HuntMemorySaveBlockedResult = {
  readonly status: 'blocked';
  readonly reason: HuntMemorySaveBlockedReason;
  readonly message: string;
  readonly conflicts?: readonly string[];
  readonly details?: {
    readonly expectedToken?: string;
    readonly actualToken?: string | null;
    readonly inspectionStatus?: string;
  };
};

export type HuntMemorySaveFailureCode =
  | 'LOCK_UNAVAILABLE' | 'LOCK_ACQUISITION_REJECTED'
  | 'STORAGE_ACCESS_ERROR' | 'WRITE_FAILED_TOKEN_UNCHANGED';

export type HuntMemorySaveFailureResult = {
  readonly status: 'failure';
  readonly code: HuntMemorySaveFailureCode;
  readonly message: string;
  readonly retryable: boolean;
};

export type HuntMemorySaveRecoveryReason =
  | 'EXISTING_RECOVERY_STATE' | 'CUTOVER_RECORD_CHANGED_OR_UNREADABLE'
  | 'READ_BACK_UNREADABLE' | 'V3_STORE_MISSING_AFTER_WRITE' | 'V3_STORE_CONFLICT_AFTER_WRITE';

export type HuntMemorySaveRecoveryResult = {
  readonly status: 'recovery-required';
  readonly reason: HuntMemorySaveRecoveryReason;
  readonly message: string;
  readonly cutoverRecord?: ProgressV3CutoverRecord | null;
  readonly rawCutover?: string | null;
  readonly rawV3?: string | null;
  readonly conflicts?: readonly string[];
};

export type HuntMemorySaveResult =
  | HuntMemorySaveSuccessResult
  | HuntMemorySaveBlockedResult
  | HuntMemorySaveFailureResult
  | HuntMemorySaveRecoveryResult;

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
  expectedV3Token: string,
  candidateStore: LocalProgressStoreV3,
  candidateBytes: string,
  keys: HuntMemoryStorageKeys,
): HuntMemorySaveResult {
  const inspection = inspectHuntMemoryStorage(storage, { keys });

  if (inspection.status === 'failure') {
    if (inspection.code === 'STORAGE_ACCESS_ERROR') {
      return { status: 'failure', code: 'STORAGE_ACCESS_ERROR', message: inspection.message, retryable: false };
    }
    return { status: 'blocked', reason: 'STATE_MISMATCH', message: inspection.message, conflicts: inspection.conflicts };
  }

  if (inspection.status === 'recovery-required') {
    return {
      status: 'recovery-required',
      reason: 'EXISTING_RECOVERY_STATE',
      message: `Storage is in recovery state: ${inspection.message}`,
      cutoverRecord: inspection.cutoverRecord,
      rawCutover: inspection.rawCutover,
      rawV3: inspection.rawV3,
      conflicts: inspection.conflicts,
    };
  }

  if (inspection.status === 'fresh' || inspection.status === 'upgrade-required') {
    return {
      status: 'blocked',
      reason: 'STATE_MISMATCH',
      message: `Cutover has not been performed; current storage status is '${inspection.status}'`,
      details: { inspectionStatus: inspection.status },
    };
  }

  if (inspection.v3Token !== expectedV3Token) {
    return {
      status: 'blocked',
      reason: 'STALE_V3_TOKEN',
      message: 'Stored V3 progress does not match expected token',
      details: { expectedToken: expectedV3Token, actualToken: inspection.v3Token },
    };
  }

  const rawCutoverInspected = inspection.rawCutover;

  let rawCutoverPreWrite: string | null;
  try {
    rawCutoverPreWrite = storage.getItem(keys.cutoverKey);
  } catch (err) {
    return {
      status: 'failure',
      code: 'STORAGE_ACCESS_ERROR',
      message: `Failed to re-read cutover key before save: ${errorMessage(err)}`,
      retryable: false,
    };
  }

  if (rawCutoverPreWrite !== rawCutoverInspected) {
    return {
      status: 'recovery-required',
      reason: 'CUTOVER_RECORD_CHANGED_OR_UNREADABLE',
      message: 'Cutover record changed between inspection and pre-write check',
      rawCutover: rawCutoverPreWrite,
      rawV3: inspection.v3Token,
      cutoverRecord: rawCutoverPreWrite !== null ? parseCutoverRecord(rawCutoverPreWrite) : null,
    };
  }

  if (candidateBytes === inspection.v3Token) {
    return {
      status: 'success',
      store: candidateStore,
      v3Token: inspection.v3Token,
      cutoverRecord: inspection.cutoverRecord,
      legacyV2Warning: inspection.legacyV2Warning,
    };
  }

  let writeError: unknown = null;
  try {
    storage.setItem(keys.v3Key, candidateBytes);
  } catch (err) {
    writeError = err;
  }

  let postCutoverRead: string | null = null;
  let postCutoverReadErr: unknown = null;
  try {
    postCutoverRead = storage.getItem(keys.cutoverKey);
  } catch (err) {
    postCutoverReadErr = err;
  }

  let postV3Read: string | null = null;
  let postV3ReadErr: unknown = null;
  try {
    postV3Read = storage.getItem(keys.v3Key);
  } catch (err) {
    postV3ReadErr = err;
  }

  if (postCutoverReadErr !== null || postCutoverRead !== rawCutoverInspected) {
    return {
      status: 'recovery-required',
      reason: 'CUTOVER_RECORD_CHANGED_OR_UNREADABLE',
      message: postCutoverReadErr
        ? `Cutover record read-back failed after V3 write: ${errorMessage(postCutoverReadErr)}`
        : 'Cutover record changed during V3 write',
      rawCutover: postCutoverRead,
      rawV3: postV3Read,
      cutoverRecord: postCutoverRead !== null ? parseCutoverRecord(postCutoverRead) : null,
    };
  }

  if (postV3ReadErr !== null) {
    return {
      status: 'recovery-required',
      reason: 'READ_BACK_UNREADABLE',
      message: `V3 read-back failed after write: ${errorMessage(postV3ReadErr)}`,
      rawCutover: postCutoverRead,
      cutoverRecord: inspection.cutoverRecord,
    };
  }

  if (postV3Read === candidateBytes) {
    return {
      status: 'success',
      store: candidateStore,
      v3Token: candidateBytes,
      cutoverRecord: inspection.cutoverRecord,
      legacyV2Warning: inspection.legacyV2Warning,
    };
  }

  if (postV3Read === expectedV3Token) {
    return {
      status: 'failure',
      code: 'WRITE_FAILED_TOKEN_UNCHANGED',
      message: writeError
        ? `V3 write threw error but stored token remained unchanged: ${errorMessage(writeError)}`
        : 'V3 write did not take effect but stored token remained unchanged',
      retryable: true,
    };
  }

  if (postV3Read === null) {
    return {
      status: 'recovery-required',
      reason: 'V3_STORE_MISSING_AFTER_WRITE',
      message: 'V3 store became missing after write attempt',
      rawCutover: postCutoverRead,
      rawV3: null,
      cutoverRecord: inspection.cutoverRecord,
    };
  }

  return {
    status: 'recovery-required',
    reason: 'V3_STORE_CONFLICT_AFTER_WRITE',
    message: 'V3 stored bytes diverged from both candidate and expected token',
    rawCutover: postCutoverRead,
    rawV3: postV3Read,
    cutoverRecord: inspection.cutoverRecord,
  };
}

export async function saveHuntMemoryProgress(
  storage: StorageLike,
  expectedV3Token: string,
  candidateStore: unknown,
  options?: HuntMemorySaveOptions,
): Promise<HuntMemorySaveResult> {
  const keys: HuntMemoryStorageKeys = {
    ...DEFAULT_HUNT_MEMORY_STORAGE_KEYS,
    ...options?.keys,
  };

  const keyError = validateStorageKeys(keys);
  if (keyError) {
    return { status: 'blocked', reason: 'INVALID_STORAGE_KEYS', message: keyError };
  }

  if (typeof expectedV3Token !== 'string' || expectedV3Token.trim() === '') {
    return {
      status: 'blocked',
      reason: 'INVALID_EXPECTED_TOKEN',
      message: 'Expected V3 token must be a non-empty string',
    };
  }

  const candParsed = LocalProgressStoreV3Schema.safeParse(candidateStore);
  if (!candParsed.success) {
    return {
      status: 'blocked',
      reason: 'INVALID_CANDIDATE_STORE',
      message: 'Candidate V3 store failed Schema 3.0 validation',
      conflicts: candParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  let candidateBytes: string;
  try {
    candidateBytes = JSON.stringify(candParsed.data);
  } catch (err) {
    return {
      status: 'blocked',
      reason: 'INVALID_CANDIDATE_STORE',
      message: `Failed to serialize candidate V3 store: ${errorMessage(err)}`,
    };
  }

  const lockManager = resolveLockManager(options);
  if (!lockManager) {
    return {
      status: 'failure',
      code: 'LOCK_UNAVAILABLE',
      message: 'Web Locks API is unavailable; persistent V3 save requires an exclusive lock',
      retryable: false,
    };
  }

  try {
    return await lockManager.request(
      PROGRESS_V3_WRITE_LOCK_NAME,
      { mode: 'exclusive' },
      async () => executeInLock(storage, expectedV3Token, candParsed.data, candidateBytes, keys),
    );
  } catch (err) {
    return {
      status: 'failure',
      code: 'LOCK_ACQUISITION_REJECTED',
      message: `Failed to acquire exclusive lock '${PROGRESS_V3_WRITE_LOCK_NAME}': ${errorMessage(err)}`,
      retryable: false,
    };
  }
}
