import { describe, expect, it } from 'vitest';
import { MemoryStorage as BaseMemoryStorage } from '../test/memory-storage';
import { transformProgressStoreV2ToV3 } from '../domain/progress-migration';
import {
  DEFAULT_PROGRESS_V2_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_STORAGE_KEY,
  createDefaultHuntMemoryStore,
  inspectHuntMemoryStorage,
} from './hunt-memory-storage';
import type { LocalProgressStoreV3 } from '../domain/hunt-memory-schema';
import {
  PROGRESS_V3_WRITE_LOCK_NAME,
  executeHuntMemoryCutover,
  type WebLockCallback,
  type WebLockManagerLike,
} from './hunt-memory-cutover';

const MIGRATION_TS = '2026-07-23T00:00:00.000Z';

class TrackingMemoryStorage extends BaseMemoryStorage {
  readonly setItemCalls: Array<{ key: string; value: string }> = [];
  readonly removeItemCalls: string[] = [];
  readonly getItemCalls: string[] = [];

  override getItem(key: string): string | null {
    this.getItemCalls.push(key);
    return super.getItem(key);
  }

  override setItem(key: string, value: string): void {
    this.setItemCalls.push({ key, value });
    super.setItem(key, value);
  }

  override removeItem(key: string): void {
    this.removeItemCalls.push(key);
    super.removeItem(key);
  }
}

function onPostWrite(
  storage: TrackingMemoryStorage,
  targetKey: string,
  hook: () => string | null,
): void {
  let written = false;
  const origSet = storage.setItem.bind(storage);
  storage.setItem = (k, v) => {
    if (k === targetKey) written = true;
    origSet(k, v);
  };
  const origGet = storage.getItem.bind(storage);
  storage.getItem = (k) => {
    if (k === targetKey && written) return hook();
    return origGet(k);
  };
}

function assertZeroV3Writes(storage: TrackingMemoryStorage): void {
  expect(
    storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V3_STORAGE_KEY),
  ).toBe(false);
  expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBeNull();
}

class FakeWebLockManager implements WebLockManagerLike {
  private active = false;
  private readonly queue: Array<() => Promise<void>> = [];
  readonly events: string[] = [];

  async request<T>(
    name: string,
    optionsOrCallback:
      | { readonly mode?: 'exclusive' | 'shared'; readonly signal?: AbortSignal }
      | WebLockCallback<T>,
    maybeCallback?: WebLockCallback<T>,
  ): Promise<T> {
    const callback =
      typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;

    this.events.push(`request:${name}`);

    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        this.active = true;
        this.events.push(`acquire:${name}`);
        try {
          const result = await callback();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.active = false;
          this.events.push(`release:${name}`);
          this.processNext();
        }
      };

      this.queue.push(execute);
      if (!this.active) this.processNext();
    });
  }

  private processNext(): void {
    if (this.queue.length === 0 || this.active) return;
    const next = this.queue.shift();
    if (next) void next();
  }
}

class RejectingLockManager implements WebLockManagerLike {
  constructor(private readonly message = 'Lock acquisition rejected') {}
  async request<T>(): Promise<T> {
    throw new Error(this.message);
  }
}

function createV2Fixture(): unknown {
  return {
    schemaVersion: '2.0',
    gameProgress: {
      'game-a': {
        gameId: 'game-a',
        preferredSetId: 'set-a',
        sets: {
          'set-a': {
            setId: 'set-a',
            version: '1.0',
            activeStage: 'story',
            pinnedAchievementIds: ['ach-binary'],
            progress: {
              'ach-binary': {
                achievementId: 'ach-binary', completed: true, manualOverride: false,
                notes: 'preserved notes', lastUpdated: '2026-07-22T00:00:00.000Z', provenance: 'manual',
              },
            },
          },
        },
        orphanedProgress: {},
      },
    },
  };
}

function createCandidateV3Fixture(): LocalProgressStoreV3 {
  const result = transformProgressStoreV2ToV3(createV2Fixture(), MIGRATION_TS);
  if (!result.success) throw new Error('Fixture transformation failed');
  return result.store;
}

describe('T03B-B3A1B First V3 Write And Cutover Executor', () => {
  it('requirement 1 & 2: no calls from inspection, separate explicit API, and Web Lock required', async () => {
    const storage = new TrackingMemoryStorage();
    const rawV2 = JSON.stringify(createV2Fixture());
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    const inspection = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(inspection.status).toBe('upgrade-required');
    expect(storage.setItemCalls.length).toBe(0);
    expect(storage.removeItemCalls.length).toBe(0);

    const noLockRes = await executeHuntMemoryCutover(
      storage,
      {
        mode: 'upgrade',
        expectedV2Token: rawV2,
        migratedAt: MIGRATION_TS,
      },
      { lockManager: null },
    );
    expect(noLockRes.status).toBe('failure');
    if (noLockRes.status === 'failure') {
      expect(noLockRes.code).toBe('LOCK_UNAVAILABLE');
    }
    expect(storage.setItemCalls.length).toBe(0);
  });

  it('requirement 2 & 8: returns failure on lock acquisition rejection with zero writes', async () => {
    const storage = new TrackingMemoryStorage();
    const rawV2 = JSON.stringify(createV2Fixture());
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    const res = await executeHuntMemoryCutover(
      storage,
      {
        mode: 'upgrade',
        expectedV2Token: rawV2,
        migratedAt: MIGRATION_TS,
      },
      { lockManager: new RejectingLockManager('Denied by platform') },
    );
    expect(res.status).toBe('failure');
    if (res.status === 'failure') {
      expect(res.code).toBe('LOCK_ACQUISITION_REJECTED');
      expect(res.message).toContain('Denied by platform');
    }
    expect(storage.setItemCalls.length).toBe(0);
    expect(storage.removeItemCalls.length).toBe(0);
  });

  it('requirement 2, 4, 16, 17, 18: V2 upgrade writes cutover first then V3, preserves exact V2 bytes', async () => {
    const storage = new TrackingMemoryStorage();
    const lockManager = new FakeWebLockManager();
    const rawV2 = '  {\n  "schemaVersion": "2.0",\n  "gameProgress": {}\n}  ';
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    const res = await executeHuntMemoryCutover(
      storage,
      {
        mode: 'upgrade',
        expectedV2Token: rawV2,
        migratedAt: MIGRATION_TS,
      },
      { lockManager },
    );

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;

    expect(res.mode).toBe('upgrade');
    expect(res.v2Token).toBe(rawV2);
    expect(res.cutoverRecord).toEqual({
      recordVersion: 1,
      source: 'migrated-v2',
      rawV2,
    });
    expect(res.store.schemaVersion).toBe('3.0');

    expect(storage.setItemCalls.length).toBe(2);
    expect(storage.setItemCalls[0].key).toBe(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY);
    expect(storage.setItemCalls[1].key).toBe(DEFAULT_PROGRESS_V3_STORAGE_KEY);

    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(rawV2);
    expect(storage.removeItemCalls.length).toBe(0);
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);

    expect(lockManager.events).toEqual([
      `request:${PROGRESS_V3_WRITE_LOCK_NAME}`,
      `acquire:${PROGRESS_V3_WRITE_LOCK_NAME}`,
      `release:${PROGRESS_V3_WRITE_LOCK_NAME}`,
    ]);
  });

  it('requirement 3: fresh first mutation writes fresh cutover record and candidate V3', async () => {
    const storage = new TrackingMemoryStorage();
    const lockManager = new FakeWebLockManager();
    const candidate = createDefaultHuntMemoryStore();

    const res = await executeHuntMemoryCutover(
      storage,
      {
        mode: 'fresh',
        candidateStore: candidate,
      },
      { lockManager },
    );

    expect(res.status).toBe('success');
    if (res.status !== 'success') return;

    expect(res.mode).toBe('fresh');
    expect(res.cutoverRecord).toEqual({
      recordVersion: 1,
      source: 'fresh',
    });
    expect(res.store).toEqual(candidate);

    expect(storage.setItemCalls.length).toBe(2);
    expect(storage.setItemCalls[0].key).toBe(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY);
    expect(storage.setItemCalls[1].key).toBe(DEFAULT_PROGRESS_V3_STORAGE_KEY);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBeNull();
    expect(storage.removeItemCalls.length).toBe(0);
  });

  it('requirement 4: pre-lock preview becoming stale blocks with zero writes', async () => {
    const storage = new TrackingMemoryStorage();
    const lockManager = new FakeWebLockManager();
    const originalV2 = JSON.stringify(createV2Fixture());
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, originalV2);

    const staleRes = await executeHuntMemoryCutover(
      storage,
      {
        mode: 'upgrade',
        expectedV2Token: '{"schemaVersion":"2.0","old":true}',
        migratedAt: MIGRATION_TS,
      },
      { lockManager },
    );

    expect(staleRes.status).toBe('blocked');
    if (staleRes.status === 'blocked') {
      expect(staleRes.reason).toBe('STALE_V2_TOKEN');
    }
    expect(storage.setItemCalls.length).toBe(0);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(originalV2);
  });

  it.each(['upgrade', 'fresh'] as const)(
    'requirement 5: %s refuses V2 changes after inspection without writing',
    async (mode) => {
      const storage = new TrackingMemoryStorage();
      const originalV2 = JSON.stringify(createV2Fixture());
      const driftedV2 = `${originalV2} `;
      if (mode === 'upgrade') {
        storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, originalV2);
      }

      let readV2Count = 0;
      const origGet = storage.getItem.bind(storage);
      storage.getItem = (k: string) => {
        const value = origGet(k);
        if (k === DEFAULT_PROGRESS_V2_STORAGE_KEY && ++readV2Count === 1) {
          storage.seed(k, driftedV2);
        }
        return value;
      };

      const driftRes = await executeHuntMemoryCutover(
        storage,
        mode === 'upgrade'
          ? {
              mode,
              expectedV2Token: originalV2,
              migratedAt: MIGRATION_TS,
            }
          : { mode, candidateStore: createDefaultHuntMemoryStore() },
        { lockManager: new FakeWebLockManager() },
      );
      expect(driftRes).toMatchObject({
        status: 'blocked',
        reason: 'SOURCE_V2_CHANGED',
      });
      expect(storage.setItemCalls.length).toBe(0);
      expect(storage.removeItemCalls.length).toBe(0);
      expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(driftedV2);
      expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBeNull();
      assertZeroV3Writes(storage);
    },
  );

  it('requirement 6: two competing first writes serialize; one wins and one blocks without writes', async () => {
    const storage = new TrackingMemoryStorage();
    const lockManager = new FakeWebLockManager();
    const candidate1 = createDefaultHuntMemoryStore();
    const candidate2 = createDefaultHuntMemoryStore();

    const write1 = executeHuntMemoryCutover(
      storage,
      { mode: 'fresh', candidateStore: candidate1 },
      { lockManager },
    );
    const write2 = executeHuntMemoryCutover(
      storage,
      { mode: 'fresh', candidateStore: candidate2 },
      { lockManager },
    );

    const [res1, res2] = await Promise.all([write1, write2]);

    expect(res1.status).toBe('success');
    expect(res2.status).toBe('blocked');
    if (res2.status === 'blocked') {
      expect(res2.reason).toBe('STATE_MISMATCH');
      expect(res2.details?.inspectionStatus).toBe('loaded-v3');
    }

    expect(storage.setItemCalls.length).toBe(2);
    expect(lockManager.events).toEqual([
      `request:${PROGRESS_V3_WRITE_LOCK_NAME}`,
      `acquire:${PROGRESS_V3_WRITE_LOCK_NAME}`,
      `request:${PROGRESS_V3_WRITE_LOCK_NAME}`,
      `release:${PROGRESS_V3_WRITE_LOCK_NAME}`,
      `acquire:${PROGRESS_V3_WRITE_LOCK_NAME}`,
      `release:${PROGRESS_V3_WRITE_LOCK_NAME}`,
    ]);
  });

  it('requirement 7: existing/invalid V3 or record, and record-only interrupted states block without writes', async () => {
    const lockManager = new FakeWebLockManager();
    const recoveryCases = [
      { [DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY]: '{"recordVersion":1,"source":"fresh"}' },
      { [DEFAULT_PROGRESS_V3_STORAGE_KEY]: JSON.stringify(createCandidateV3Fixture()) },
      { [DEFAULT_PROGRESS_V3_STORAGE_KEY]: 'invalid json' },
    ];

    for (const seeds of recoveryCases) {
      const storage = new TrackingMemoryStorage();
      for (const [k, v] of Object.entries(seeds)) storage.seed(k, v);

      const res = await executeHuntMemoryCutover(
        storage,
        { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
        { lockManager },
      );
      expect(res.status).toBe('recovery-required');
      if (res.status === 'recovery-required') {
        expect(res.reason).toBe('EXISTING_RECOVERY_STATE');
      }
      expect(storage.setItemCalls.length).toBe(0);
      expect(storage.removeItemCalls.length).toBe(0);
    }
  });

  it('requirement 9: invalid candidate, timestamp, and key configurations fail cleanly without writes', async () => {
    const lockManager = new FakeWebLockManager();
    const storage = new TrackingMemoryStorage();

    const badCandRes = await executeHuntMemoryCutover(
      storage,
      { mode: 'fresh', candidateStore: { not: 'a valid store' } },
      { lockManager },
    );
    expect(badCandRes.status).toBe('blocked');
    if (badCandRes.status === 'blocked') {
      expect(badCandRes.reason).toBe('INVALID_CANDIDATE_STORE');
    }

    const badTsRes = await executeHuntMemoryCutover(
      storage,
      { mode: 'upgrade', expectedV2Token: '{}', migratedAt: 'invalid-date' },
      { lockManager },
    );
    expect(badTsRes.status).toBe('blocked');
    if (badTsRes.status === 'blocked') {
      expect(badTsRes.reason).toBe('INVALID_MIGRATION_TIMESTAMP');
    }

    const badKeysRes = await executeHuntMemoryCutover(
      storage,
      { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
      { lockManager, keys: { v2Key: 'same', v3Key: 'same', cutoverKey: 'same' } },
    );
    expect(badKeysRes.status).toBe('blocked');
    if (badKeysRes.status === 'blocked') {
      expect(badKeysRes.reason).toBe('INVALID_STORAGE_KEYS');
    }

    expect(storage.setItemCalls.length).toBe(0);
  });

  it('requirement 10: read failures during inspection, pre-write checks, and final source check fail without writing', async () => {
    const lockManager = new FakeWebLockManager();

    const inspectStorage = new TrackingMemoryStorage();
    inspectStorage.getItem = (k: string) => {
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) throw new Error('Disk I/O error during inspection read');
      return BaseMemoryStorage.prototype.getItem.call(inspectStorage, k);
    };
    const inspectRes = await executeHuntMemoryCutover(
      inspectStorage,
      { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
      { lockManager },
    );
    expect(inspectRes.status).toBe('failure');
    if (inspectRes.status === 'failure') {
      expect(inspectRes.code).toBe('STORAGE_ACCESS_ERROR');
      expect(inspectRes.message).toContain('Disk I/O error during inspection read');
    }
    expect(inspectStorage.setItemCalls.length).toBe(0);

    const preWriteStorage = new TrackingMemoryStorage();
    let cutoverReads = 0;
    const origGetPre = preWriteStorage.getItem.bind(preWriteStorage);
    preWriteStorage.getItem = (k: string) => {
      if (k === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY && ++cutoverReads === 2) {
        throw new Error('Disk I/O error during pre-write absence check');
      }
      return origGetPre(k);
    };
    const preWriteRes = await executeHuntMemoryCutover(
      preWriteStorage,
      { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
      { lockManager },
    );
    expect(preWriteRes.status).toBe('failure');
    if (preWriteRes.status === 'failure') {
      expect(preWriteRes.code).toBe('STORAGE_ACCESS_ERROR');
      expect(preWriteRes.message).toContain('Disk I/O error during pre-write absence check');
    }
    expect(preWriteStorage.setItemCalls.length).toBe(0);

    const finalV2Storage = new TrackingMemoryStorage();
    const rawV2 = JSON.stringify(createV2Fixture());
    finalV2Storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    let v2ReadCount = 0;
    const origGet = finalV2Storage.getItem.bind(finalV2Storage);
    finalV2Storage.getItem = (k: string) => {
      if (k === DEFAULT_PROGRESS_V2_STORAGE_KEY && ++v2ReadCount === 2) {
        throw new Error('Disk I/O error at final source check');
      }
      return origGet(k);
    };

    const finalV2Res = await executeHuntMemoryCutover(
      finalV2Storage,
      { mode: 'upgrade', expectedV2Token: rawV2, migratedAt: MIGRATION_TS },
      { lockManager },
    );
    expect(finalV2Res.status).toBe('failure');
    if (finalV2Res.status === 'failure') {
      expect(finalV2Res.code).toBe('STORAGE_ACCESS_ERROR');
      expect(finalV2Res.message).toContain('Disk I/O error at final source check');
    }
    expect(finalV2Storage.setItemCalls.length).toBe(0);
  });

  it('requirement 11 & 12: cutover record write failure or read-back mismatch never attempts V3', async () => {
    const lockManager = new FakeWebLockManager();

    const storage1 = new TrackingMemoryStorage();
    storage1.setItem = (k, v) => {
      if (k === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY) {
        throw new Error('Quota exceeded on cutover record write');
      }
      BaseMemoryStorage.prototype.setItem.call(storage1, k, v);
    };
    const res1 = await executeHuntMemoryCutover(
      storage1,
      { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
      { lockManager },
    );
    expect(res1.status).toBe('failure');
    if (res1.status === 'failure') {
      expect(res1.code).toBe('RECORD_WRITE_ERROR');
      expect(res1.rawCutover).toBeNull();
    }
    expect(storage1.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBeNull();
    assertZeroV3Writes(storage1);

    const storage2 = new TrackingMemoryStorage();
    storage2.setItem = (k, v) => {
      if (k === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY) {
        return;
      }
      BaseMemoryStorage.prototype.setItem.call(storage2, k, v);
    };
    const res2 = await executeHuntMemoryCutover(
      storage2,
      { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
      { lockManager },
    );
    expect(res2.status).toBe('failure');
    if (res2.status === 'failure') {
      expect(res2.code).toBe('RECORD_WRITE_ERROR');
      expect(res2.rawCutover).toBeNull();
    }
    expect(storage2.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBeNull();
    assertZeroV3Writes(storage2);

    const storage3 = new TrackingMemoryStorage();
    const differentRecord = '{"corrupted":true}';
    storage3.setItem = (k, v) => {
      if (k === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY) {
        BaseMemoryStorage.prototype.setItem.call(storage3, k, differentRecord);
        return;
      }
      BaseMemoryStorage.prototype.setItem.call(storage3, k, v);
    };
    const res3 = await executeHuntMemoryCutover(
      storage3,
      { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
      { lockManager },
    );
    expect(res3.status).toBe('recovery-required');
    if (res3.status === 'recovery-required') {
      expect(res3.reason).toBe('RECORD_WRITE_DIFFERENT');
      expect(res3.rawCutover).toBe(differentRecord);
    }
    expect(storage3.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(differentRecord);
    assertZeroV3Writes(storage3);

    const storage4 = new TrackingMemoryStorage();
    onPostWrite(storage4, DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, () => {
      throw new Error('Unreadable storage on cutover read-back');
    });
    const res4 = await executeHuntMemoryCutover(
      storage4,
      { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
      { lockManager },
    );
    expect(res4.status).toBe('recovery-required');
    if (res4.status === 'recovery-required') {
      expect(res4.reason).toBe('RECORD_WRITE_UNREADABLE');
      expect(res4.message).toContain('Unreadable storage on cutover read-back');
    }
    assertZeroV3Writes(storage4);
  });

  it('requirement 11 (post-commit exception): cutover record write throws after commit, read-back establishes write and proceeds to V3', async () => {
    const lockManager = new FakeWebLockManager();
    const storage = new TrackingMemoryStorage();

    const origSet = storage.setItem.bind(storage);
    storage.setItem = (k, v) => {
      origSet(k, v);
      if (k === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY) {
        throw new Error('Simulated QuotaExceeded thrown after write commit');
      }
    };

    const res = await executeHuntMemoryCutover(
      storage,
      { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
      { lockManager },
    );

    expect(res.status).toBe('success');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).not.toBeNull();
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).not.toBeNull();
  });

  it('requirement 13 & 14: V3 write failure or unverified read-back leaves cutover record in place and enters recovery', async () => {
    const lockManager = new FakeWebLockManager();
    const faults: Array<(s: TrackingMemoryStorage) => void> = [
      (s) => {
        s.setItem = (k, v) => {
          if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) throw new Error('Disk write failed on V3 key');
          BaseMemoryStorage.prototype.setItem.call(s, k, v);
        };
      },
      (s) => onPostWrite(s, DEFAULT_PROGRESS_V3_STORAGE_KEY, () => null),
      (s) => onPostWrite(s, DEFAULT_PROGRESS_V3_STORAGE_KEY, () => '{"corrupted":"bytes"}'),
      (s) => onPostWrite(s, DEFAULT_PROGRESS_V3_STORAGE_KEY, () => {
        throw new Error('Read error on V3 verification');
      }),
    ];

    for (const applyFault of faults) {
      const storage = new TrackingMemoryStorage();
      applyFault(storage);

      const res = await executeHuntMemoryCutover(
        storage,
        { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
        { lockManager },
      );

      expect(res.status).toBe('recovery-required');
      if (res.status === 'recovery-required') {
        expect(res.reason).toBe('INTERRUPTED_WRITE_V3_UNVERIFIED');
        expect(res.cutoverRecord).toEqual({
          recordVersion: 1,
          source: 'fresh',
        });
      }

      expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).not.toBeNull();
      expect(storage.removeItemCalls.length).toBe(0);
      expect('store' in res).toBe(false);
    }
  });

  it('requirement 13 (post-commit exception): V3 write throws after commit, read-back establishes write and returns success', async () => {
    const lockManager = new FakeWebLockManager();
    const storage = new TrackingMemoryStorage();

    const origSet = storage.setItem.bind(storage);
    storage.setItem = (k, v) => {
      origSet(k, v);
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) {
        throw new Error('Simulated QuotaExceeded thrown after V3 commit');
      }
    };

    const res = await executeHuntMemoryCutover(
      storage,
      { mode: 'fresh', candidateStore: createDefaultHuntMemoryStore() },
      { lockManager },
    );

    expect(res.status).toBe('success');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).not.toBeNull();
  });

  it('requirement 15 & 19: exact read-back success proof, no false success, and later V2 drift leaves V3 authoritative', async () => {
    const storage = new TrackingMemoryStorage();
    const lockManager = new FakeWebLockManager();
    const rawV2 = JSON.stringify(createV2Fixture());
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    const cutoverRes = await executeHuntMemoryCutover(
      storage,
      { mode: 'upgrade', expectedV2Token: rawV2, migratedAt: MIGRATION_TS },
      { lockManager },
    );
    expect(cutoverRes.status).toBe('success');
    if (cutoverRes.status !== 'success') return;

    storage.seed(
      DEFAULT_PROGRESS_V2_STORAGE_KEY,
      '{"schemaVersion":"2.0","drifted":true}',
    );

    const postCutoverInspection = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(postCutoverInspection.status).toBe('loaded-v3');
    if (postCutoverInspection.status === 'loaded-v3') {
      expect(postCutoverInspection.legacyV2Status).toBe('changed');
      expect(postCutoverInspection.store).toEqual(cutoverRes.store);
      expect(postCutoverInspection.v3Token).toBe(cutoverRes.v3Token);
    }
  });
});
