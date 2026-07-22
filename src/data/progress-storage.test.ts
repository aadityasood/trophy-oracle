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

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
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
    expect(result.store).toEqual(createDefaultLocalProgressStore());
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

  it('round trips a validated current-version store', () => {
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

    expect(saveProgressToStorage(mutation.store, storage).success).toBe(true);
    const loaded = loadProgressFromStorage(storage);
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;
    expect(loaded.source).toBe('loaded');
    expect(
      loaded.store.gameProgress['stellar-drift'].sets['stellar-drift-ps']
        .progress['sd-ps-001'].completed,
    ).toBe(true);
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
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('STORAGE_WRITE_ERROR');
      expect(result.message).toContain('QuotaExceededError');
    }
  });

  it('refuses invalid save state before attempting a write', () => {
    let writeCount = 0;
    const storage: StorageLike = {
      getItem() {
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

    const result = saveProgressToStorage(invalidStore, storage);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe('INVALID_SAVE_STATE');
    expect(writeCount).toBe(0);
  });
});
