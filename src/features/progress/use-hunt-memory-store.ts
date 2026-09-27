import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageLike } from '../../data/progress-storage';
import {
  DEFAULT_HUNT_MEMORY_STORAGE_KEYS,
  inspectHuntMemoryStorage,
  type HuntMemoryRecoveryReason,
  type HuntMemoryStorageKeys,
  type LegacyV2Status,
  type ProgressV3CutoverRecord,
} from '../../data/hunt-memory-storage';
import {
  executeHuntMemoryCutover,
  type HuntMemoryCutoverRecoveryReason,
  type HuntMemoryCutoverResult,
} from '../../data/hunt-memory-cutover';
import {
  saveHuntMemoryProgress,
  type HuntMemorySaveRecoveryReason,
  type HuntMemorySaveResult,
} from '../../data/hunt-memory-save';
import {
  resolveLockManager,
  type WebLockManagerLike,
} from '../../data/hunt-memory-write-lock';
import type {
  LocalProgressStoreV3,
  ProgressMigrationReport,
} from '../../domain/hunt-memory-schema';
import { isIsoUtcString } from '../../domain/progress-schema-common';

export interface UseHuntMemoryStoreOptions {
  readonly storage?: StorageLike | null;
  readonly keys?: Partial<HuntMemoryStorageKeys>;
  readonly now?: () => string;
  readonly lockManager?: WebLockManagerLike | null;
}

export type DomainMutationResult =
  | { readonly success: true; readonly store: LocalProgressStoreV3; readonly changed?: boolean }
  | { readonly success: false; readonly code: string; readonly message: string };

export type PureDomainMutation = (
  store: LocalProgressStoreV3,
  timestamp: string,
) => DomainMutationResult;

export interface PendingCandidate {
  readonly candidateStore: LocalProgressStoreV3;
  readonly expectedV3Token: string;
  readonly message: string;
}

export type FreshHookState = {
  readonly status: 'fresh';
  readonly store: LocalProgressStoreV3;
  readonly v3Token: null;
};

export type UpgradeRequiredHookState = {
  readonly status: 'upgrade-required';
  readonly candidateStore: LocalProgressStoreV3;
  readonly store: LocalProgressStoreV3;
  readonly v2Token: string;
  readonly report: ProgressMigrationReport;
};

export type ReadyHookState = {
  readonly status: 'ready';
  readonly store: LocalProgressStoreV3;
  readonly v3Token: string;
  readonly cutoverRecord: ProgressV3CutoverRecord;
  readonly legacyV2Status: LegacyV2Status;
  readonly legacyV2Warning?: string;
  readonly rawV2: string | null;
  readonly rawCutover: string;
};

export type RecoveryRequiredHookState = {
  readonly status: 'recovery-required';
  readonly reason: HuntMemoryRecoveryReason | HuntMemoryCutoverRecoveryReason | HuntMemorySaveRecoveryReason | string;
  readonly message: string;
  readonly store: LocalProgressStoreV3 | null;
  readonly conflicts?: readonly string[];
  readonly rawV2?: string | null;
  readonly rawV3?: string | null;
  readonly rawCutover?: string | null;
  readonly cutoverRecord?: ProgressV3CutoverRecord | null;
  readonly validatedStore?: LocalProgressStoreV3;
};

export type ViewOnlyHookState = {
  readonly status: 'view-only';
  readonly reason: string;
  readonly message: string;
  readonly store: LocalProgressStoreV3 | null;
  readonly candidateStore?: LocalProgressStoreV3;
  readonly v2Token?: string;
  readonly report?: ProgressMigrationReport;
  readonly v3Token?: string;
};

export type FailureHookState = {
  readonly status: 'failure';
  readonly code: string;
  readonly message: string;
  readonly store: null;
  readonly conflicts?: readonly string[];
  readonly rawV2?: string | null;
  readonly rawV3?: string | null;
  readonly rawCutover?: string | null;
};

export type HuntMemoryDiscriminatedState =
  | FreshHookState
  | UpgradeRequiredHookState
  | ReadyHookState
  | RecoveryRequiredHookState
  | ViewOnlyHookState
  | FailureHookState;

export type HuntMemoryActionResult =
  | { readonly status: 'success'; readonly store: LocalProgressStoreV3; readonly v3Token?: string }
  | { readonly status: 'no-op'; readonly store: LocalProgressStoreV3 }
  | { readonly status: 'busy'; readonly message: string; readonly reason?: 'OPERATION_IN_FLIGHT' | 'UNSAVED_CANDIDATE' }
  | { readonly status: 'mutation-failed'; readonly code: string; readonly message: string }
  | { readonly status: 'retryable-failure'; readonly code: 'WRITE_FAILED_TOKEN_UNCHANGED'; readonly message: string }
  | { readonly status: 'blocked'; readonly reason: string; readonly message: string }
  | { readonly status: 'recovery-required'; readonly reason: string; readonly message: string }
  | { readonly status: 'failure'; readonly code: string; readonly message: string };

export type HuntMemoryDiscardResult =
  | { readonly status: 'success' }
  | { readonly status: 'no-op'; readonly message: string }
  | { readonly status: 'busy'; readonly message: string; readonly reason?: 'OPERATION_IN_FLIGHT' };

export type UseHuntMemoryStoreResult = HuntMemoryDiscriminatedState & {
  readonly isBusy: boolean;
  readonly isStale: boolean;
  readonly canSave: boolean;
  readonly pendingCandidate: PendingCandidate | null;
  readonly staleReason: string | null;
  readonly lastError: string | null;
  readonly mutate: (fn: PureDomainMutation) => Promise<HuntMemoryActionResult>;
  readonly upgrade: (migratedAt?: string) => Promise<HuntMemoryActionResult>;
  readonly retry: () => Promise<HuntMemoryActionResult>;
  readonly discard: () => HuntMemoryDiscardResult;
};

const defaultNow = (): string => new Date().toISOString();

function getLazyLocalStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Privacy-restricted browser contexts
  }
  return null;
}

function inspectInitialState(
  storage: StorageLike | null,
  keys: HuntMemoryStorageKeys,
  lockManager: WebLockManagerLike | null,
  now: () => string,
): HuntMemoryDiscriminatedState {
  if (!storage) {
    return { status: 'view-only', reason: 'STORAGE_UNAVAILABLE', message: 'Storage is unavailable; progress cannot be inspected or saved.', store: null };
  }
  const ins = inspectHuntMemoryStorage(storage, { keys, migratedAt: now() });
  if (ins.status === 'fresh') {
    return !lockManager
      ? { status: 'view-only', reason: 'LOCK_UNAVAILABLE', message: 'Web Locks API is unavailable; persistent V3 writes are disabled.', store: ins.store }
      : { status: 'fresh', store: ins.store, v3Token: null };
  }
  if (ins.status === 'upgrade-required') {
    return !lockManager
      ? { status: 'view-only', reason: 'LOCK_UNAVAILABLE', message: 'Web Locks API is unavailable; upgrade is disabled.', store: ins.candidateStore, candidateStore: ins.candidateStore, v2Token: ins.v2Token, report: ins.report }
      : { status: 'upgrade-required', candidateStore: ins.candidateStore, store: ins.candidateStore, v2Token: ins.v2Token, report: ins.report };
  }
  if (ins.status === 'loaded-v3') {
    return !lockManager
      ? { status: 'view-only', reason: 'LOCK_UNAVAILABLE', message: 'Web Locks API is unavailable; persistent V3 writes are disabled.', store: ins.store, v3Token: ins.v3Token }
      : { status: 'ready', store: ins.store, v3Token: ins.v3Token, cutoverRecord: ins.cutoverRecord, legacyV2Status: ins.legacyV2Status, legacyV2Warning: ins.legacyV2Warning, rawV2: ins.rawV2, rawCutover: ins.rawCutover };
  }
  if (ins.status === 'recovery-required') {
    return { status: 'recovery-required', reason: ins.reason, message: ins.message, store: ins.validatedStore ?? null, conflicts: ins.conflicts, rawV2: ins.rawV2, rawV3: ins.rawV3, rawCutover: ins.rawCutover, cutoverRecord: ins.cutoverRecord, validatedStore: ins.validatedStore };
  }
  return { status: 'failure', code: ins.code, message: ins.message, store: null, conflicts: ins.conflicts, rawV2: ins.rawV2, rawV3: ins.rawV3, rawCutover: ins.rawCutover };
}

export function useHuntMemoryStore(
  options: UseHuntMemoryStoreOptions = {},
): UseHuntMemoryStoreResult {
  const [dependencies] = useState(() => ({
    storage: options.storage !== undefined ? options.storage : getLazyLocalStorage(),
    now: options.now ?? defaultNow,
    lockManager: resolveLockManager(options),
    keys: { ...DEFAULT_HUNT_MEMORY_STORAGE_KEYS, ...options.keys },
  }));

  const [initialState] = useState(() =>
    inspectInitialState(dependencies.storage, dependencies.keys, dependencies.lockManager, dependencies.now),
  );

  const [state, setState] = useState<HuntMemoryDiscriminatedState>(initialState);
  const statusRef = useRef<HuntMemoryDiscriminatedState['status']>(initialState.status);
  const confirmedStoreRef = useRef<LocalProgressStoreV3>(initialState.store ?? { schemaVersion: '3.0', gameProgress: {} });
  const confirmedTokenRef = useRef<string | null>(initialState.status === 'ready' ? initialState.v3Token : null);
  const confirmedCutoverRawRef = useRef<string | null>(initialState.status === 'ready' ? initialState.rawCutover : null);
  const inspectedV2TokenRef = useRef<string | null>(initialState.status === 'upgrade-required' ? initialState.v2Token : null);

  const isOperationPendingRef = useRef(false);
  const [isBusy, setIsBusy] = useState(false);

  const isStaleRef = useRef(false);
  const [isStale, setIsStale] = useState(false);
  const staleReasonRef = useRef<string | null>(null);
  const [staleReason, setStaleReason] = useState<string | null>(null);

  const pendingCandidateRef = useRef<PendingCandidate | null>(null);
  const [pendingCandidate, setPendingCandidate] = useState<PendingCandidate | null>(null);

  const markStale = useCallback((reason: string) => {
    isStaleRef.current = true;
    staleReasonRef.current = reason;
    setIsStale(true);
    setStaleReason(reason);
  }, []);

  const applyReady = useCallback(
    (
      store: LocalProgressStoreV3,
      v3Token: string,
      cutoverRecord: ProgressV3CutoverRecord,
      extra?: { legacyV2Warning?: string; legacyV2Status?: LegacyV2Status; rawV2?: string | null; rawCutover?: string },
    ) => {
      confirmedStoreRef.current = store;
      confirmedTokenRef.current = v3Token;
      confirmedCutoverRawRef.current = extra?.rawCutover ?? JSON.stringify(cutoverRecord);
      statusRef.current = 'ready';
      setState({
        status: 'ready',
        store,
        v3Token,
        cutoverRecord,
        legacyV2Warning: extra?.legacyV2Warning,
        legacyV2Status: extra?.legacyV2Status ?? 'unchanged',
        rawV2: extra?.rawV2 ?? null,
        rawCutover: extra?.rawCutover ?? JSON.stringify(cutoverRecord),
      });
    },
    [],
  );

  const applyRecovery = useCallback(
    (
      reason: string,
      message: string,
      details?: { rawCutover?: string | null; rawV3?: string | null; rawV2?: string | null; cutoverRecord?: ProgressV3CutoverRecord | null; conflicts?: readonly string[] },
    ) => {
      statusRef.current = 'recovery-required';
      setState({
        status: 'recovery-required',
        reason,
        message,
        store: confirmedStoreRef.current,
        rawCutover: details?.rawCutover ?? null,
        rawV3: details?.rawV3 ?? null,
        rawV2: details?.rawV2 ?? null,
        cutoverRecord: details?.cutoverRecord ?? null,
        conflicts: details?.conflicts,
      });
    },
    [],
  );

  const checkGuard = useCallback((): HuntMemoryActionResult | null => {
    if (isOperationPendingRef.current) {
      return { status: 'busy', reason: 'OPERATION_IN_FLIGHT', message: 'An operation is already in flight' };
    }
    if (pendingCandidateRef.current !== null) {
      return { status: 'busy', reason: 'UNSAVED_CANDIDATE', message: 'An unsaved candidate is pending Retry or Discard' };
    }
    return null;
  }, []);

  const handleSaveResult = useCallback((
    saveResult: HuntMemorySaveResult,
    candidateStore: LocalProgressStoreV3,
    expectedV3Token: string,
  ): HuntMemoryActionResult => {
    if (saveResult.status === 'success') {
      applyReady(saveResult.store, saveResult.v3Token, saveResult.cutoverRecord, saveResult);
      return { status: 'success', store: saveResult.store, v3Token: saveResult.v3Token };
    }
    if (saveResult.status === 'failure' && saveResult.code === 'WRITE_FAILED_TOKEN_UNCHANGED' && saveResult.retryable) {
      const pending: PendingCandidate = { candidateStore, expectedV3Token, message: saveResult.message };
      pendingCandidateRef.current = pending;
      setPendingCandidate(pending);
      return { status: 'retryable-failure', code: 'WRITE_FAILED_TOKEN_UNCHANGED', message: saveResult.message };
    }
    if (saveResult.status === 'recovery-required') {
      applyRecovery(saveResult.reason, saveResult.message, saveResult);
      return { status: 'recovery-required', reason: saveResult.reason, message: saveResult.message };
    }
    if (saveResult.status === 'blocked') {
      markStale(saveResult.message);
      return { status: 'blocked', reason: saveResult.reason, message: saveResult.message };
    }
    markStale(saveResult.message);
    return { status: 'failure', code: saveResult.code, message: saveResult.message };
  }, [applyReady, applyRecovery, markStale]);

  const handleCutoverResult = useCallback(
    (
      result: HuntMemoryCutoverResult,
      extra?: { legacyV2Status?: LegacyV2Status; rawV2?: string | null },
    ): HuntMemoryActionResult => {
      if (result.status === 'success') {
        applyReady(result.store, result.v3Token, result.cutoverRecord, extra);
        return { status: 'success', store: result.store, v3Token: result.v3Token };
      }
      if (result.status === 'recovery-required') {
        applyRecovery(result.reason, result.message, result);
        return { status: 'recovery-required', reason: result.reason, message: result.message };
      }
      if (result.status === 'failure') {
        markStale(`${result.code}: ${result.message}`);
        return { status: 'failure', code: result.code, message: result.message };
      }
      if (result.reason !== 'INVALID_CANDIDATE_STORE' &&
          result.reason !== 'INVALID_MIGRATION_TIMESTAMP' &&
          result.reason !== 'INVALID_STORAGE_KEYS') {
        markStale(`${result.reason}: ${result.message}`);
      }
      return { status: 'blocked', reason: result.reason, message: result.message };
    },
    [applyReady, applyRecovery, markStale],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isLocalStorage = (() => {
      try {
        return !!dependencies.storage && dependencies.storage === window.localStorage;
      } catch {
        return false;
      }
    })();

    const handleStorage = (event: StorageEvent) => {
      if (!isLocalStorage) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      if (event.key === null) {
        if (confirmedTokenRef.current === null) return;
        markStale('Storage cleared in another session');
        return;
      }
      if (event.key === dependencies.keys.v3Key) {
        if (event.newValue === confirmedTokenRef.current) return;
        markStale('Saved progress changed in another session');
        return;
      }
      if (event.key === dependencies.keys.cutoverKey) {
        if (event.newValue === confirmedCutoverRawRef.current) return;
        markStale('Cutover metadata changed in another session');
      }
    };

    const handleFocus = () => {
      if (!isLocalStorage || statusRef.current !== 'ready') return;
      const inspection = inspectHuntMemoryStorage(dependencies.storage!, { keys: dependencies.keys });
      if (inspection.status !== 'loaded-v3') {
        const reason = inspection.status === 'failure' ? `${inspection.code}: ${inspection.message}`
          : inspection.status === 'recovery-required' ? `${inspection.reason}: ${inspection.message}`
            : 'Authoritative V3 progress is missing';
        markStale(reason);
        return;
      }
      if (inspection.v3Token !== confirmedTokenRef.current) {
        markStale('Saved progress changed while window was inactive');
        return;
      }
      if (inspection.rawCutover !== confirmedCutoverRawRef.current) {
        markStale('Cutover metadata changed while window was inactive');
        return;
      }
      // Focus is advisory: retain the confirmed store and publish only legacy metadata.
      setState((current) => {
        if (current.status !== 'ready' || current.v3Token !== inspection.v3Token ||
            current.rawCutover !== inspection.rawCutover) return current;
        if (current.legacyV2Status === inspection.legacyV2Status &&
            current.legacyV2Warning === inspection.legacyV2Warning &&
            current.rawV2 === inspection.rawV2) return current;
        return { ...current, legacyV2Status: inspection.legacyV2Status,
          legacyV2Warning: inspection.legacyV2Warning, rawV2: inspection.rawV2 };
      });
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isOperationPendingRef.current || pendingCandidateRef.current !== null) {
        event.preventDefault();
        event.returnValue = '';
        return '';
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [dependencies, markStale]);

  const mutate = useCallback(
    async (fn: PureDomainMutation): Promise<HuntMemoryActionResult> => {
      const busy = checkGuard();
      if (busy) return busy;

      isOperationPendingRef.current = true;
      setIsBusy(true);

      try {
        if (isStaleRef.current) {
          return { status: 'blocked', reason: 'STALE_STORAGE', message: staleReasonRef.current ?? 'Storage is stale; reload required to resume saving' };
        }
        if (!dependencies.storage || !dependencies.lockManager) {
          return { status: 'failure', code: 'LOCK_UNAVAILABLE', message: 'Web Locks API or storage is unavailable; persistent writes disabled' };
        }

        const currentStatus = statusRef.current;
        if (currentStatus === 'upgrade-required') {
          return { status: 'blocked', reason: 'UPGRADE_REQUIRED', message: 'Storage requires explicit V2 upgrade before mutating V3 progress' };
        }
        if (currentStatus !== 'ready' && currentStatus !== 'fresh') {
          return { status: 'blocked', reason: 'INVALID_STATE', message: `Cannot mutate progress in '${currentStatus}' state` };
        }

        const timestamp = dependencies.now();
        const mutationResult = fn(confirmedStoreRef.current, timestamp);
        if (!mutationResult.success) {
          return { status: 'mutation-failed', code: mutationResult.code, message: mutationResult.message };
        }

        const isChanged = mutationResult.changed !== undefined ? mutationResult.changed : mutationResult.store !== confirmedStoreRef.current;
        if (!isChanged) {
          return { status: 'no-op', store: confirmedStoreRef.current };
        }

        const candidateStore = mutationResult.store;
        if (currentStatus === 'fresh') {
          const cutoverResult: HuntMemoryCutoverResult = await executeHuntMemoryCutover(
            dependencies.storage,
            { mode: 'fresh', candidateStore },
            { keys: dependencies.keys, lockManager: dependencies.lockManager },
          );
          return handleCutoverResult(cutoverResult, { legacyV2Status: 'not-applicable' });
        }

        const saveResult: HuntMemorySaveResult = await saveHuntMemoryProgress(
          dependencies.storage,
          confirmedTokenRef.current!,
          candidateStore,
          { keys: dependencies.keys, lockManager: dependencies.lockManager },
        );
        return handleSaveResult(saveResult, candidateStore, confirmedTokenRef.current!);
      } finally {
        isOperationPendingRef.current = false;
        setIsBusy(false);
      }
    },
    [checkGuard, dependencies, handleCutoverResult, handleSaveResult],
  );

  const upgrade = useCallback(
    async (migratedAt?: string): Promise<HuntMemoryActionResult> => {
      const busy = checkGuard();
      if (busy) return busy;

      isOperationPendingRef.current = true;
      setIsBusy(true);

      try {
        if (isStaleRef.current) {
          return { status: 'blocked', reason: 'STALE_STORAGE', message: staleReasonRef.current ?? 'Storage is stale; reload required to resume saving' };
        }
        if (statusRef.current !== 'upgrade-required' || inspectedV2TokenRef.current === null) {
          return { status: 'blocked', reason: 'STATE_MISMATCH', message: `Upgrade is only available in upgrade-required state, current state is '${statusRef.current}'` };
        }
        if (!dependencies.storage || !dependencies.lockManager) {
          return { status: 'failure', code: 'LOCK_UNAVAILABLE', message: 'Web Locks API or storage is unavailable; persistent upgrade disabled' };
        }

        const timestamp = migratedAt ?? dependencies.now();
        if (!isIsoUtcString(timestamp)) {
          return { status: 'blocked', reason: 'INVALID_MIGRATION_TIMESTAMP', message: `Migration timestamp '${timestamp}' is not a valid ISO-8601 UTC timestamp` };
        }

        const cutoverResult: HuntMemoryCutoverResult = await executeHuntMemoryCutover(
          dependencies.storage,
          { mode: 'upgrade', expectedV2Token: inspectedV2TokenRef.current, migratedAt: timestamp },
          { keys: dependencies.keys, lockManager: dependencies.lockManager },
        );

        return handleCutoverResult(cutoverResult, { legacyV2Status: 'unchanged', rawV2: inspectedV2TokenRef.current });
      } finally {
        isOperationPendingRef.current = false;
        setIsBusy(false);
      }
    },
    [checkGuard, dependencies, handleCutoverResult],
  );

  const retry = useCallback(async (): Promise<HuntMemoryActionResult> => {
    if (isOperationPendingRef.current) {
      return { status: 'busy', reason: 'OPERATION_IN_FLIGHT', message: 'An operation is already in flight' };
    }
    if (isStaleRef.current) {
      return { status: 'blocked', reason: 'STALE_STORAGE', message: staleReasonRef.current ?? 'Storage is stale; reload required to resume saving' };
    }
    if (!pendingCandidateRef.current) {
      return { status: 'blocked', reason: 'NO_PENDING_CANDIDATE', message: 'No unsaved candidate is pending retry' };
    }

    isOperationPendingRef.current = true;
    setIsBusy(true);

    try {
      const { candidateStore, expectedV3Token } = pendingCandidateRef.current;
      const saveResult: HuntMemorySaveResult = await saveHuntMemoryProgress(
        dependencies.storage!,
        expectedV3Token,
        candidateStore,
        { keys: dependencies.keys, lockManager: dependencies.lockManager },
      );
      if (saveResult.status === 'success') {
        pendingCandidateRef.current = null;
        setPendingCandidate(null);
      } else if (!(saveResult.status === 'failure' && saveResult.code === 'WRITE_FAILED_TOKEN_UNCHANGED' && saveResult.retryable)) {
        pendingCandidateRef.current = null;
        setPendingCandidate(null);
      }
      return handleSaveResult(saveResult, candidateStore, expectedV3Token);
    } finally {
      isOperationPendingRef.current = false;
      setIsBusy(false);
    }
  }, [dependencies, handleSaveResult]);

  const discard = useCallback((): HuntMemoryDiscardResult => {
    if (isOperationPendingRef.current) {
      return { status: 'busy', reason: 'OPERATION_IN_FLIGHT', message: 'An operation is already in flight' };
    }
    if (!pendingCandidateRef.current) {
      return { status: 'no-op', message: 'No unsaved candidate to discard' };
    }
    pendingCandidateRef.current = null;
    setPendingCandidate(null);
    return { status: 'success' };
  }, []);

  const canSave =
    !isBusy &&
    !isStale &&
    pendingCandidate === null &&
    dependencies.lockManager !== null &&
    dependencies.storage !== null &&
    (state.status === 'ready' || state.status === 'fresh');

  return {
    ...state,
    isBusy,
    isStale,
    canSave,
    pendingCandidate,
    staleReason,
    lastError: state.status === 'failure' ? state.message : null,
    mutate,
    upgrade,
    retry,
    discard,
  };
}
