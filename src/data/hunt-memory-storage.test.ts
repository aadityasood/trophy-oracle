import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../test/memory-storage';
import { transformProgressStoreV2ToV3 } from '../domain/progress-migration';
import {
  HUNT_MEMORY_STORAGE_KEY,
  createDefaultHuntMemoryStore,
  loadOrMigrateHuntMemoryProgress,
  saveHuntMemoryProgress,
} from './hunt-memory-storage';
import type { LocalProgressStoreV3 } from '../domain/hunt-memory-schema';
import { LocalProgressStoreV3Schema } from '../domain/hunt-memory-schema';
import { DEFAULT_STORAGE_KEY } from './progress-storage';

const MIGRATION_TS = '2026-07-23T00:00:00.000Z';

function createV2Store(): unknown {
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
                achievementId: 'ach-binary',
                completed: true,
                manualOverride: false,
                notes: 'keep me',
                lastUpdated: '2026-07-22T00:00:00.000Z',
                provenance: 'manual',
              },
            },
          },
        },
        orphanedProgress: {},
      },
    },
  };
}

function createValidV3Store(): LocalProgressStoreV3 {
  return {
    schemaVersion: '3.0',
    gameProgress: {
      'game-a': {
        gameId: 'game-a',
        preferredSetId: 'set-a',
        sets: {
          'set-a': {
            setId: 'set-a',
            version: '1.0',
            activeRunId: 'legacy-v2',
            runs: {
              'legacy-v2': {
                runId: 'legacy-v2',
                name: 'Existing Progress',
                createdAt: MIGRATION_TS,
                activeStage: 'story',
                pinnedAchievementIds: ['ach-binary'],
                progress: {
                  'ach-binary': {
                    achievementId: 'ach-binary',
                    completed: true,
                    manualOverride: false,
                    notes: 'keep me',
                    lastUpdated: '2026-07-22T00:00:00.000Z',
                    provenance: 'manual',
                  },
                },
                orphanedProgress: {},
              },
            },
          },
        },
        retiredSets: {},
      },
    },
  };
}

function asV3Store(value: unknown): LocalProgressStoreV3 {
  return value as LocalProgressStoreV3;
}

describe('Schema 3.0 hunt memory storage gateway', () => {
  it('returns a valid default V3 store after one read and zero writes when the key is absent', () => {
    const storage = new MemoryStorage();

    const result = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.source).toBe('default');
    expect(result.store).toEqual(createDefaultHuntMemoryStore());
    expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    expect(storage.readCount).toBe(1);
    expect(storage.writeCount).toBe(0);
  });

  it('loads a valid V3 store as loaded-v3 after one read and zero writes', () => {
    const storage = new MemoryStorage();
    storage.seed(HUNT_MEMORY_STORAGE_KEY, JSON.stringify(createValidV3Store()));

    const result = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.source).toBe('loaded-v3');
    expect(result.store).toEqual(createValidV3Store());
    expect(storage.readCount).toBe(1);
    expect(storage.writeCount).toBe(0);
  });

  it('migrates a valid V2 store, preserves its report, writes once to the same key, and stores valid V3 JSON', () => {
    const storage = new MemoryStorage();
    const v2Store = createV2Store();
    storage.seed(HUNT_MEMORY_STORAGE_KEY, JSON.stringify(v2Store));
    const expected = transformProgressStoreV2ToV3(v2Store, MIGRATION_TS);
    expect(expected.success).toBe(true);
    if (!expected.success) return;

    const result = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.source).toBe('migrated-v2');
    if (result.source !== 'migrated-v2') return;
    expect(result.store).toEqual(expected.store);
    expect(result.report).toEqual(expected.report);

    expect(storage.readCount).toBe(1);
    expect(storage.writeCount).toBe(1);

    const rawWritten = storage.getRawValue(HUNT_MEMORY_STORAGE_KEY);
    expect(rawWritten).not.toBeNull();
    const parsedWritten = JSON.parse(rawWritten as string);
    expect(LocalProgressStoreV3Schema.safeParse(parsedWritten).success).toBe(
      true,
    );
    expect(parsedWritten).toEqual(expected.store);
  });

  it('performs no additional write on a second load after migration and accepts an invalid migration timestamp', () => {
    const storage = new MemoryStorage();
    const v2Store = createV2Store();
    storage.seed(HUNT_MEMORY_STORAGE_KEY, JSON.stringify(v2Store));

    const first = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.source).toBe('migrated-v2');
    const writesAfterFirst = storage.writeCount;
    expect(writesAfterFirst).toBe(1);

    const second = loadOrMigrateHuntMemoryProgress(storage, 'not-a-timestamp');
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.source).toBe('loaded-v3');
    expect(second.store).toEqual(first.store);
    expect(storage.writeCount).toBe(writesAfterFirst);
  });

  it('returns INVALID_SOURCE_STORE for malformed JSON, preserving exact raw bytes and performing zero writes', () => {
    const storage = new MemoryStorage();
    const raw = '{ not valid json';
    storage.seed(HUNT_MEMORY_STORAGE_KEY, raw);

    const result = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('INVALID_SOURCE_STORE');
    expect('store' in result).toBe(false);
    expect(result.conflicts).toEqual([]);
    expect(storage.getRawValue(HUNT_MEMORY_STORAGE_KEY)).toBe(raw);
    expect(storage.writeCount).toBe(0);
  });

  it('returns INVALID_SOURCE_STORE for missing, unsupported, future, and non-string schema versions without writes', () => {
    const unsupportedPayloads = [
      { gameProgress: {} },
      { schemaVersion: '1.0', gameProgress: {} },
      { schemaVersion: '9.9', gameProgress: {} },
      { schemaVersion: 3, gameProgress: {} },
    ];

    for (const payload of unsupportedPayloads) {
      const storage = new MemoryStorage();
      const raw = JSON.stringify(payload);
      storage.seed(HUNT_MEMORY_STORAGE_KEY, raw);

      const result = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe('INVALID_SOURCE_STORE');
      expect('store' in result).toBe(false);
      expect(storage.getRawValue(HUNT_MEMORY_STORAGE_KEY)).toBe(raw);
      expect(storage.writeCount).toBe(0);
    }
  });

  it('returns INVALID_SOURCE_STORE for structurally invalid V2 and V3 values without writes', () => {
    const invalidV2 = { schemaVersion: '2.0', gameProgress: 'not-an-object' };
    const invalidV3 = { schemaVersion: '3.0', gameProgress: 'not-an-object' };

    for (const payload of [invalidV2, invalidV3]) {
      const storage = new MemoryStorage();
      const raw = JSON.stringify(payload);
      storage.seed(HUNT_MEMORY_STORAGE_KEY, raw);

      const result = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe('INVALID_SOURCE_STORE');
      expect('store' in result).toBe(false);
      expect(storage.getRawValue(HUNT_MEMORY_STORAGE_KEY)).toBe(raw);
      expect(storage.writeCount).toBe(0);
    }
  });

  it('returns TRANSFORMATION_ERROR for an invalid migration timestamp and preserves the original V2 bytes', () => {
    const storage = new MemoryStorage();
    const v2Store = createV2Store();
    const raw = JSON.stringify(v2Store);
    storage.seed(HUNT_MEMORY_STORAGE_KEY, raw);

    const result = loadOrMigrateHuntMemoryProgress(storage, 'invalid');
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('TRANSFORMATION_ERROR');
    expect('store' in result).toBe(false);
    expect(storage.getRawValue(HUNT_MEMORY_STORAGE_KEY)).toBe(raw);
    expect(storage.writeCount).toBe(0);
  });

  it('returns INVALID_TARGET_STORE for a source-valid V2 shape that transforms into an invalid V3 target, exposing no store and preserving raw bytes', () => {
    const storage = new MemoryStorage();
    const sourceValidButUnrepresentable = {
      schemaVersion: '2.0',
      gameProgress: {
        'game-a': {
          gameId: 'game-a',
          sets: {
            'set-a': {
              setId: 'set-a',
              version: '1',
              pinnedAchievementIds: [],
              progress: {
                ach: {
                  achievementId: 'ach',
                  completed: true,
                  manualOverride: true,
                  lastUpdated: MIGRATION_TS,
                  provenance: 'manual',
                },
              },
            },
          },
          orphanedProgress: {},
        },
      },
    };
    const raw = JSON.stringify(sourceValidButUnrepresentable);
    storage.seed(HUNT_MEMORY_STORAGE_KEY, raw);

    const result = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('INVALID_TARGET_STORE');
    expect('store' in result).toBe(false);
    expect(storage.getRawValue(HUNT_MEMORY_STORAGE_KEY)).toBe(raw);
    expect(storage.writeCount).toBe(0);
  });

  it('returns STORAGE_ACCESS_ERROR for an injected read failure without a write', () => {
    const storage = new MemoryStorage();
    storage.setReadError(new Error('Access denied'));

    const result = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('STORAGE_ACCESS_ERROR');
    expect('store' in result).toBe(false);
    expect(result.message).toContain('Access denied');
    expect(storage.writeCount).toBe(0);
  });

  it('returns STORAGE_WRITE_ERROR for an injected migration-write failure, attempts one write, exposes no store, and preserves raw V2 bytes', () => {
    const storage = new MemoryStorage();
    const v2Store = createV2Store();
    const raw = JSON.stringify(v2Store);
    storage.seed(HUNT_MEMORY_STORAGE_KEY, raw);
    storage.setWriteError(new Error('QuotaExceededError'));

    const result = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('STORAGE_WRITE_ERROR');
    expect('store' in result).toBe(false);
    expect(storage.writeCount).toBe(1);
    expect(storage.getRawValue(HUNT_MEMORY_STORAGE_KEY)).toBe(raw);
  });

  it('saves a valid V3 store once and round-trips it through direct V3 loading', () => {
    const storage = new MemoryStorage();
    const v3Store = createValidV3Store();

    const saved = saveHuntMemoryProgress(v3Store, storage);
    expect(saved.success).toBe(true);
    expect(storage.writeCount).toBe(1);

    const loaded = loadOrMigrateHuntMemoryProgress(storage, MIGRATION_TS);
    expect(loaded.success).toBe(true);
    if (!loaded.success) return;
    expect(loaded.source).toBe('loaded-v3');
    expect(loaded.store).toEqual(v3Store);
  });

  it('returns INVALID_SAVE_STATE with zero writes for an invalid V3 store', () => {
    const storage = new MemoryStorage();
    const invalid = asV3Store({ schemaVersion: '3.0' });

    const result = saveHuntMemoryProgress(invalid, storage);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('INVALID_SAVE_STATE');
    expect(storage.writeCount).toBe(0);
  });

  it('returns STORAGE_WRITE_ERROR for an injected save-write failure', () => {
    const storage = new MemoryStorage();
    const existingRaw = '{"existing":"raw bytes"}';
    storage.seed(HUNT_MEMORY_STORAGE_KEY, existingRaw);
    storage.setWriteError(new Error('QuotaExceededError'));

    const result = saveHuntMemoryProgress(createValidV3Store(), storage);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.code).toBe('STORAGE_WRITE_ERROR');
    expect(result.message).toContain('QuotaExceededError');
    expect(storage.writeCount).toBe(1);
    expect(storage.getRawValue(HUNT_MEMORY_STORAGE_KEY)).toBe(existingRaw);
  });

  it('uses only the injected custom key and still follows the one-read and one-write rules', () => {
    const customKey = 'trophy-oracle.custom';
    const storage = new MemoryStorage();
    const v2Store = createV2Store();
    storage.seed(customKey, JSON.stringify(v2Store));

    const result = loadOrMigrateHuntMemoryProgress(
      storage,
      MIGRATION_TS,
      customKey,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.source).toBe('migrated-v2');
    expect(storage.readCount).toBe(1);
    expect(storage.writeCount).toBe(1);
    expect(storage.getRawValue(customKey)).not.toBeNull();
    expect(storage.getRawValue(DEFAULT_STORAGE_KEY)).toBeNull();
    expect(storage.getRawValue(HUNT_MEMORY_STORAGE_KEY)).toBeNull();
  });
});
