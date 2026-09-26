import { describe, expect, it } from 'vitest';
import { MemoryStorage as BaseMemoryStorage } from '../test/memory-storage';
import {
  DEFAULT_PROGRESS_V2_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_STORAGE_KEY,
  createDefaultHuntMemoryStore,
} from './hunt-memory-storage';
import {
  type WebLockCallback,
  type WebLockManagerLike,
} from './hunt-memory-write-lock';
import { saveHuntMemoryProgress } from './hunt-memory-save';
import {
  LocalProgressStoreV3Schema,
  type LocalProgressStoreV3,
} from '../domain/hunt-memory-schema';

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

class FakeWebLockManager implements WebLockManagerLike {
  private active = false;
  private readonly queue: Array<() => Promise<void>> = [];
  readonly events: string[] = [];
  readonly requestModes: Array<'exclusive' | 'shared' | undefined> = [];

  async request<T>(
    name: string,
    optionsOrCallback: { readonly mode?: 'exclusive' | 'shared'; readonly signal?: AbortSignal } | WebLockCallback<T>,
    maybeCallback?: WebLockCallback<T>,
  ): Promise<T> {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;
    this.events.push(`request:${name}`);
    this.requestModes.push(typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback.mode);

    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        this.active = true;
        this.events.push(`acquire:${name}`);
        try {
          resolve(await callback());
        } catch (err) {
          reject(err);
        } finally {
          this.active = false;
          this.events.push(`release:${name}`);
          this.processNext();
        }
      });
      if (!this.active) this.processNext();
    });
  }

  private processNext(): void {
    if (this.queue.length > 0 && !this.active) {
      const next = this.queue.shift()!;
      void next();
    }
  }
}

function createBaseStore(): LocalProgressStoreV3 {
  const store = createDefaultHuntMemoryStore();
  store.lastGameId = 'game-1';
  store.gameProgress['game-1'] = { gameId: 'game-1', sets: {}, retiredSets: {} };
  return LocalProgressStoreV3Schema.parse(store);
}

function createUpdatedStore(store: LocalProgressStoreV3): LocalProgressStoreV3 {
  const next = JSON.parse(JSON.stringify(store)) as LocalProgressStoreV3;
  next.lastGameId = 'game-2';
  next.gameProgress['game-2'] = { gameId: 'game-2', sets: {}, retiredSets: {} };
  return LocalProgressStoreV3Schema.parse(next);
}

function seedFreshCutover(storage: TrackingMemoryStorage, store: LocalProgressStoreV3): string {
  const rawV3 = JSON.stringify(store);
  storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
  storage.seed(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, JSON.stringify({ recordVersion: 1, source: 'fresh' }));
  return rawV3;
}

function seedMigratedCutover(
  storage: TrackingMemoryStorage,
  store: LocalProgressStoreV3,
  rawV2 = '{"schemaVersion":"2.0"}',
): string {
  const rawV3 = JSON.stringify(store);
  storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);
  storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
  storage.seed(
    DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
    JSON.stringify({ recordVersion: 1, source: 'migrated-v2', rawV2 }),
  );
  return rawV3;
}

function setupFreshFixture() {
  const storage = new TrackingMemoryStorage();
  const lockManager = new FakeWebLockManager();
  const baseStore = createBaseStore();
  const token = seedFreshCutover(storage, baseStore);
  const candidate = createUpdatedStore(baseStore);
  return { storage, lockManager, baseStore, token, candidate };
}

describe('Schema 3.0 ordinary locked V3 save', () => {
  it('saves an ordinary V3 progress mutation after fresh cutover with exact token verification and single write', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.store).toEqual(candidate);
    expect(result.v3Token).toBe(JSON.stringify(candidate));
    expect(result.cutoverRecord).toEqual({ recordVersion: 1, source: 'fresh' });
    expect(lockManager.requestModes).toEqual(['exclusive']);
    expect(lockManager.events).toEqual([
      'request:trophy-oracle.progress.v3-write',
      'acquire:trophy-oracle.progress.v3-write',
      'release:trophy-oracle.progress.v3-write',
    ]);

    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(result.v3Token);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(
      JSON.stringify({ recordVersion: 1, source: 'fresh' }),
    );
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBeNull();

    const v3Writes = storage.setItemCalls.filter((c) => c.key === DEFAULT_PROGRESS_V3_STORAGE_KEY);
    expect(v3Writes).toHaveLength(1);
    expect(v3Writes[0].value).toBe(result.v3Token);
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls).toHaveLength(0);
  });

  it('saves an ordinary V3 progress mutation after migrated-v2 cutover preserving V2 and cutover record', async () => {
    const storage = new TrackingMemoryStorage();
    const lockManager = new FakeWebLockManager();
    const baseStore = createBaseStore();
    const rawV2 = '{"schemaVersion":"2.0","games":{}}';
    const token = seedMigratedCutover(storage, baseStore, rawV2);
    const candidate = createUpdatedStore(baseStore);

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.store).toEqual(candidate);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(rawV2);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(
      JSON.stringify({ recordVersion: 1, source: 'migrated-v2', rawV2 }),
    );
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls).toHaveLength(0);
  });

  it('blocks on stale expected V3 token with zero writes and detailed actual token report', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();

    const result = await saveHuntMemoryProgress(storage, 'stale-token-123', candidate, { lockManager });

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;

    expect(result.reason).toBe('STALE_V3_TOKEN');
    expect(result.details?.expectedToken).toBe('stale-token-123');
    expect(result.details?.actualToken).toBe(token);
    expect(storage.setItemCalls).toHaveLength(0);
    expect(storage.removeItemCalls).toHaveLength(0);
  });

  it('serializes competing tabs under the Web Lock: one winner advances token, subsequent tab encounters stale token', async () => {
    const { storage, lockManager, baseStore, token } = setupFreshFixture();

    const candidate1 = createUpdatedStore(baseStore);
    const candidate2 = JSON.parse(JSON.stringify(baseStore)) as LocalProgressStoreV3;
    candidate2.lastGameId = 'game-competitor';
    candidate2.gameProgress['game-competitor'] = { gameId: 'game-competitor', sets: {}, retiredSets: {} };

    const p1 = saveHuntMemoryProgress(storage, token, candidate1, { lockManager });
    const p2 = saveHuntMemoryProgress(storage, token, candidate2, { lockManager });

    const [res1, res2] = await Promise.all([p1, p2]);

    expect(res1.status).toBe('success');
    expect(res2.status).toBe('blocked');
    if (res2.status === 'blocked') {
      expect(res2.reason).toBe('STALE_V3_TOKEN');
      expect(res2.details?.actualToken).toBe(JSON.stringify(candidate1));
    }

    const v3Writes = storage.setItemCalls.filter((c) => c.key === DEFAULT_PROGRESS_V3_STORAGE_KEY);
    expect(v3Writes).toHaveLength(1);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(JSON.stringify(candidate1));
  });

  it('fails with LOCK_UNAVAILABLE when Web Locks API is unavailable', async () => {
    const { storage, token, candidate } = setupFreshFixture();

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager: null });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('LOCK_UNAVAILABLE');
    expect(result.retryable).toBe(false);
    expect(storage.setItemCalls).toHaveLength(0);
    expect(storage.removeItemCalls).toHaveLength(0);
  });

  it('fails with LOCK_ACQUISITION_REJECTED when lock manager rejects', async () => {
    const { storage, token, candidate } = setupFreshFixture();
    const rejectingLockManager: WebLockManagerLike = {
      async request() {
        throw new Error('Lock acquisition aborted by browser');
      },
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager: rejectingLockManager });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('LOCK_ACQUISITION_REJECTED');
    expect(result.message).toContain('Lock acquisition aborted by browser');
    expect(result.retryable).toBe(false);
    expect(storage.setItemCalls).toHaveLength(0);
  });

  it('blocks on invalid keys, empty token, or invalid candidate store before lock acquisition with zero writes', async () => {
    const { storage, lockManager, baseStore, token } = setupFreshFixture();

    const badKeys = await saveHuntMemoryProgress(
      storage,
      token,
      baseStore,
      { keys: { v2Key: 'same', v3Key: 'same' }, lockManager },
    );
    expect(badKeys.status).toBe('blocked');
    if (badKeys.status === 'blocked') expect(badKeys.reason).toBe('INVALID_STORAGE_KEYS');

    const blankToken = await saveHuntMemoryProgress(storage, '   ', baseStore, { lockManager });
    expect(blankToken.status).toBe('blocked');
    if (blankToken.status === 'blocked') expect(blankToken.reason).toBe('INVALID_EXPECTED_TOKEN');

    const invalidStore = await saveHuntMemoryProgress(
      storage,
      token,
      { schemaVersion: '3.0', broken: true },
      { lockManager },
    );
    expect(invalidStore.status).toBe('blocked');
    if (invalidStore.status === 'blocked') {
      expect(invalidStore.reason).toBe('INVALID_CANDIDATE_STORE');
      expect(invalidStore.conflicts?.length).toBeGreaterThan(0);
    }

    const protoStore = await saveHuntMemoryProgress(
      storage,
      token,
      JSON.parse('{"schemaVersion":"3.0","gameProgress":{"__proto__":{"gameId":"__proto__","sets":{},"retiredSets":{}}}}'),
      { lockManager },
    );
    expect(protoStore.status).toBe('blocked');
    if (protoStore.status === 'blocked') expect(protoStore.reason).toBe('INVALID_CANDIDATE_STORE');

    expect(lockManager.events).toHaveLength(0);
    expect(storage.setItemCalls).toHaveLength(0);
  });

  it('blocks when storage has not cut over (fresh or upgrade-required)', async () => {
    const lockManager = new FakeWebLockManager();
    const baseStore = createBaseStore();

    const freshStorage = new TrackingMemoryStorage();
    const freshRes = await saveHuntMemoryProgress(freshStorage, 'token', baseStore, { lockManager });
    expect(freshRes.status).toBe('blocked');
    if (freshRes.status === 'blocked') expect(freshRes.reason).toBe('STATE_MISMATCH');

    const v2Storage = new TrackingMemoryStorage();
    v2Storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, '{"schemaVersion":"2.0","gameProgress":{}}');
    const v2Res = await saveHuntMemoryProgress(v2Storage, 'token', baseStore, { lockManager });
    expect(v2Res.status).toBe('blocked');
    if (v2Res.status === 'blocked') expect(v2Res.reason).toBe('STATE_MISMATCH');

    expect(freshStorage.setItemCalls).toHaveLength(0);
    expect(v2Storage.setItemCalls).toHaveLength(0);
  });

  it('returns recovery-required when storage is already in a recovery state', async () => {
    const storage = new TrackingMemoryStorage();
    const lockManager = new FakeWebLockManager();
    const baseStore = createBaseStore();

    storage.seed(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      JSON.stringify({ recordVersion: 1, source: 'fresh' }),
    );

    const result = await saveHuntMemoryProgress(storage, 'any-token', baseStore, { lockManager });

    expect(result.status).toBe('recovery-required');
    if (result.status !== 'recovery-required') return;
    expect(result.reason).toBe('EXISTING_RECOVERY_STATE');
    expect(storage.setItemCalls).toHaveLength(0);
  });

  it('fails with STORAGE_ACCESS_ERROR when pre-write inspection throws on storage read', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();
    storage.setReadError(new Error('Pre-write storage read failure'));

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('STORAGE_ACCESS_ERROR');
    expect(result.retryable).toBe(false);
    expect(storage.setItemCalls).toHaveLength(0);
  });

  it.each([2, 3])('fails closed on cutover read %i (pre-write or post-write)', async (failingRead) => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();
    const rawCutover = storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY);
    const rawV2 = 'unchanged historical bytes';
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);
    let cutoverReads = 0;
    const origGet = storage.getItem.bind(storage);
    storage.getItem = (key) => {
      if (key === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY && ++cutoverReads === failingRead) {
        throw new Error('Cutover read fault');
      }
      return origGet(key);
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(cutoverReads).toBe(failingRead);
    expect(result).toMatchObject(failingRead === 2
      ? { status: 'failure', code: 'STORAGE_ACCESS_ERROR', retryable: false }
      : { status: 'recovery-required', reason: 'CUTOVER_RECORD_CHANGED_OR_UNREADABLE' });
    expect(result).toMatchObject({ message: expect.stringContaining('Cutover read fault') });
    expect(result).not.toHaveProperty('store');
    expect(result).not.toHaveProperty('v3Token');
    const candidateBytes = JSON.stringify(candidate);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(
      failingRead === 2 ? token : candidateBytes,
    );
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(rawCutover);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(rawV2);
    expect(storage.setItemCalls).toEqual(failingRead === 2 ? [] : [
      { key: DEFAULT_PROGRESS_V3_STORAGE_KEY, value: candidateBytes },
    ]);
    expect(storage.removeItemCalls).toHaveLength(0);
  });

  it('performs no writes for byte-identical candidates and returns success', async () => {
    const { storage, lockManager, baseStore, token } = setupFreshFixture();

    const result = await saveHuntMemoryProgress(storage, token, baseStore, { lockManager });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.v3Token).toBe(token);
    expect(result.store).toEqual(baseStore);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(token);
    expect(storage.setItemCalls).toHaveLength(0);
    expect(storage.removeItemCalls).toHaveLength(0);
  });

  it('classifies throw-before-commit as definite retryable failure with old token unchanged', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();

    const origSet = storage.setItem.bind(storage);
    storage.setItem = (k, v) => {
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) {
        throw new Error('Quota exceeded before write commit');
      }
      origSet(k, v);
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('WRITE_FAILED_TOKEN_UNCHANGED');
    expect(result.retryable).toBe(true);
    expect(result.message).toContain('Quota exceeded before write commit');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(token);
  });

  it('classifies swallowed write as definite retryable failure with old token unchanged', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();

    storage.setItem = (k) => {
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) return;
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('WRITE_FAILED_TOKEN_UNCHANGED');
    expect(result.retryable).toBe(true);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(token);
  });

  it('re-attempts save after definite unchanged failure and succeeds', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();

    let shouldFail = true;
    const origSet = storage.setItem.bind(storage);
    storage.setItem = (k, v) => {
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY && shouldFail) {
        throw new Error('Temporary storage write glitch');
      }
      origSet(k, v);
    };

    const failRes = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });
    expect(failRes.status).toBe('failure');
    if (failRes.status === 'failure') expect(failRes.retryable).toBe(true);

    shouldFail = false;
    const retryRes = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });
    expect(retryRes.status).toBe('success');
    if (retryRes.status !== 'success') return;

    expect(retryRes.store).toEqual(candidate);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe(JSON.stringify(candidate));
  });

  it('verifies success when write threw after commit but read-back proves candidate was persisted', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();

    const origSet = storage.setItem.bind(storage);
    storage.setItem = (k, v) => {
      origSet(k, v);
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) {
        throw new Error('Post-commit notification exception');
      }
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.store).toEqual(candidate);
    expect(result.v3Token).toBe(JSON.stringify(candidate));
  });

  it('returns recovery-required when read-back reveals actual different bytes (diverged write)', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();
    const origSet = storage.setItem.bind(storage);
    storage.setItem = (k, v) => {
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) {
        storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, '{"corrupted":true}');
        return;
      }
      origSet(k, v);
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('recovery-required');
    if (result.status !== 'recovery-required') return;

    expect(result.reason).toBe('V3_STORE_CONFLICT_AFTER_WRITE');
    expect(result.rawV3).toBe('{"corrupted":true}');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBe('{"corrupted":true}');
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls.includes(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls.includes(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(false);
  });

  it('returns recovery-required when read-back throws after write', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();
    let didWrite = false;
    const origSet = storage.setItem.bind(storage);
    storage.setItem = (k, v) => {
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) didWrite = true;
      origSet(k, v);
    };
    const origGet = storage.getItem.bind(storage);
    storage.getItem = (k) => {
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY && didWrite) {
        throw new Error('Hardware read error immediately after write');
      }
      return origGet(k);
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('recovery-required');
    if (result.status !== 'recovery-required') return;

    expect(result.reason).toBe('READ_BACK_UNREADABLE');
    expect(result.message).toContain('Hardware read error immediately after write');
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls.includes(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls.includes(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(false);
  });

  it('returns recovery-required when V3 key becomes null after write', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();
    storage.setItem = (k) => {
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) {
        storage.removeItem(DEFAULT_PROGRESS_V3_STORAGE_KEY);
      }
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('recovery-required');
    if (result.status !== 'recovery-required') return;

    expect(result.reason).toBe('V3_STORE_MISSING_AFTER_WRITE');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBeNull();
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls.includes(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls.includes(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(false);
  });

  it('returns recovery-required when cutover record changes after write', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();
    const origSet = storage.setItem.bind(storage);
    storage.setItem = (k, v) => {
      origSet(k, v);
      if (k === DEFAULT_PROGRESS_V3_STORAGE_KEY) {
        storage.seed(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, '{"tampered":true}');
      }
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('recovery-required');
    if (result.status !== 'recovery-required') return;

    expect(result.reason).toBe('CUTOVER_RECORD_CHANGED_OR_UNREADABLE');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe('{"tampered":true}');
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls.includes(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls.includes(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(false);
  });

  it('returns recovery-required and performs zero writes when cutover record changes between inspection and pre-write check', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();
    const newRecord = JSON.stringify({ recordVersion: 1, source: 'migrated-v2', rawV2: '{"schemaVersion":"2.0"}' });

    const origGet = storage.getItem.bind(storage);
    storage.getItem = (k) => {
      const val = origGet(k);
      if (k === DEFAULT_PROGRESS_V2_STORAGE_KEY) {
        storage.seed(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, newRecord);
      }
      return val;
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('recovery-required');
    if (result.status !== 'recovery-required') return;

    expect(result.reason).toBe('CUTOVER_RECORD_CHANGED_OR_UNREADABLE');
    expect(result.message).toContain('Cutover record changed between inspection and pre-write check');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(newRecord);
    expect(storage.setItemCalls).toHaveLength(0);
    expect(storage.removeItemCalls).toHaveLength(0);
  });

  it('returns recovery-required when cutover record changes between inspection and pre-write check on byte-identical candidate', async () => {
    const { storage, lockManager, baseStore, token } = setupFreshFixture();
    const newRecord = JSON.stringify({ recordVersion: 1, source: 'migrated-v2', rawV2: '{"schemaVersion":"2.0"}' });

    const origGet = storage.getItem.bind(storage);
    storage.getItem = (k) => {
      const val = origGet(k);
      if (k === DEFAULT_PROGRESS_V2_STORAGE_KEY) {
        storage.seed(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, newRecord);
      }
      return val;
    };

    const result = await saveHuntMemoryProgress(storage, token, baseStore, { lockManager });

    expect(result.status).toBe('recovery-required');
    if (result.status !== 'recovery-required') return;

    expect(result.reason).toBe('CUTOVER_RECORD_CHANGED_OR_UNREADABLE');
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBe(newRecord);
    expect(storage.setItemCalls).toHaveLength(0);
    expect(storage.removeItemCalls).toHaveLength(0);
  });

  it('preserves V2 and carries late V2 drift warning through ordinary save without blocking or writing V2', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();
    const lateV2 = '{"schemaVersion":"2.0","late":true}';
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, lateV2);

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.legacyV2Warning).toContain('Unexpected legacy V2 progress');
    expect(result.store).toEqual(candidate);

    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(lateV2);
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
    expect(storage.removeItemCalls.includes(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
  });

  it('proceeds with ordinary save when V2 read fails during inspection and carries warning', async () => {
    const { storage, lockManager, token, candidate } = setupFreshFixture();

    const origGet = storage.getItem.bind(storage);
    storage.getItem = (k) => {
      if (k === DEFAULT_PROGRESS_V2_STORAGE_KEY) {
        throw new Error('V2 drive unreadable');
      }
      return origGet(k);
    };

    const result = await saveHuntMemoryProgress(storage, token, candidate, { lockManager });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.legacyV2Warning).toContain('Could not check older V2 progress');
    expect(result.store).toEqual(candidate);
    expect(storage.setItemCalls.some((c) => c.key === DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(false);
  });
});
