import { describe, expect, it } from 'vitest';
import { MemoryStorage as BaseMemoryStorage } from '../test/memory-storage';
import { transformProgressStoreV2ToV3 } from '../domain/progress-migration';
import { RESERVED_RECORD_KEY_MESSAGE } from '../domain/progress-schema-common';
import {
  DEFAULT_PROGRESS_V2_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
  DEFAULT_PROGRESS_V3_STORAGE_KEY,
  ProgressV3CutoverRecordSchema,
  createDefaultHuntMemoryStore,
  inspectHuntMemoryStorage,
} from './hunt-memory-storage';
import type { LocalProgressStoreV3 } from '../domain/hunt-memory-schema';
import { LocalProgressStoreV3Schema } from '../domain/hunt-memory-schema';

const MIGRATION_TS = '2026-07-23T00:00:00.000Z';

class MemoryStorage extends BaseMemoryStorage {
  override removeItem(key: string): void {
    this.writeCount += 1;
    super.removeItem(key);
  }
}

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
  const result = transformProgressStoreV2ToV3(createV2Store(), MIGRATION_TS);
  if (!result.success) {
    throw new Error('Failed to create valid V3 fixture');
  }
  return result.store;
}

function disallowV2Read(
  storage: MemoryStorage,
  message = 'Forbidden V2 read',
): void {
  const orig = storage.getItem.bind(storage);
  storage.getItem = (k: string) => {
    if (k === DEFAULT_PROGRESS_V2_STORAGE_KEY) {
      throw new Error(message);
    }
    return orig(k);
  };
}

describe('Schema 3.0 hunt memory storage gateway', () => {
  it('returns fresh with valid default V3 store and zero writes when keys are absent', () => {
    const storage = new MemoryStorage();

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('fresh');
    if (result.status !== 'fresh') return;

    expect(result.store).toEqual(createDefaultHuntMemoryStore());
    expect(result.v3Token).toBeNull();
    expect(LocalProgressStoreV3Schema.safeParse(result.store).success).toBe(true);
    expect(storage.readCount).toBe(3);
    expect(storage.writeCount).toBe(0);
  });

  it('returns upgrade-required for valid V2 store, preserving report and raw token without writes', () => {
    const storage = new MemoryStorage();
    const v2Store = createV2Store();
    const rawV2 = JSON.stringify(v2Store);
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    const expected = transformProgressStoreV2ToV3(v2Store, MIGRATION_TS);
    expect(expected.success).toBe(true);
    if (!expected.success) return;

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('upgrade-required');
    if (result.status !== 'upgrade-required') return;

    expect(result.candidateStore).toEqual(expected.store);
    expect(result.report).toEqual(expected.report);
    expect(result.v2Token).toBe(rawV2);
    expect(storage.writeCount).toBe(0);
  });

  it('performs zero writes across repeated inspections and fails cleanly on invalid timestamp', () => {
    const storage = new MemoryStorage();
    const v2Store = createV2Store();
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, JSON.stringify(v2Store));

    const first = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(first.status).toBe('upgrade-required');
    expect(storage.writeCount).toBe(0);

    const second = inspectHuntMemoryStorage(storage, {
      migratedAt: 'not-a-timestamp',
    });
    expect(second.status).toBe('failure');
    expect(storage.writeCount).toBe(0);
  });

  it('returns INVALID_SOURCE_STORE for malformed JSON, preserving exact raw bytes and performing zero writes', () => {
    const storage = new MemoryStorage();
    const raw = '{ not valid json';
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, raw);

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('INVALID_SOURCE_STORE');
    expect('candidateStore' in result).toBe(false);
    expect('store' in result).toBe(false);
    expect(result.conflicts).toEqual([]);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(raw);
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
      storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, raw);

      const result = inspectHuntMemoryStorage(storage, {
        migratedAt: MIGRATION_TS,
      });
      expect(result.status).toBe('failure');
      if (result.status !== 'failure') return;
      expect(result.code).toBe('INVALID_SOURCE_STORE');
      expect('candidateStore' in result).toBe(false);
      expect('store' in result).toBe(false);
      expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(raw);
      expect(storage.writeCount).toBe(0);
    }
  });

  it('returns INVALID_SOURCE_STORE for structurally invalid V2 values without writes', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({
      schemaVersion: '2.0',
      gameProgress: 'not-an-object',
    });
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, raw);

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('INVALID_SOURCE_STORE');
    expect('candidateStore' in result).toBe(false);
    expect('store' in result).toBe(false);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(raw);
    expect(storage.writeCount).toBe(0);
  });

  it('returns TRANSFORMATION_ERROR for an invalid migration timestamp and preserves the original V2 bytes', () => {
    const storage = new MemoryStorage();
    const v2Store = createV2Store();
    const raw = JSON.stringify(v2Store);
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, raw);

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: 'invalid',
    });
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('TRANSFORMATION_ERROR');
    expect('candidateStore' in result).toBe(false);
    expect('store' in result).toBe(false);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(raw);
    expect(storage.writeCount).toBe(0);
  });

  it('rejects omitted migratedAt with a timestamp-specific failure and zero writes', () => {
    const storage = new MemoryStorage();
    const rawV2 = JSON.stringify(createV2Store());
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    const result = inspectHuntMemoryStorage(storage);
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('TRANSFORMATION_ERROR');
    expect(result.message).toBe(
      'Migration timestamp is not a valid ISO-8601 UTC timestamp',
    );
    expect(result.rawV2).toBe(rawV2);
    expect('candidateStore' in result).toBe(false);
    expect('store' in result).toBe(false);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(rawV2);
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
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, raw);

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('INVALID_TARGET_STORE');
    expect('candidateStore' in result).toBe(false);
    expect('store' in result).toBe(false);
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBe(raw);
    expect(storage.writeCount).toBe(0);
  });

  it('returns STORAGE_ACCESS_ERROR for an injected read failure without a write', () => {
    const phases = [
      DEFAULT_PROGRESS_V3_STORAGE_KEY,
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      DEFAULT_PROGRESS_V2_STORAGE_KEY,
    ];

    for (const key of phases) {
      const storage = new MemoryStorage();
      const orig = storage.getItem.bind(storage);
      storage.getItem = (k: string) => {
        if (k === key) throw new Error(`Access denied for ${k}`);
        return orig(k);
      };

      const result = inspectHuntMemoryStorage(storage, {
        migratedAt: MIGRATION_TS,
      });
      expect(result.status).toBe('failure');
      if (result.status !== 'failure') return;

      expect(result.code).toBe('STORAGE_ACCESS_ERROR');
      expect(result.message).toContain(`Access denied for ${key}`);
      expect(storage.writeCount).toBe(0);
    }
  });

  it('inspects V2 for a fresh-cutover V3 store: absent remains not-applicable with authoritative V3 and zero writes', () => {
    const storage = new MemoryStorage();
    const v3Store = createValidV3Store();
    const rawV3 = JSON.stringify(v3Store);
    storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
    storage.seed(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      JSON.stringify({ recordVersion: 1, source: 'fresh' }),
    );

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('loaded-v3');
    if (result.status !== 'loaded-v3') return;

    expect(result.store).toEqual(v3Store);
    expect(result.v3Token).toBe(rawV3);
    expect(result.legacyV2Status).toBe('not-applicable');
    expect(result.legacyV2Warning).toBeUndefined();
    expect(result.cutoverRecord.source).toBe('fresh');
    expect(result.rawV2).toBeNull();
    expect(storage.writeCount).toBe(0);
  });

  it('inspects V2 for a fresh-cutover V3 store: late V2 bytes report unexpected drift warning without displacing V3 or writing', () => {
    const storage = new MemoryStorage();
    const v3Store = createValidV3Store();
    const rawV3 = JSON.stringify(v3Store);
    const lateV2 = '{"schemaVersion":"2.0","unexpectedDrift":true}';
    storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
    storage.seed(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      JSON.stringify({ recordVersion: 1, source: 'fresh' }),
    );
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, lateV2);

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('loaded-v3');
    if (result.status !== 'loaded-v3') return;

    expect(result.store).toEqual(v3Store);
    expect(result.v3Token).toBe(rawV3);
    expect(result.legacyV2Status).toBe('changed');
    expect(result.legacyV2Warning).toContain('Unexpected legacy V2 progress');
    expect(result.cutoverRecord.source).toBe('fresh');
    expect(result.rawV2).toBe(lateV2);
    expect(storage.writeCount).toBe(0);
  });

  it('inspects V2 for a fresh-cutover V3 store: V2 read failure yields unavailable warning and retains valid V3 without writes', () => {
    const storage = new MemoryStorage();
    const v3Store = createValidV3Store();
    const rawV3 = JSON.stringify(v3Store);
    storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
    storage.seed(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      JSON.stringify({ recordVersion: 1, source: 'fresh' }),
    );
    disallowV2Read(storage, 'Disk error on V2 during fresh V3 inspection');

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('loaded-v3');
    if (result.status !== 'loaded-v3') return;

    expect(result.store).toEqual(v3Store);
    expect(result.v3Token).toBe(rawV3);
    expect(result.legacyV2Status).toBe('unavailable');
    expect(result.legacyV2Warning).toContain('Disk error on V2');
    expect(result.cutoverRecord.source).toBe('fresh');
    expect(result.rawV2).toBeNull();
    expect(storage.writeCount).toBe(0);
  });

  it('proves cutover-without-V3 recovery never reads V2 for valid and invalid cutover records', () => {
    const validCases = [
      {
        recordVersion: 1,
        source: 'migrated-v2',
        rawV2: '{"schemaVersion":"2.0"}',
      },
      { recordVersion: 1, source: 'fresh' },
    ] as const;

    for (const payload of validCases) {
      const storage = new MemoryStorage();
      storage.seed(
        DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
        JSON.stringify(payload),
      );
      disallowV2Read(storage, 'Forbidden V2 read when V3 is absent');

      const result = inspectHuntMemoryStorage(storage, {
        migratedAt: MIGRATION_TS,
      });
      expect(result.status).toBe('recovery-required');
      if (result.status !== 'recovery-required') return;

      expect(result.reason).toBe('CUTOVER_WITHOUT_V3');
      expect(result.cutoverRecord).toEqual(payload);
      expect(result.rawV2).toBeNull();
      expect(result.rawV3).toBeNull();
      expect(storage.writeCount).toBe(0);
    }

    const invalidStorage = new MemoryStorage();
    invalidStorage.seed(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      '{ corrupt cutover',
    );
    disallowV2Read(
      invalidStorage,
      'Forbidden V2 read when V3 is absent and cutover is invalid',
    );

    const invalidResult = inspectHuntMemoryStorage(invalidStorage, {
      migratedAt: MIGRATION_TS,
    });
    expect(invalidResult.status).toBe('recovery-required');
    if (invalidResult.status !== 'recovery-required') return;

    expect(invalidResult.reason).toBe('INVALID_CUTOVER_WITHOUT_V3');
    expect(invalidResult.rawCutover).toBe('{ corrupt cutover');
    expect(invalidResult.rawV2).toBeNull();
    expect(invalidResult.rawV3).toBeNull();
    expect(invalidStorage.writeCount).toBe(0);
  });

  it('proves invalid V3 recovery never reads V2 across each cutover presence', () => {
    const cutoverVariants = [
      null,
      JSON.stringify({ recordVersion: 1, source: 'migrated-v2', rawV2: '{}' }),
      JSON.stringify({ recordVersion: 1, source: 'fresh' }),
      '{"invalid":"record"}',
    ];

    for (const cutover of cutoverVariants) {
      const storage = new MemoryStorage();
      storage.seed(
        DEFAULT_PROGRESS_V3_STORAGE_KEY,
        '{"schemaVersion":"3.0","broken":true}',
      );
      if (cutover) {
        storage.seed(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, cutover);
      }
      disallowV2Read(storage, 'Forbidden V2 read when V3 is invalid');

      const result = inspectHuntMemoryStorage(storage, {
        migratedAt: MIGRATION_TS,
      });
      expect(result.status).toBe('recovery-required');
      if (result.status !== 'recovery-required') return;

      expect(result.reason).toBe('INVALID_V3');
      expect(result.rawV2).toBeNull();
      expect(result.validatedStore).toBeUndefined();
      expect(storage.writeCount).toBe(0);
    }
  });

  it('proves valid V3 without cutover or with invalid cutover never reads V2', () => {
    const storage = new MemoryStorage();
    const v3Store = createValidV3Store();
    storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, JSON.stringify(v3Store));
    disallowV2Read(storage, 'Forbidden V2 read during cutover validation');

    const noCutover = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(noCutover.status).toBe('recovery-required');
    if (noCutover.status !== 'recovery-required') return;

    expect(noCutover.reason).toBe('V3_WITHOUT_CUTOVER');
    expect(noCutover.validatedStore).toEqual(v3Store);
    expect(noCutover.rawV2).toBeNull();

    storage.seed(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      '{"invalid":"cutover"}',
    );
    const badCutover = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(badCutover.status).toBe('recovery-required');
    if (badCutover.status !== 'recovery-required') return;

    expect(badCutover.reason).toBe('V3_WITH_INVALID_CUTOVER');
    expect(badCutover.validatedStore).toEqual(v3Store);
    expect(badCutover.rawV2).toBeNull();
    expect(storage.writeCount).toBe(0);
  });

  it('keeps valid V3 available when historical V2 drift cannot be checked', () => {
    const storage = new MemoryStorage();
    const v3Store = createValidV3Store();
    const v2Raw = JSON.stringify(createV2Store());
    const rawV3 = JSON.stringify(v3Store);
    const rawCutover = JSON.stringify({
      recordVersion: 1,
      source: 'migrated-v2',
      rawV2: v2Raw,
    });

    storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
    storage.seed(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY, rawCutover);
    disallowV2Read(storage, 'Disk read error on V2 legacy key');

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('loaded-v3');
    if (result.status !== 'loaded-v3') return;

    expect(result.store).toEqual(v3Store);
    expect(result.v3Token).toBe(rawV3);
    expect(result.legacyV2Status).toBe('unavailable');
    expect(result.legacyV2Warning).toContain('Disk read error on V2 legacy key');
    expect(result.rawV2).toBeNull();
    expect(result.cutoverRecord.source).toBe('migrated-v2');
    expect(storage.writeCount).toBe(0);
  });

  it('loads valid V3 plus migrated record with unchanged, changed, and missing legacy V2', () => {
    const v2Raw = JSON.stringify(createV2Store());
    const v3Store = createValidV3Store();
    const rawV3 = JSON.stringify(v3Store);
    const cutoverPayload = {
      recordVersion: 1,
      source: 'migrated-v2',
      rawV2: v2Raw,
    };

    const cases: readonly [string | null, string][] = [
      [v2Raw, 'unchanged'],
      ['{"schemaVersion":"2.0","drift":true}', 'changed'],
      [null, 'missing'],
    ];

    for (const [currentV2, expectedStatus] of cases) {
      const storage = new MemoryStorage();
      if (currentV2 !== null) {
        storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, currentV2);
      }
      storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
      storage.seed(
        DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
        JSON.stringify(cutoverPayload),
      );

      const result = inspectHuntMemoryStorage(storage, {
        migratedAt: MIGRATION_TS,
      });
      expect(result.status).toBe('loaded-v3');
      if (result.status !== 'loaded-v3') return;

      expect(result.legacyV2Status).toBe(expectedStatus);
      expect(result.store).toEqual(v3Store);
      expect(result.v3Token).toBe(rawV3);
      expect(result.rawV2).toBe(currentV2);
      expect(storage.writeCount).toBe(0);
    }
  });

  it('rejects blank or colliding storage keys with INVALID_STORAGE_KEYS before storage access', () => {
    const invalidKeyConfigs = [
      { v2Key: '' },
      { v2Key: '   ' },
      { v3Key: '' },
      { cutoverKey: '' },
      { v2Key: 'colliding-key', v3Key: 'colliding-key' },
      { v2Key: 'colliding-key', cutoverKey: 'colliding-key' },
      { v3Key: 'colliding-key', cutoverKey: 'colliding-key' },
    ];

    for (const keys of invalidKeyConfigs) {
      const storage = new MemoryStorage();
      storage.getItem = () => {
        throw new Error('Storage should not be accessed for invalid keys');
      };

      const result = inspectHuntMemoryStorage(storage, {
        keys,
        migratedAt: MIGRATION_TS,
      });
      expect(result.status).toBe('failure');
      if (result.status !== 'failure') return;

      expect(result.code).toBe('INVALID_STORAGE_KEYS');
      expect(storage.readCount).toBe(0);
      expect(storage.writeCount).toBe(0);
    }
  });

  it('uses only the injected custom keys and still follows the zero-writes rule', () => {
    const customKeys = {
      v2Key: 'custom.progress.v2',
      v3Key: 'custom.progress.v3',
      cutoverKey: 'custom.progress.cutover',
    };
    const storage = new MemoryStorage();
    const v2Store = createV2Store();
    storage.seed(customKeys.v2Key, JSON.stringify(v2Store));

    const result = inspectHuntMemoryStorage(storage, {
      keys: customKeys,
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('upgrade-required');
    expect(storage.writeCount).toBe(0);
    expect(storage.getRawValue(customKeys.v2Key)).not.toBeNull();
    expect(storage.getRawValue(DEFAULT_PROGRESS_V2_STORAGE_KEY)).toBeNull();
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_STORAGE_KEY)).toBeNull();
    expect(storage.getRawValue(DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY)).toBeNull();
  });

  it('returns INVALID_SOURCE_STORE for hostile V2 JSON with a reserved map key and performs zero writes', () => {
    const storage = new MemoryStorage();
    const raw =
      '{"schemaVersion":"2.0","gameProgress":{"__proto__":{"gameId":"__proto__","sets":{},"orphanedProgress":{}}}}';
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, raw);

    const result = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;

    expect(result.code).toBe('INVALID_SOURCE_STORE');
    expect('candidateStore' in result).toBe(false);
    expect('store' in result).toBe(false);
    expect(result.conflicts.some((c) => c.includes(RESERVED_RECORD_KEY_MESSAGE)))
      .toBe(true);
    expect(storage.writeCount).toBe(0);
  });

  it('preserves exact raw V3 and V2 tokens, strictly validates cutover schema, and proves zero writes', () => {
    const storage = new MemoryStorage();
    const rawV2 = '  {\n  "schemaVersion": "2.0",\n  "gameProgress": {}\n}  ';
    storage.seed(DEFAULT_PROGRESS_V2_STORAGE_KEY, rawV2);

    const upgradeRes = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(upgradeRes.status).toBe('upgrade-required');
    if (upgradeRes.status !== 'upgrade-required') return;

    expect(upgradeRes.v2Token).toBe(rawV2);
    expect(storage.writeCount).toBe(0);

    const rawV3 = '  {\n  "schemaVersion": "3.0",\n  "gameProgress": {}\n}  ';
    storage.seed(DEFAULT_PROGRESS_V3_STORAGE_KEY, rawV3);
    storage.seed(
      DEFAULT_PROGRESS_V3_CUTOVER_STORAGE_KEY,
      JSON.stringify({ recordVersion: 1, source: 'fresh' }),
    );

    const loadedRes = inspectHuntMemoryStorage(storage, {
      migratedAt: MIGRATION_TS,
    });
    expect(loadedRes.status).toBe('loaded-v3');
    if (loadedRes.status !== 'loaded-v3') return;

    expect(loadedRes.v3Token).toBe(rawV3);
    expect(storage.writeCount).toBe(0);

    expect(
      ProgressV3CutoverRecordSchema.safeParse({
        recordVersion: 1,
        source: 'migrated-v2',
        rawV2: 'exact-source-string',
      }).success,
    ).toBe(true);

    expect(
      ProgressV3CutoverRecordSchema.safeParse({
        recordVersion: 1,
        source: 'fresh',
      }).success,
    ).toBe(true);

    const invalidRecords = [
      { recordVersion: 1, source: 'fresh', extra: true },
      { recordVersion: 1, source: 'fresh', rawV2: 'unexpected' },
      { recordVersion: 2, source: 'fresh' },
      { recordVersion: 1, source: 'unsupported' },
      { recordVersion: 1, source: 'migrated-v2' },
      { recordVersion: 1, source: 'migrated-v2', rawV2: 123 },
    ];

    for (const invalid of invalidRecords) {
      expect(ProgressV3CutoverRecordSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });
});
