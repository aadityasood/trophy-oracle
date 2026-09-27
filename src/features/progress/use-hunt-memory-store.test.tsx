import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '../../test/memory-storage';
import {
  DEFAULT_PROGRESS_V2_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_STORAGE_KEY,
  createDefaultHuntMemoryStore,
} from '../../data/hunt-memory-storage';
import {
  type WebLockCallback,
  type WebLockManagerLike,
} from '../../data/hunt-memory-write-lock';
import { createDefaultGameProgressV3 } from '../../domain/hunt-memory-lifecycle';
import { setRunBinaryCompletion } from '../../domain/hunt-memory-progress';
import { type LocalProgressStoreV3 } from '../../domain/hunt-memory-schema';
import { mockGameStellarDrift, MOCK_TIMESTAMP } from '../../test/progress-fixtures';
import {
  useHuntMemoryStore,
  type FreshHookState,
  type HuntMemoryActionResult,
  type ReadyHookState,
  type UpgradeRequiredHookState,
  type UseHuntMemoryStoreResult,
} from './use-hunt-memory-store';

function StrictWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}

class TestLockManager implements WebLockManagerLike {
  shouldDefer = false;
  deferredResolver: (() => void) | null = null;

  async request<T>(
    _name: string,
    optionsOrCallback: { readonly mode?: 'exclusive' | 'shared'; readonly signal?: AbortSignal } | WebLockCallback<T>,
    maybeCallback?: WebLockCallback<T>,
  ): Promise<T> {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;
    if (this.shouldDefer) {
      return new Promise<T>((resolve, reject) => {
        this.deferredResolver = async () => {
          try {
            resolve(await callback());
          } catch (err) {
            reject(err);
          }
        };
      });
    }
    return callback();
  }
}

function createBaseStore(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.lastGameId = mockGameStellarDrift.id;
  store.gameProgress[mockGameStellarDrift.id] = createDefaultGameProgressV3(mockGameStellarDrift, MOCK_TIMESTAMP);
  return store;
}

function seedReadyStorage(storage: MemoryStorage, store: LocalProgressStoreV3): string {
  const rawV3 = JSON.stringify(store);
  storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
  storage.seed(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, JSON.stringify({ recordVersion: 1, source: 'fresh' }));
  return rawV3;
}

function setupReadyHook(options: {
  readonly storage?: MemoryStorage;
  readonly lockManager?: TestLockManager;
  readonly store?: LocalProgressStoreV3;
  readonly now?: () => string;
} = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const lockManager = options.lockManager ?? new TestLockManager();
  const token = seedReadyStorage(storage, options.store ?? createBaseStore());
  const hook = renderHook(() =>
    useHuntMemoryStore({ storage, lockManager, now: options.now ?? (() => MOCK_TIMESTAMP) }),
  );
  return { storage, lockManager, token, ...hook };
}

function asReady(state: UseHuntMemoryStoreResult): ReadyHookState & UseHuntMemoryStoreResult {
  expect(state.status).toBe('ready');
  return state as ReadyHookState & UseHuntMemoryStoreResult;
}

function asFresh(state: UseHuntMemoryStoreResult): FreshHookState & UseHuntMemoryStoreResult {
  expect(state.status).toBe('fresh');
  return state as FreshHookState & UseHuntMemoryStoreResult;
}

function asUpgrade(state: UseHuntMemoryStoreResult): UpgradeRequiredHookState & UseHuntMemoryStoreResult {
  expect(state.status).toBe('upgrade-required');
  return state as UpgradeRequiredHookState & UseHuntMemoryStoreResult;
}

const setBinary = (store: LocalProgressStoreV3, achId: string, completed: boolean, ts: string) =>
  setRunBinaryCompletion(store, mockGameStellarDrift, 'stellar-drift-ps', 'default-run', achId, completed, ts);

async function mutateBinary(
  hookResult: { current: UseHuntMemoryStoreResult },
  achId: string,
  completed = true,
) {
  let actionResult!: HuntMemoryActionResult;
  await act(async () => {
    actionResult = await hookResult.current.mutate((s, ts) => setBinary(s, achId, completed, ts));
  });
  return actionResult;
}

describe('useHuntMemoryStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('load branches and zero-write mount: fresh, upgrade, ready, recovery, failure', () => {
    const lockManager = new TestLockManager();

    const emptyStorage = new MemoryStorage();
    const { result: freshResult } = renderHook(
      () => useHuntMemoryStore({ storage: emptyStorage, lockManager }),
      { wrapper: StrictWrapper },
    );
    const fresh = asFresh(freshResult.current);
    expect(fresh.v3Token).toBeNull();
    expect(fresh.canSave).toBe(true);
    expect(emptyStorage.writeCount).toBe(0);

    const v2Storage = new MemoryStorage();
    const v2Raw = JSON.stringify({ schemaVersion: '2.0', gameProgress: {} });
    v2Storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, v2Raw);
    const { result: upgradeResult } = renderHook(
      () => useHuntMemoryStore({ storage: v2Storage, lockManager }),
      { wrapper: StrictWrapper },
    );
    const upgrade = asUpgrade(upgradeResult.current);
    expect(upgrade.v2Token).toBe(v2Raw);
    expect(upgrade.candidateStore.schemaVersion).toBe('3.0');
    expect(v2Storage.writeCount).toBe(0);

    const readyStorage = new MemoryStorage();
    const rawV3 = seedReadyStorage(readyStorage, createBaseStore());
    const { result: readyResult } = renderHook(
      () => useHuntMemoryStore({ storage: readyStorage, lockManager }),
      { wrapper: StrictWrapper },
    );
    const ready = asReady(readyResult.current);
    expect(ready.v3Token).toBe(rawV3);
    expect(ready.cutoverRecord.source).toBe('fresh');
    expect(readyStorage.writeCount).toBe(0);

    const recStorage = new MemoryStorage();
    recStorage.seed(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, JSON.stringify({ recordVersion: 1, source: 'fresh' }));
    const { result: recResult } = renderHook(
      () => useHuntMemoryStore({ storage: recStorage, lockManager }),
      { wrapper: StrictWrapper },
    );
    expect(recResult.current.status).toBe('recovery-required');
    if (recResult.current.status === 'recovery-required') {
      expect(recResult.current.reason).toBe('CUTOVER_WITHOUT_V3');
    }
    expect(recResult.current.canSave).toBe(false);
    expect(recStorage.writeCount).toBe(0);

    const corruptStorage = new MemoryStorage();
    corruptStorage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, '{ invalid JSON');
    corruptStorage.seed(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, JSON.stringify({ recordVersion: 1, source: 'fresh' }));
    const { result: corruptResult } = renderHook(
      () => useHuntMemoryStore({ storage: corruptStorage, lockManager }),
      { wrapper: StrictWrapper },
    );
    expect(corruptResult.current.status).toBe('recovery-required');
    if (corruptResult.current.status === 'recovery-required') {
      expect(corruptResult.current.reason).toBe('INVALID_V3');
    }
    expect(corruptResult.current.canSave).toBe(false);

    const invalidKeyResult = renderHook(() =>
      useHuntMemoryStore({ storage: emptyStorage, lockManager, keys: { v2Key: '   ' } }),
    );
    expect(invalidKeyResult.result.current.status).toBe('failure');
    if (invalidKeyResult.result.current.status === 'failure') {
      expect(invalidKeyResult.result.current.code).toBe('INVALID_STORAGE_KEYS');
    }
    expect(invalidKeyResult.result.current.canSave).toBe(false);
  });

  it('fresh first mutation performs cutover and rotates token', async () => {
    const storage = new MemoryStorage();
    const lockManager = new TestLockManager();
    const { result } = renderHook(() =>
      useHuntMemoryStore({ storage, lockManager, now: () => MOCK_TIMESTAMP }),
    );
    asFresh(result.current);

    let actionResult!: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      actionResult = await result.current.mutate((store, timestamp) => {
        const next = JSON.parse(JSON.stringify(store)) as LocalProgressStoreV3;
        next.lastGameId = mockGameStellarDrift.id;
        next.gameProgress[mockGameStellarDrift.id] = createDefaultGameProgressV3(mockGameStellarDrift, timestamp);
        return { success: true, store: next, changed: true };
      });
    });

    expect(actionResult.status).toBe('success');
    const ready = asReady(result.current);
    expect(ready.v3Token).toBeTruthy();
    expect(ready.cutoverRecord.source).toBe('fresh');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toContain('"fresh"');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toContain('stellar-drift');
  });

  it('explicit V2 upgrade blocks normal mutations and performs verified upgrade', async () => {
    const storage = new MemoryStorage();
    const lockManager = new TestLockManager();
    const rawV2 = JSON.stringify({
      schemaVersion: '2.0',
      gameProgress: {},
    });
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    const { result } = renderHook(() =>
      useHuntMemoryStore({ storage, lockManager, now: () => MOCK_TIMESTAMP }),
    );
    asUpgrade(result.current);

    let mutateBlockedResult!: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      mutateBlockedResult = await result.current.mutate((store) => ({ success: true, store, changed: true }));
    });
    expect(mutateBlockedResult.status).toBe('blocked');
    if (mutateBlockedResult.status === 'blocked') {
      expect(mutateBlockedResult.reason).toBe('UPGRADE_REQUIRED');
    }

    let upgradeResult!: Awaited<ReturnType<typeof result.current.upgrade>>;
    await act(async () => {
      upgradeResult = await result.current.upgrade(MOCK_TIMESTAMP);
    });

    expect(upgradeResult.status).toBe('success');
    asReady(result.current);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(rawV2);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toContain('migrated-v2');
  });

  it.each([
    ['fresh', 'competing-cutover', 'STATE_MISMATCH'],
    ['fresh', 'v2-before-inspection', 'STORAGE_INSPECTION_FAILED'],
    ['upgrade', 'v2-before-inspection', 'STALE_V2_TOKEN'],
    ['upgrade', 'v2-removed', 'STATE_MISMATCH'],
    ['fresh', 'v2-after-inspection', 'SOURCE_V2_CHANGED'],
    ['upgrade', 'v2-after-inspection', 'SOURCE_V2_CHANGED'],
    ['fresh', 'cutover-after-inspection', 'EXISTING_CUTOVER_OR_V3_PRESENT'],
    ['upgrade', 'cutover-after-inspection', 'EXISTING_CUTOVER_OR_V3_PRESENT'],
    ['fresh', 'read-error', 'STORAGE_ACCESS_ERROR'],
    ['upgrade', 'read-error', 'STORAGE_ACCESS_ERROR'],
  ] as const)('latches %s cutover after %s without publishing or retrying', async (mode, race, reason) => {
    const storage = new MemoryStorage();
    const rawV2 = '{"schemaVersion":"2.0","gameProgress":{}}';
    const changedV2 = ` ${rawV2}`;
    if (mode === 'upgrade') storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);
    const { result } = renderHook(() => useHuntMemoryStore({
      storage, lockManager: new TestLockManager(), now: () => MOCK_TIMESTAMP,
    }));
    const initial = result.current;
    if (race === 'competing-cutover') seedReadyStorage(storage, createBaseStore());
    if (race === 'v2-before-inspection') storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, changedV2);
    if (race === 'v2-removed') storage.removeItem(DEFAULT_PROGRESS_V2_STORAGE_KEY);
    if (race === 'read-error') storage.setReadError(new Error('Cutover inspection read fault'));
    const getItem = storage.getItem.bind(storage);
    let raced = false;
    storage.getItem = (key) => {
      const value = getItem(key);
      if (!raced && key === DEFAULT_PROGRESS_V2_STORAGE_KEY) {
        raced = true;
        if (race === 'v2-after-inspection') storage.seed(key, changedV2);
        if (race === 'cutover-after-inspection') seedReadyStorage(storage, createBaseStore());
      }
      return value;
    };
    const writes = vi.spyOn(storage, 'setItem');
    const removals = vi.spyOn(storage, 'removeItem');
    const action = () => mode === 'upgrade' ? result.current.upgrade(MOCK_TIMESTAMP)
      : result.current.mutate(() => ({ success: true, store: createBaseStore(), changed: true }));
    await act(async () => {
      expect(await action()).toMatchObject(reason === 'STORAGE_ACCESS_ERROR'
        ? { status: 'failure', code: reason } : { status: 'blocked', reason });
    });
    expect(result.current.status).toBe(initial.status);
    expect(result.current.store).toBe(initial.store);
    expect(result.current).toMatchObject({ isStale: true, canSave: false, pendingCandidate: null });
    expect(result.current.staleReason).toContain(reason);
    if (mode === 'fresh') expect(asFresh(result.current).v3Token).toBeNull();
    else expect(asUpgrade(result.current).v2Token).toBe(rawV2);
    const v2After = storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY);
    expect(v2After).toBe(race.startsWith('v2-') && race !== 'v2-removed' ? changedV2
      : mode === 'upgrade' && race !== 'v2-removed' ? rawV2 : null);
    const v3After = storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY);
    const cutoverAfter = storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY);
    expect(v3After).toBe(race === 'competing-cutover' || race === 'cutover-after-inspection'
      ? JSON.stringify(createBaseStore()) : null);
    const readsAfter = storage.readCount;
    await act(async () => {
      expect(await action()).toMatchObject({ status: 'blocked', reason: 'STALE_STORAGE' });
      expect(await result.current.retry()).toMatchObject({ status: 'blocked', reason: 'STALE_STORAGE' });
    });
    expect(storage.readCount).toBe(readsAfter);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(v2After);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(v3After);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(cutoverAfter);
    expect(writes).not.toHaveBeenCalled();
    expect(removals).not.toHaveBeenCalled();
  });

  it.each(['fresh', 'upgrade'] as const)('keeps invalid %s caller input distinct from storage conflicts', async (mode) => {
    const storage = new MemoryStorage();
    if (mode === 'upgrade') storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, '{"schemaVersion":"2.0","gameProgress":{}}');
    const { result } = renderHook(() => useHuntMemoryStore({ storage, lockManager: new TestLockManager(), now: () => MOCK_TIMESTAMP }));
    await act(async () => {
      const invalid = mode === 'upgrade' ? await result.current.upgrade('invalid timestamp')
        // Defensive-invalid caller fixture: required gameProgress is deliberately absent.
        : await result.current.mutate(() => ({ success: true, store: { schemaVersion: '3.0' } as LocalProgressStoreV3, changed: true }));
      expect(invalid).toMatchObject({ status: 'blocked', reason: mode === 'upgrade' ? 'INVALID_MIGRATION_TIMESTAMP' : 'INVALID_CANDIDATE_STORE' });
    });
    expect(result.current.isStale).toBe(false);
    expect(storage.writeCount).toBe(0);
    await act(async () => {
      const valid = mode === 'upgrade' ? await result.current.upgrade(MOCK_TIMESTAMP)
        : await result.current.mutate(() => ({ success: true, store: createBaseStore(), changed: true }));
      expect(valid.status).toBe('success');
    });
    asReady(result.current);
  });

  it.each(['unchanged', 'changed', 'missing', 'unavailable'] as const)('publishes %s legacy metadata on a save immediately after upgrade', async (legacyStatus) => {
    const storage = new MemoryStorage();
    const rawV2 = ' {"schemaVersion":"2.0","gameProgress":{}}';
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);
    const { result } = renderHook(() => useHuntMemoryStore({ storage, lockManager: new TestLockManager(), now: () => MOCK_TIMESTAMP }));
    const { upgrade, mutate } = result.current;
    let cutoverRaw!: string;
    await act(async () => {
      expect((await upgrade(MOCK_TIMESTAMP)).status).toBe('success');
      cutoverRaw = storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)!;
      if (legacyStatus === 'changed') storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, `${rawV2} `);
      if (legacyStatus === 'missing') storage.removeItem(DEFAULT_PROGRESS_V2_STORAGE_KEY);
      if (legacyStatus === 'unavailable') {
        const getItem = storage.getItem.bind(storage);
        storage.getItem = (key) => {
          if (key === DEFAULT_PROGRESS_V2_STORAGE_KEY) throw new Error('Legacy read fault');
          return getItem(key);
        };
      }
      expect((await mutate(() => ({ success: true, store: createBaseStore(), changed: true }))).status).toBe('success');
    });
    const ready = asReady(result.current);
    expect(ready.legacyV2Status).toBe(legacyStatus);
    expect(ready.rawV2).toBe(legacyStatus === 'unavailable' ? null : storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY));
    expect(ready.legacyV2Warning).toBe(legacyStatus === 'changed' ? 'Legacy V2 progress has changed since cutover'
      : legacyStatus === 'unavailable' ? 'Could not check older V2 progress: Legacy read fault' : undefined);
    expect(ready.rawCutover).toBe(cutoverRaw);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(cutoverRaw);
    expect(ready.v3Token).toBe(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY));
    expect(ready.store).toEqual(createBaseStore());
  });

  it('two rapid actions with a deferred lock returns visible busy result to second caller', async () => {
    const lockManager = new TestLockManager();
    lockManager.shouldDefer = true;
    let clockTime = MOCK_TIMESTAMP;
    const now = vi.fn(() => clockTime);
    const { result } = setupReadyHook({ lockManager, now });
    now.mockClear();
    const secondMutation = vi.fn((store: LocalProgressStoreV3, ts: string) => setBinary(store, 'sd-ps-002', true, ts));

    let action1Promise!: Promise<unknown>;
    let action2Result!: Awaited<ReturnType<typeof result.current.mutate>>;

    act(() => {
      action1Promise = result.current.mutate((store, ts) => setBinary(store, 'sd-ps-001', true, ts));
    });
    clockTime = '2026-09-28T12:00:00.000Z';

    expect(result.current.isBusy).toBe(true);
    expect(result.current.canSave).toBe(false);

    await act(async () => {
      action2Result = await result.current.mutate(secondMutation);
    });

    expect(action2Result).toBeDefined();
    expect(action2Result.status).toBe('busy');
    if (action2Result.status === 'busy') {
      expect(action2Result.reason).toBe('OPERATION_IN_FLIGHT');
    }
    expect(secondMutation).not.toHaveBeenCalled();
    expect(now).toHaveBeenCalledTimes(1);

    await act(async () => {
      lockManager.shouldDefer = false;
      await lockManager.deferredResolver!();
      await action1Promise;
    });

    expect(result.current.isBusy).toBe(false);
    expect(result.current.canSave).toBe(true);
    const ready = asReady(result.current);
    expect(ready.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-001'].completed).toBe(true);
    expect(ready.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-001'].lastUpdated).toBe(MOCK_TIMESTAMP);
  });

  it('no-op and domain failure perform zero writes and do not alter undo', async () => {
    const { result, storage } = setupReadyHook();
    const writesBefore = storage.writeCount;

    const failResult = await mutateBinary(result, 'non-existent');
    expect(failResult.status).toBe('mutation-failed');
    if (failResult.status === 'mutation-failed') {
      expect(failResult.code).toBe('ACHIEVEMENT_NOT_FOUND');
    }
    expect(storage.writeCount).toBe(writesBefore);
    const ready1 = asReady(result.current);
    expect(ready1.store.undoState).toBeUndefined();

    const noopResult = await mutateBinary(result, 'sd-ps-001', false);
    expect(noopResult.status).toBe('no-op');
    expect(storage.writeCount).toBe(writesBefore);
    const ready2 = asReady(result.current);
    expect(ready2.store.undoState).toBeUndefined();
  });

  it('successful token rotation verifies stored bytes and updates token', async () => {
    const { result, storage, token: token1 } = setupReadyHook();
    const ready1 = asReady(result.current);
    expect(ready1.v3Token).toBe(token1);

    await mutateBinary(result, 'sd-ps-001');

    const ready2 = asReady(result.current);
    const token2 = ready2.v3Token;
    expect(token2).not.toBe(token1);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(token2);
  });

  it('unchanged-token Retry/Discard and blocked intervening action', async () => {
    const { result, storage, lockManager, token: initialToken } = setupReadyHook();

    storage.setWriteError(new Error('QuotaExceeded'));
    const retryableResult = await mutateBinary(result, 'sd-ps-001');

    expect(retryableResult.status).toBe('retryable-failure');
    expect(result.current.pendingCandidate).not.toBeNull();
    const ready1 = asReady(result.current);
    expect(ready1.v3Token).toBe(initialToken);
    expect(ready1.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-001'].completed).toBe(false);

    const blockedMutationResult = await mutateBinary(result, 'sd-ps-002');
    expect(blockedMutationResult.status).toBe('busy');
    if (blockedMutationResult.status === 'busy') {
      expect(blockedMutationResult.reason).toBe('UNSAVED_CANDIDATE');
    }

    storage.setWriteError(null);
    const pending = result.current.pendingCandidate;
    lockManager.shouldDefer = true;
    let retryPromise!: Promise<HuntMemoryActionResult>;
    act(() => { retryPromise = result.current.retry(); });
    act(() => {
      expect(result.current.discard()).toMatchObject({ status: 'busy', reason: 'OPERATION_IN_FLIGHT' });
    });
    expect(result.current.pendingCandidate).toBe(pending);
    expect(asReady(result.current).v3Token).toBe(initialToken);
    let retryResult!: Awaited<ReturnType<typeof result.current.retry>>;
    await act(async () => {
      lockManager.shouldDefer = false;
      await lockManager.deferredResolver!();
      retryResult = await retryPromise;
    });

    expect(retryResult.status).toBe('success');
    expect(result.current.pendingCandidate).toBeNull();
    const ready2 = asReady(result.current);
    expect(ready2.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-001'].completed).toBe(true);

    storage.setWriteError(new Error('QuotaExceeded'));
    await mutateBinary(result, 'sd-ps-002');
    expect(result.current.pendingCandidate).not.toBeNull();

    act(() => {
      expect(result.current.discard().status).toBe('success');
    });
    expect(result.current.pendingCandidate).toBeNull();
    const ready3 = asReady(result.current);
    expect(ready3.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-002'].completed).toBe(false);
  });

  it('competing writer, state mismatch, and storage access error fail closed and block further writes', async () => {
    const { result, storage, token: initialToken, lockManager } = setupReadyHook();

    const competingStore = createBaseStore();
    competingStore.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-001'].completed = true;
    storage.setItem(DEFAULT_PROGRESS_V3_STORAGE_KEY, JSON.stringify(competingStore));

    const staleSaveResult = await mutateBinary(result, 'sd-ps-001');
    expect(staleSaveResult.status).toBe('blocked');
    if (staleSaveResult.status === 'blocked') {
      expect(staleSaveResult.reason).toBe('STALE_V3_TOKEN');
    }
    expect(result.current.isStale).toBe(true);
    expect(result.current.canSave).toBe(false);
    expect(asReady(result.current).v3Token).toBe(initialToken);

    const writesAfterStale = storage.writeCount;
    let nextResult!: Awaited<ReturnType<typeof result.current.mutate>>;
    await act(async () => {
      nextResult = await result.current.mutate((store) => ({ success: true, store, changed: true }));
    });
    expect(nextResult.status).toBe('blocked');
    if (nextResult.status === 'blocked') {
      expect(nextResult.reason).toBe('STALE_STORAGE');
    }
    expect(storage.writeCount).toBe(writesAfterStale);

    const { result: mismatchHook, storage: storageMismatch, token: tokenMismatch } = setupReadyHook({ lockManager });
    storageMismatch.removeItem(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY);
    storageMismatch.removeItem(DEFAULT_PROGRESS_V3_STORAGE_KEY);

    const mismatchRes = await mutateBinary(mismatchHook, 'sd-ps-001');
    expect(mismatchRes.status).toBe('blocked');
    if (mismatchRes.status === 'blocked') {
      expect(mismatchRes.reason).toBe('STATE_MISMATCH');
    }
    expect(mismatchHook.current.isStale).toBe(true);
    expect(mismatchHook.current.canSave).toBe(false);
    expect(asReady(mismatchHook.current).v3Token).toBe(tokenMismatch);

    const writesAfterMismatch = storageMismatch.writeCount;
    await act(async () => {
      const res = await mismatchHook.current.mutate((s) => ({ success: true, store: s, changed: true }));
      expect(res.status).toBe('blocked');
    });
    expect(storageMismatch.writeCount).toBe(writesAfterMismatch);

    const { result: accessHook, storage: storageAccess, token: tokenAccess } = setupReadyHook({ lockManager });
    storageAccess.setReadError(new Error('Disk read fault'));

    const accessRes = await mutateBinary(accessHook, 'sd-ps-001');
    expect(accessRes.status).toBe('failure');
    if (accessRes.status === 'failure') {
      expect(accessRes.code).toBe('STORAGE_ACCESS_ERROR');
    }
    expect(accessHook.current.isStale).toBe(true);
    expect(accessHook.current.canSave).toBe(false);
    expect(asReady(accessHook.current).v3Token).toBe(tokenAccess);

    const writesAfterAccess = storageAccess.writeCount;
    await act(async () => {
      const res = await accessHook.current.mutate((s) => ({ success: true, store: s, changed: true }));
      expect(res.status).toBe('blocked');
    });
    expect(storageAccess.writeCount).toBe(writesAfterAccess);
  });

  it('ambiguous write / recovery fails closed into recovery-required', async () => {
    const { result, storage } = setupReadyHook();
    storage.removeItem(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY);

    const recActionResult = await mutateBinary(result, 'sd-ps-001');
    expect(recActionResult.status).toBe('recovery-required');
    expect(result.current.status).toBe('recovery-required');
    expect(result.current.canSave).toBe(false);
  });

  it('missing lock manager puts hook into view-only mode with zero writes', async () => {
    const storage = new MemoryStorage();
    seedReadyStorage(storage, createBaseStore());
    const { result } = renderHook(() =>
      useHuntMemoryStore({ storage, lockManager: null }),
    );

    expect(result.current.status).toBe('view-only');
    expect(result.current.canSave).toBe(false);

    const mutateResult = await mutateBinary(result, 'sd-ps-001');
    expect(mutateResult.status).toBe('failure');
    if (mutateResult.status === 'failure') {
      expect(mutateResult.code).toBe('LOCK_UNAVAILABLE');
    }
  });

  it('unmount / listener cleanup and navigation-warning lifetime', async () => {
    const { result, storage, lockManager, unmount } = setupReadyHook();

    const idleEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(idleEvent);
    expect(idleEvent.defaultPrevented).toBe(false);

    lockManager.shouldDefer = true;
    let deferredPromise!: Promise<unknown>;
    act(() => {
      deferredPromise = result.current.mutate((store, ts) => setBinary(store, 'sd-ps-001', true, ts));
    });

    const inFlightEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(inFlightEvent);
    expect(inFlightEvent.defaultPrevented).toBe(true);

    await act(async () => {
      lockManager.shouldDefer = false;
      await lockManager.deferredResolver!();
      await deferredPromise;
    });

    storage.setWriteError(new Error('QuotaExceeded'));
    await mutateBinary(result, 'sd-ps-002');
    expect(result.current.pendingCandidate).not.toBeNull();

    const pendingCandidateEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(pendingCandidateEvent);
    expect(pendingCandidateEvent.defaultPrevented).toBe(true);

    act(() => {
      result.current.discard();
    });
    const afterDiscardEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterDiscardEvent);
    expect(afterDiscardEvent.defaultPrevented).toBe(false);

    unmount();
    const afterUnmountEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterUnmountEvent);
    expect(afterUnmountEvent.defaultPrevented).toBe(false);
  });

  it('confirmed store stays visible until verified success and pending candidate cannot be published by rerender', async () => {
    const lockManager = new TestLockManager();
    lockManager.shouldDefer = true;
    const { result, rerender } = setupReadyHook({ lockManager });

    let actionPromise!: Promise<unknown>;
    act(() => {
      actionPromise = result.current.mutate((store, ts) => setBinary(store, 'sd-ps-001', true, ts));
    });

    rerender();
    expect(result.current.isBusy).toBe(true);
    const ready1 = asReady(result.current);
    expect(ready1.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-001'].completed).toBe(false);

    await act(async () => {
      lockManager.shouldDefer = false;
      await lockManager.deferredResolver!();
      await actionPromise;
    });

    const ready2 = asReady(result.current);
    expect(ready2.store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-001'].completed).toBe(true);
  });

  it.each(['fresh', 'migrated-v2'] as const)('refreshes %s legacy metadata on focus without changing authoritative V3', (source) => {
    const storage = window.localStorage;
    const keys = { v2Key: 'focus-v2', v3Key: 'focus-v3', cutoverKey: 'focus-cutover' };
    const originalV2 = '{"schemaVersion":"2.0","gameProgress":{}}';
    const rawCutover = JSON.stringify(source === 'fresh' ? { recordVersion: 1, source }
      : { recordVersion: 1, source, rawV2: originalV2 });
    const token = JSON.stringify(createBaseStore());
    storage.setItem(keys.v3Key, token);
    storage.setItem(keys.cutoverKey, rawCutover);
    if (source === 'migrated-v2') storage.setItem(keys.v2Key, originalV2);
    const { result } = renderHook(() => useHuntMemoryStore({ storage, keys, lockManager: new TestLockManager() }));
    const confirmed = result.current.store;
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const removals = vi.spyOn(Storage.prototype, 'removeItem');
    const focus = () => {
      writes.mockClear();
      removals.mockClear();
      act(() => { window.dispatchEvent(new Event('focus')); });
      expect(result.current.store).toBe(confirmed);
      expect(asReady(result.current).v3Token).toBe(token);
      expect(asReady(result.current).rawCutover).toBe(rawCutover);
      expect(storage.getItem(keys.v3Key)).toBe(token);
      expect(storage.getItem(keys.cutoverKey)).toBe(rawCutover);
      expect(result.current).toMatchObject({ isStale: false, canSave: true });
      expect(writes).not.toHaveBeenCalled();
      expect(removals).not.toHaveBeenCalled();
    };
    focus();
    expect(asReady(result.current).legacyV2Status).toBe(source === 'fresh' ? 'not-applicable' : 'unchanged');
    const changedV2 = ` ${originalV2}`;
    storage.setItem(keys.v2Key, changedV2);
    focus();
    expect(asReady(result.current)).toMatchObject({ legacyV2Status: 'changed', rawV2: changedV2 });
    expect(asReady(result.current).legacyV2Warning).toBe(source === 'fresh'
      ? 'Unexpected legacy V2 progress detected after fresh cutover' : 'Legacy V2 progress has changed since cutover');
    storage.removeItem(keys.v2Key);
    focus();
    expect(asReady(result.current)).toMatchObject({ legacyV2Status: source === 'fresh' ? 'not-applicable' : 'missing', rawV2: null });
    expect(asReady(result.current).legacyV2Warning).toBeUndefined();
    const getItem = storage.getItem.bind(storage);
    const readFault = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === keys.v2Key) throw new Error('Focus legacy read fault');
      return getItem(key);
    });
    focus();
    expect(asReady(result.current)).toMatchObject({ legacyV2Status: 'unavailable', rawV2: null });
    expect(asReady(result.current).legacyV2Warning).toContain('Focus legacy read fault');
    readFault.mockRestore();
    if (source === 'migrated-v2') storage.setItem(keys.v2Key, originalV2);
    focus();
    expect(asReady(result.current).legacyV2Status).toBe(source === 'fresh' ? 'not-applicable' : 'unchanged');
    expect(asReady(result.current).legacyV2Warning).toBeUndefined();
  });

  it.each([
    [DEFAULT_PROGRESS_V3_STORAGE_KEY, 'changed'],
    [DEFAULT_PROGRESS_V3_STORAGE_KEY, 'missing'],
    [DEFAULT_PROGRESS_V3_STORAGE_KEY, 'unreadable'],
    [DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, 'changed'],
    [DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, 'missing'],
    [DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, 'unreadable'],
    [null, 'cleared'],
  ] as const)('fails closed on focus when %s is %s', async (key, fault) => {
    const storage = window.localStorage;
    const token = JSON.stringify(createBaseStore());
    const rawCutover = JSON.stringify({ recordVersion: 1, source: 'fresh' });
    storage.setItem(DEFAULT_PROGRESS_V3_STORAGE_KEY, token);
    storage.setItem(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, rawCutover);
    const { result } = renderHook(() => useHuntMemoryStore({ storage, lockManager: new TestLockManager() }));
    const confirmed = result.current.store;
    if (key === null) storage.clear();
    else if (fault === 'changed') storage.setItem(key, ` ${storage.getItem(key)}`);
    else if (fault === 'missing') storage.removeItem(key);
    const actualV3 = storage.getItem(DEFAULT_PROGRESS_V3_STORAGE_KEY);
    const actualCutover = storage.getItem(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY);
    const getItem = storage.getItem.bind(storage);
    if (fault === 'unreadable') {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation((readKey) => {
        if (readKey === key) throw new Error('Focus authoritative read fault');
        return getItem(readKey);
      });
    }
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const removals = vi.spyOn(Storage.prototype, 'removeItem');
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(result.current).toMatchObject({ isStale: true, canSave: false, pendingCandidate: null });
    expect(result.current.staleReason).toBeTruthy();
    if (fault === 'unreadable') expect(result.current.staleReason).toContain('STORAGE_ACCESS_ERROR');
    expect(result.current.store).toBe(confirmed);
    expect(asReady(result.current).v3Token).toBe(token);
    expect(asReady(result.current).rawCutover).toBe(rawCutover);
    await act(async () => {
      expect(await result.current.mutate(() => ({ success: true, store: createBaseStore(), changed: true })))
        .toMatchObject({ status: 'blocked', reason: 'STALE_STORAGE' });
    });
    expect(getItem(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(actualV3);
    expect(getItem(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(actualCutover);
    expect(writes).not.toHaveBeenCalled();
    expect(removals).not.toHaveBeenCalled();
  });

  it('browser storage events: ignores foreign/identical events, marks stale on cutover change, and blocks retry', async () => {
    const lockManager = new TestLockManager();
    const { result: memResult, storage: memStorage } = setupReadyHook({ lockManager });

    const memoryReads = memStorage.readCount;
    memStorage.setReadError(new Error('Injected storage must not receive browser focus reads'));
    window.dispatchEvent(new StorageEvent('storage', { key: DEFAULT_PROGRESS_V3_STORAGE_KEY, newValue: 'foreign' }));
    window.dispatchEvent(new Event('focus'));
    expect(memResult.current.isStale).toBe(false);
    expect(memStorage.readCount).toBe(memoryReads);

    window.localStorage.clear();
    const cutoverRaw = JSON.stringify({ recordVersion: 1, source: 'fresh' });
    const initialV3 = JSON.stringify(createBaseStore());
    window.localStorage.setItem(DEFAULT_PROGRESS_V3_STORAGE_KEY, initialV3);
    window.localStorage.setItem(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, cutoverRaw);

    const { result: lsResult } = renderHook(() =>
      useHuntMemoryStore({ storage: window.localStorage, lockManager, now: () => MOCK_TIMESTAMP }),
    );

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
        newValue: cutoverRaw,
        storageArea: window.localStorage,
      }));
    });
    expect(lsResult.current.isStale).toBe(false);
    expect(lsResult.current.canSave).toBe(true);

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    await mutateBinary(lsResult, 'sd-ps-001');
    setItemSpy.mockRestore();
    expect(lsResult.current.pendingCandidate).not.toBeNull();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
        newValue: JSON.stringify({ recordVersion: 2, source: 'external' }),
        storageArea: window.localStorage,
      }));
    });
    expect(lsResult.current.isStale).toBe(true);
    expect(lsResult.current.canSave).toBe(false);

    let retryResult!: Awaited<ReturnType<typeof lsResult.current.retry>>;
    await act(async () => {
      retryResult = await lsResult.current.retry();
    });
    expect(retryResult.status).toBe('blocked');
    if (retryResult.status === 'blocked') expect(retryResult.reason).toBe('STALE_STORAGE');
    expect(window.localStorage.getItem(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(initialV3);
    expect(lsResult.current.pendingCandidate).not.toBeNull();
    expect(asReady(lsResult.current).store.gameProgress['stellar-drift'].sets['stellar-drift-ps'].runs['default-run'].progress['sd-ps-001'].completed).toBe(false);

    act(() => {
      expect(lsResult.current.discard().status).toBe('success');
    });
    expect(lsResult.current.pendingCandidate).toBeNull();
    window.localStorage.clear();
  });
});
