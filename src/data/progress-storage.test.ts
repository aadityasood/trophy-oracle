import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STORAGE_KEY,
  loadProgressFromStorage,
  saveProgressToStorage,
} from './progress-storage';
import type { StorageLike } from './progress-storage';
import {
  createDefaultLocalProgressStore,
  setBinaryCompletion,
} from '../domain/progress-engine';
import { CURRENT_STORE_SCHEMA_VERSION } from '../domain/progress-schema';
import type { LocalProgressStore } from '../domain/progress-schema';
import { mockGameStellarDrift, MOCK_TIMESTAMP } from '../test/progress-fixtures';

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  readCount = 0;
  writeCount = 0;

  getItem(key: string): string | null {
    this.readCount += 1;
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writeCount += 1;
    this.data.set(key, value);
  }
}

function asInvalidStore(value: unknown): LocalProgressStore {
  return value as LocalProgressStore;
}

describe('browser storage adapter', () => {
  it('returns a default store only when the storage value is absent', () => {
    const result = loadProgressFromStorage(new MemoryStorage());
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.source).toBe('default');
    expect(result.token).toBeNull();
    expect(result.store).toEqual(createDefaultLocalProgressStore());
  });

  it('exposes the exact raw value read as an opaque revision token', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify(createDefaultLocalProgressStore());
    storage.setItem(DEFAULT_STORAGE_KEY, raw);

    const result = loadProgressFromStorage(storage);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.source).toBe('loaded');
    expect(result.token).toBe(raw);
  });

  it('treats a present blank string as malformed JSON and preserves it', () => {
    const storage = new MemoryStorage();
    storage.setItem(DEFAULT_STORAGE_KEY, '   ');

    const result = loadProgressFromStorage(storage);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe('MALFORMED_JSON');
    expect(result.fallbackStore.schemaVersion).toBe(CURRENT_STORE_SCHEMA_VERSION);
    expect(storage.getItem(DEFAULT_STORAGE_KEY)).toBe('   ');
  });

  it('round trips a validated current-version store with guarded token rotation', () => {
    const storage = new MemoryStorage();
    const mutation = setBinaryCompletion(
      createDefaultLocalProgressStore(),
      mockGameStellarDrift,
      'stellar-drift-ps',
      'sd-ps-001',
      true,
      MOCK_TIMESTAMP,
    );
    expect(mutation.success).toBe(true);
    if (!mutation.success) return;

    const saveResult = saveProgressToStorage(mutation.store, storage, null);
    expect(saveResult.success).toBe(true);
    if (!saveResult.success) return;

    const loaded = loadProgressFromStorage(storage);
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;
    expect(loaded.source).toBe('loaded');
    expect(loaded.token).toBe(saveResult.token);
    expect(
      loaded.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-001'].completed,
    ).toBe(true);

    const nextMutation = setBinaryCompletion(
      mutation.store,
      mockGameStellarDrift,
      'stellar-drift-ps',
      'sd-ps-002',
      true,
      MOCK_TIMESTAMP,
    );
    expect(nextMutation.success).toBe(true);
    if (!nextMutation.success) return;

    const nextSaveResult = saveProgressToStorage(
      nextMutation.store,
      storage,
      saveResult.token,
    );
    expect(nextSaveResult.success).toBe(true);
    if (!nextSaveResult.success) return;
    expect(nextSaveResult.token).not.toBe(saveResult.token);
    expect(storage.getItem(DEFAULT_STORAGE_KEY)).toBe(nextSaveResult.token);
  });

  it('rejects stale V2 value with STALE_WRITE_CONFLICT, zero writes, and byte preservation', () => {
    const storage = new MemoryStorage();
    const newerV2Bytes = JSON.stringify({
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      lastGameId: 'newer-game',
      gameProgress: {},
    });
    storage.setItem(DEFAULT_STORAGE_KEY, newerV2Bytes);
    storage.writeCount = 0;

    const staleCandidate = createDefaultLocalProgressStore();
    const staleExpectedToken = 'old-stale-v2-token';

    const result = saveProgressToStorage(
      staleCandidate,
      storage,
      staleExpectedToken,
    );
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('STALE_WRITE_CONFLICT');
    expect(storage.writeCount).toBe(0);
    expect(storage.getItem(DEFAULT_STORAGE_KEY)).toBe(newerV2Bytes);
  });

  it('rejects V2 candidate over existing V3 raw bytes with zero writes and exact byte preservation', () => {
    const storage = new MemoryStorage();
    const rawV3Bytes = JSON.stringify({
      schemaVersion: '3.0',
      huntMemory: { active: true, runId: 'run-99' },
      gameProgress: {},
    });
    storage.setItem(DEFAULT_STORAGE_KEY, rawV3Bytes);
    storage.writeCount = 0;

    const v2Candidate = createDefaultLocalProgressStore();
    const result = saveProgressToStorage(v2Candidate, storage, null);

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('STALE_WRITE_CONFLICT');
    expect(storage.writeCount).toBe(0);
    expect(storage.getItem(DEFAULT_STORAGE_KEY)).toBe(rawV3Bytes);
  });

  it('catches save-time read failures with STORAGE_ACCESS_ERROR and zero writes', () => {
    let writeCount = 0;
    const storage: StorageLike = {
      getItem() {
        throw new Error('Save read access denied');
      },
      setItem() {
        writeCount += 1;
      },
    };

    const result = saveProgressToStorage(
      createDefaultLocalProgressStore(),
      storage,
      null,
    );
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('STORAGE_ACCESS_ERROR');
    expect(result.message).toContain('Save read access denied');
    expect(writeCount).toBe(0);
  });

  it('returns malformed JSON without overwriting the raw value', () => {
    const storage = new MemoryStorage();
    const raw = '{ invalid json content';
    storage.setItem(DEFAULT_STORAGE_KEY, raw);

    const result = loadProgressFromStorage(storage);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('MALFORMED_JSON');
    expect(storage.getItem(DEFAULT_STORAGE_KEY)).toBe(raw);
  });

  it('returns invalid structure without overwriting the raw value', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: 'not-an-object',
    });
    storage.setItem(DEFAULT_STORAGE_KEY, raw);

    const result = loadProgressFromStorage(storage);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('INVALID_STRUCTURE');
    expect(storage.getItem(DEFAULT_STORAGE_KEY)).toBe(raw);
  });

  it('returns unsupported versions without inventing migration or overwriting raw data', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ schemaVersion: '1.0', gameProgress: {} });
    storage.setItem(DEFAULT_STORAGE_KEY, raw);

    const result = loadProgressFromStorage(storage);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
      expect(result.fallbackStore).toEqual(createDefaultLocalProgressStore());
    }
    expect(storage.getItem(DEFAULT_STORAGE_KEY)).toBe(raw);
  });

  it('catches injected read failures', () => {
    const storage: StorageLike = {
      getItem() {
        throw new Error('Access denied');
      },
      setItem() {},
    };

    const result = loadProgressFromStorage(storage);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('STORAGE_ACCESS_ERROR');
      expect(result.message).toContain('Access denied');
    }
  });

  it('catches injected write failures', () => {
    const storage: StorageLike = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };

    const result = saveProgressToStorage(
      createDefaultLocalProgressStore(),
      storage,
      null,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('STORAGE_WRITE_ERROR');
      expect(result.message).toContain('QuotaExceededError');
    }
  });

  it('refuses invalid save state before attempting a read or write', () => {
    let readCount = 0;
    let writeCount = 0;
    const storage: StorageLike = {
      getItem() {
        readCount += 1;
        return null;
      },
      setItem() {
        writeCount += 1;
      },
    };
    const invalidStore = asInvalidStore({
      schemaVersion: CURRENT_STORE_SCHEMA_VERSION,
      gameProgress: {
        game: { gameId: 'different-game', sets: {}, orphanedProgress: {} },
      },
    });

    const result = saveProgressToStorage(invalidStore, storage, null);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('INVALID_SAVE_STATE');
    expect(readCount).toBe(0);
    expect(writeCount).toBe(0);
  });
});
